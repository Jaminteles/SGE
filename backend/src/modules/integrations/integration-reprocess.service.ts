import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, AUDIT_ENTITY } from '../../common/audit/audit.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { QueueName, QUEUES } from '../../common/queue/job.types';
import {
  INTEGRATION_EVENT_TYPE,
  IntegrationEventsService,
} from '../../common/integrations/integration-events.service';
import { WEBHOOK_JOBS } from '../banking/webhook-processor.service';
import { QueryFailedWorkDto, ReprocessDto } from './dto/integration.dto';

/** Situações a partir das quais reexecutar é seguro. */
const REPROCESSABLE_JOB_STATUS = ['FALHA', 'CANCELADO'] as const;

/**
 * Reprocessamento do que falhou (RF-130).
 *
 * A regra que sustenta tudo aqui: **só se reprocessa o que não deu certo**. Um
 * job CONCLUIDO não volta para a fila por esta porta, e não é uma restrição de
 * conveniência — os jobs deste sistema enviam pagamento, transmitem evento
 * fiscal e baixam título. Reexecutar um que já terminou é a definição de
 * duplicidade financeira (RN-004/RN-005).
 *
 * A idempotência do próprio reprocessamento vem de `ux_job_idempotencia`
 * (bd/13): a chave `reprocesso:job:<id>` só permite um job vivo por alvo, então
 * o duplo clique, o retry do cliente HTTP e duas abas abertas produzem um
 * reprocessamento só. Não há segunda tabela de controle inventada aqui — a
 * garantia é a mesma que a fila já dá a todo mundo.
 *
 * As camadas de idempotência de negócio continuam valendo por baixo: o envio ao
 * provedor carrega `Idempotency-Key` e `IdempotencyRecord` reserva a operação.
 * O reprocessamento repete a *tentativa*, não o *efeito*.
 */
@Injectable()
export class IntegrationReprocessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
    private readonly events: IntegrationEventsService,
    private readonly audit: AuditService,
  ) {}

  /** O que está parado e pode ser reexecutado. */
  async findFailed(companyId: string, query: QueryFailedWorkDto) {
    const target = query.target ?? 'JOB';

    if (target === 'WEBHOOK') {
      const where: Prisma.WebhookEventWhereInput = {
        companyId,
        status: 'FALHA',
        ...(query.q ? { eventType: { contains: query.q, mode: 'insensitive' as const } } : {}),
      };
      const [data, total] = await Promise.all([
        this.prisma.db.webhookEvent.findMany({
          where,
          orderBy: [{ receivedAt: 'desc' }],
          skip: query.skip,
          take: query.take,
          // `payload`, `signature` e `headers` ficam de fora: são o corpo bruto
          // do provedor, e a lista de pendências não é lugar para exibi-lo.
          select: {
            id: true,
            providerId: true,
            eventType: true,
            externalId: true,
            signatureValid: true,
            status: true,
            attempts: true,
            error: true,
            receivedAt: true,
            processedAt: true,
          },
        }),
        this.prisma.db.webhookEvent.count({ where }),
      ]);
      return new PaginatedResult(data, total, query.page, query.pageSize);
    }

    const where: Prisma.JobExecutionWhereInput = {
      companyId,
      status: { in: [...REPROCESSABLE_JOB_STATUS] },
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.db.jobExecution.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: query.skip,
        take: query.take,
        select: {
          id: true,
          queue: true,
          name: true,
          status: true,
          attempts: true,
          maxAttempts: true,
          error: true,
          lastErrorAt: true,
          createdAt: true,
          finishedAt: true,
          correlationId: true,
        },
      }),
      this.prisma.db.jobExecution.count({ where }),
    ]);
    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async reprocess(companyId: string, dto: ReprocessDto) {
    return dto.target === 'WEBHOOK'
      ? this.reprocessWebhook(companyId, dto)
      : this.reprocessJob(companyId, dto);
  }

  /**
   * Reenfileira um job que falhou, como job novo.
   *
   * Novo, e não "reabrir o antigo": a linha original é o registro de que aquela
   * tentativa falhou, com as tentativas gastas e o erro. Reescrevê-la apagaria
   * o histórico exatamente do caso que alguém está investigando.
   */
  private async reprocessJob(companyId: string, dto: ReprocessDto) {
    const job = await this.prisma.db.jobExecution.findFirst({
      where: { id: dto.id, companyId },
      select: { id: true, queue: true, name: true, payload: true, status: true, maxAttempts: true },
    });
    if (!job) {
      throw new NotFoundException('Job não encontrado.');
    }
    if (
      !REPROCESSABLE_JOB_STATUS.includes(job.status as (typeof REPROCESSABLE_JOB_STATUS)[number])
    ) {
      throw new ConflictException(
        `Só se reprocessa job em ${REPROCESSABLE_JOB_STATUS.join(' ou ')}; este está em ${job.status}.`,
      );
    }

    const newJobId = await this.queue.enqueue({
      queue: job.queue as QueueName,
      name: job.name,
      companyId,
      payload: (job.payload ?? {}) as Record<string, unknown>,
      maxAttempts: job.maxAttempts,
      idempotencyKey: `reprocesso:job:${job.id}`,
    });

    await this.register(companyId, {
      operation: 'reprocessamento.job',
      message: `Job ${job.name} (${job.id}) reenfileirado como ${newJobId ?? 'reprocessamento já pendente'}.`,
      reason: dto.reason,
      referenceType: 'job_execucao',
      referenceId: job.id,
      detail: { fila: job.queue, jobOriginal: job.id, jobNovo: newJobId },
      auditEntity: 'job_execucao',
    });

    return { target: dto.target, sourceId: job.id, jobId: newJobId, queue: job.queue };
  }

  /**
   * Devolve um webhook falhado à fila.
   *
   * Assinatura inválida não se reprocessa: o evento foi registrado como prova
   * do que chegou, e reenfileirá-lo seria aceitar depois um payload que não se
   * provou vindo do provedor (RF-066).
   */
  private async reprocessWebhook(companyId: string, dto: ReprocessDto) {
    const event = await this.prisma.db.webhookEvent.findFirst({
      where: { id: dto.id, companyId },
      select: { id: true, status: true, signatureValid: true, providerId: true, eventType: true },
    });
    if (!event) {
      throw new NotFoundException('Evento de webhook não encontrado.');
    }
    if (event.signatureValid === false) {
      throw new BadRequestException(
        'Webhook com assinatura inválida não é reprocessado: o payload não se provou vindo do provedor.',
      );
    }
    if (event.status !== 'FALHA') {
      throw new ConflictException(
        `Só se reprocessa webhook em FALHA; este está em ${event.status}.`,
      );
    }

    const jobId = await this.queue.enqueue({
      queue: QUEUES.WEBHOOKS,
      name: WEBHOOK_JOBS.PROCESS,
      companyId,
      payload: { eventId: event.id },
      idempotencyKey: `reprocesso:webhook:${event.id}`,
    });

    await this.register(companyId, {
      operation: 'reprocessamento.webhook',
      message: `Webhook ${event.eventType} (${event.id}) reenfileirado como ${jobId ?? 'reprocessamento já pendente'}.`,
      reason: dto.reason,
      referenceType: 'webhook_evento',
      referenceId: event.id,
      providerId: event.providerId,
      detail: { webhook: event.id, jobNovo: jobId },
      auditEntity: AUDIT_ENTITY.WEBHOOK_EVENT,
    });

    return { target: dto.target, sourceId: event.id, jobId, queue: QUEUES.WEBHOOKS };
  }

  /**
   * Reprocessar é ação de administrador sobre operação que move dinheiro: entra
   * no diário da integração (para quem investiga) e na trilha de auditoria
   * (para quem responde por ela) — RF-129/RN-010.
   */
  private async register(
    companyId: string,
    input: {
      operation: string;
      message: string;
      reason?: string;
      referenceType: string;
      referenceId: string;
      providerId?: string | null;
      detail: Record<string, unknown>;
      auditEntity: string;
    },
  ): Promise<void> {
    await this.events.record({
      companyId,
      providerId: input.providerId,
      type: INTEGRATION_EVENT_TYPE.REPROCESS,
      severity: 'AVISO',
      operation: input.operation,
      message: input.message,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      detail: { ...input.detail, motivo: input.reason },
    });

    // IMPORTACAO na trilha: o que o reprocessamento faz é reingerir trabalho
    // externo que já havia entrado uma vez. Não é CRIACAO (nada de novo foi
    // cadastrado) nem ALTERACAO (o registro original permanece intacto).
    await this.audit.record({
      event: AuditEvent.IMPORTACAO,
      entity: input.auditEntity,
      entityId: input.referenceId,
      companyId,
      note: `Reprocessamento solicitado${input.reason ? `: ${input.reason}` : '.'}`,
    });
  }
}
