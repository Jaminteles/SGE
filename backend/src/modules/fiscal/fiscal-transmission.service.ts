import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { PermanentJobError, QUEUES } from '../../common/queue/job.types';
import { FiscalEventStatus, FiscalEventType } from '../../common/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { FiscalEventsService } from './fiscal-events.service';
import { FISCAL_JOBS, TRANSMITTABLE } from './fiscal.constants';
import { FiscalProviderError } from './providers/fiscal-provider.port';
import { FiscalProviderResolver } from './providers/fiscal-provider-resolver.service';

const transmissionSelect = {
  id: true,
  type: true,
  sequence: true,
  status: true,
  justification: true,
  xmlContent: true,
  document: { select: { accessKey: true, number: true } },
} satisfies Prisma.FiscalEventSelect;

/**
 * Transmissão de eventos fiscais (RF-094).
 *
 * A API **enfileira**; quem fala com o provedor é o worker. Duas razões, e as
 * duas são de correção, não de desempenho:
 *
 *  1. a chamada externa não pode acontecer dentro da transação da requisição —
 *     um serviço lento prenderia a conexão de banco até o timeout do pool;
 *  2. a fila dá retry com backoff, teto de tentativas e registro do que
 *     aconteceu (RF-070). O evento fiscal precisa exatamente disso: a SEFAZ fora
 *     do ar é o caso comum, não a exceção.
 *
 * A idempotência tem duas camadas. No enfileiramento, a chave por evento impede
 * que dois pedidos virem dois jobs. Na chamada, o id do evento vai como
 * `idempotency-key` ao provedor, e a gravação do retorno só acontece se o evento
 * ainda estiver em situação de transporte — o retry recebe o mesmo protocolo e
 * não o grava duas vezes. Sem isso, um retry transformaria uma autorização de
 * cancelamento em duas, e a segunda não existe.
 */
@Injectable()
export class FiscalTransmissionService {
  private readonly logger = new Logger(FiscalTransmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
    private readonly events: FiscalEventsService,
    private readonly resolver: FiscalProviderResolver,
  ) {}

  /** Coloca o evento na fila de transmissão (RF-094). */
  async request(companyId: string, eventId: string): Promise<{ jobId: string | null }> {
    const event = await this.load(companyId, eventId);
    this.assertTransmittable(event.status);

    const { provider } = await this.resolver.resolve(companyId);
    if (!provider.canTransmit) {
      throw new ConflictException(
        'Esta empresa não tem integração fiscal ativa: registre o retorno do fisco pela baixa manual do evento.',
      );
    }

    const jobId = await this.queue.enqueue({
      queue: QUEUES.FISCAL,
      name: FISCAL_JOBS.TRANSMIT_EVENT,
      companyId,
      payload: { eventId },
      // O mesmo evento pedido duas vezes é um job só enquanto o primeiro vive.
      idempotencyKey: `${FISCAL_JOBS.TRANSMIT_EVENT}:${eventId}`,
    });

    return { jobId };
  }

  /**
   * Transmite o evento e grava o retorno (RF-094). Chamado pelo worker.
   *
   * Evento que já saiu da situação de transporte é no-op: é o retry que chegou
   * depois de o retorno ter sido gravado, e reescrevê-lo seria revisar resposta
   * do fisco.
   */
  async run(companyId: string, eventId: string): Promise<void> {
    const event = await this.load(companyId, eventId);

    if (!TRANSMITTABLE.includes(event.status as FiscalEventStatus)) {
      this.logger.log(`Evento fiscal ${eventId} já está ${event.status}: nada a transmitir.`);
      return;
    }

    const { provider, context } = await this.resolver.resolve(companyId);
    if (!provider.canTransmit) {
      throw new PermanentJobError(
        'Empresa sem integração fiscal ativa: o retorno precisa ser lançado manualmente.',
      );
    }

    try {
      const result = await provider.transmit(
        {
          eventId: event.id,
          type: event.type as FiscalEventType,
          sequence: event.sequence,
          accessKey: event.document?.accessKey ?? null,
          documentNumber: event.document?.number ?? null,
          justification: event.justification,
          xmlContent: event.xmlContent,
        },
        context,
      );

      await this.events.applyResult(companyId, event.id, {
        status: result.status,
        protocol: result.protocol,
        response: {
          origem: 'PROVEDOR',
          provedor: context.providerCode,
          mensagem: result.message ?? null,
          ...(result.raw ?? {}),
        } as Prisma.InputJsonValue,
      });
    } catch (error) {
      if (error instanceof FiscalProviderError) {
        // O evento continua REGISTRADO: nada foi autorizado. O que se guarda é a
        // razão da falha — marcar REJEITADO aqui seria atribuir ao fisco uma
        // recusa que foi da integração.
        await this.recordFailure(companyId, event.id, context.providerCode, error);

        if (!error.retryable) {
          throw new PermanentJobError(error.message);
        }
      }
      throw error;
    }
  }

  private async recordFailure(
    companyId: string,
    eventId: string,
    providerCode: string,
    error: FiscalProviderError,
  ): Promise<void> {
    await this.prisma.db.fiscalEvent.updateMany({
      where: { id: eventId, companyId, status: { in: TRANSMITTABLE } },
      data: {
        response: {
          origem: 'PROVEDOR',
          provedor: providerCode,
          erro: error.code,
          mensagem: error.message,
        },
      },
    });
  }

  private async load(companyId: string, eventId: string) {
    const event = await this.prisma.db.fiscalEvent.findFirst({
      where: { id: eventId, companyId },
      select: transmissionSelect,
    });
    if (!event) {
      throw new NotFoundException('Evento fiscal não encontrado.');
    }
    return event;
  }

  private assertTransmittable(status: string): void {
    if (!TRANSMITTABLE.includes(status as FiscalEventStatus)) {
      throw new ConflictException(
        `O evento está ${status}: a resposta do fisco não é revista por nova transmissão.`,
      );
    }
  }
}
