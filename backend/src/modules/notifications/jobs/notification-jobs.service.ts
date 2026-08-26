import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobQueueService } from '../../../common/queue/job-queue.service';
import { JobRegistry } from '../../../common/queue/job-registry.service';
import { JobContext, PermanentJobError, QUEUES } from '../../../common/queue/job.types';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationDispatchService } from '../notification-dispatch.service';
import { NotificationScanService } from '../notification-scan.service';
import { NOTIFICATION_JOBS, SCAN_INTERVAL_MS } from '../notifications.constants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quantas empresas uma rodada do agendador cobre. */
const COMPANY_BATCH = 500;

/**
 * Handlers da fila de notificações (RF-119 a RF-124).
 *
 * São três jobs, e a divisão resolve um problema concreto de cada vez:
 *
 *  - **`notificacoes.agenda`** roda sem empresa e só enfileira: uma varredura
 *    por empresa ativa e, no fim, a si mesmo para a janela seguinte. É assim que
 *    o sistema tem periodicidade sem depender de cron externo nem de biblioteca
 *    de agendamento — a fila já sabe adiar um job (`scheduledFor`), e o
 *    agendamento passa a sobreviver a restart, deploy e a rodar em N workers
 *    sem duplicar, porque a chave de idempotência é a janela de tempo;
 *  - **`notificacoes.varredura`** roda **com** empresa, que é o que a RLS exige:
 *    todo alerta lê `titulo`, `transacao_pagamento` e `conciliacao`, e sem
 *    `app.empresa_id` essas tabelas não devolvem linha nenhuma;
 *  - **`notificacoes.enviar`** entrega um aviso, um job por notificação, para
 *    que a falha de um endereço não trave a caixa dos outros.
 *
 * O agendador não é registrado em processo sem worker: a API não deve enfileirar
 * varredura a cada boot.
 */
@Injectable()
export class NotificationJobsService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationJobsService.name);
  private readonly workerEnabled: boolean;

  constructor(
    private readonly registry: JobRegistry,
    private readonly queue: JobQueueService,
    private readonly prisma: PrismaService,
    private readonly scan: NotificationScanService,
    private readonly dispatch: NotificationDispatchService,
    config: ConfigService,
  ) {
    this.workerEnabled = config.get<boolean>('WORKER_ENABLED') ?? true;
  }

  onModuleInit(): void {
    this.registry.register({
      name: NOTIFICATION_JOBS.SCHEDULE,
      queue: QUEUES.NOTIFICATIONS,
      handle: () => this.runSchedule(),
    });
    this.registry.register({
      name: NOTIFICATION_JOBS.SCAN,
      queue: QUEUES.NOTIFICATIONS,
      handle: (_payload, context) => this.runScan(context),
    });
    this.registry.register({
      name: NOTIFICATION_JOBS.DISPATCH,
      queue: QUEUES.NOTIFICATIONS,
      handle: (payload, context) => this.runDispatch(payload, context),
    });
  }

  /**
   * Semeia o agendador no boot do worker.
   *
   * Idempotente pela janela: N workers subindo juntos enfileiram um job só, e um
   * worker que reinicia no meio da janela não cria uma segunda corrente de
   * varreduras.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.workerEnabled) return;

    try {
      await this.prisma.runAsSystem({ origin: 'SISTEMA' }, () => this.scheduleNext(0));
    } catch (error) {
      // Um banco indisponível no boot não pode derrubar o processo: o job de
      // agenda seria semeado de novo no próximo start.
      this.logger.error(`Não foi possível semear a agenda de notificações: ${String(error)}`);
    }
  }

  /** Enfileira uma varredura por empresa ativa e reagenda a próxima janela. */
  private async runSchedule(): Promise<void> {
    const companies = await this.prisma.db.company.findMany({
      where: { isActive: true },
      select: { id: true },
      take: COMPANY_BATCH,
    });

    const slot = this.currentSlot();
    for (const company of companies) {
      await this.queue.enqueue({
        queue: QUEUES.NOTIFICATIONS,
        name: NOTIFICATION_JOBS.SCAN,
        companyId: company.id,
        payload: {},
        // Uma varredura por empresa por janela, mesmo que a agenda rode duas vezes.
        idempotencyKey: `${NOTIFICATION_JOBS.SCAN}:${company.id}:${slot}`,
      });
    }

    await this.scheduleNext(SCAN_INTERVAL_MS);
  }

  /** Coloca a próxima agenda na fila, adiada pela janela de varredura. */
  private async scheduleNext(delayMs: number): Promise<void> {
    const scheduledFor = new Date(Date.now() + delayMs);
    await this.queue.enqueue({
      queue: QUEUES.NOTIFICATIONS,
      name: NOTIFICATION_JOBS.SCHEDULE,
      payload: {},
      scheduledFor,
      idempotencyKey: `${NOTIFICATION_JOBS.SCHEDULE}:${this.slotOf(scheduledFor)}`,
      // A agenda não faz trabalho de negócio: se falhar, a janela seguinte
      // recomeça. Poucas tentativas evitam empilhar correntes paralelas.
      maxAttempts: 3,
    });
  }

  private async runScan(context: JobContext): Promise<void> {
    if (!context.companyId) {
      throw new PermanentJobError('Varredura sem empresa: não é possível aplicar a RLS.');
    }
    await this.scan.run(context.companyId);
  }

  private async runDispatch(payload: Record<string, unknown>, context: JobContext): Promise<void> {
    if (!context.companyId) {
      throw new PermanentJobError('Despacho sem empresa: não é possível aplicar a RLS.');
    }

    const notificationId = payload.notificationId;
    if (typeof notificationId !== 'string' || !UUID.test(notificationId)) {
      throw new PermanentJobError('Job de notificação sem notificationId válido no payload.');
    }

    await this.dispatch.dispatch(context.companyId, notificationId);
  }

  /** Janela corrente, em múltiplos do intervalo de varredura. */
  private currentSlot(): number {
    return this.slotOf(new Date());
  }

  private slotOf(moment: Date): number {
    return Math.floor(moment.getTime() / SCAN_INTERVAL_MS);
  }
}
