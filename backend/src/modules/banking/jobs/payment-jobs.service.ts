import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobRegistry } from '../../../common/queue/job-registry.service';
import { JobContext, PermanentJobError, QUEUES } from '../../../common/queue/job.types';
import { PaymentTransactionsService, PAYMENT_JOBS } from '../payment-transactions.service';
import { WebhookProcessorService, WEBHOOK_JOBS } from '../webhook-processor.service';

/**
 * Handlers da fila do módulo bancário (RF-069/RF-070).
 *
 * São finos de propósito: traduzem o payload do job em chamada de serviço e
 * deixam a decisão de retry para o runner. A regra de "o que se repete e o que
 * não se repete" mora nos erros — `ProviderError.retryable` sobe e é reagendado,
 * `PermanentJobError` encerra.
 */
@Injectable()
export class PaymentJobsService implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly payments: PaymentTransactionsService,
    private readonly webhooks: WebhookProcessorService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: PAYMENT_JOBS.SEND,
      queue: QUEUES.PAYMENTS,
      handle: (payload, context) => this.send(payload, context),
    });
    this.registry.register({
      name: PAYMENT_JOBS.SYNC,
      queue: QUEUES.PAYMENTS,
      handle: (payload, context) => this.sync(payload, context),
    });
    this.registry.register({
      name: WEBHOOK_JOBS.PROCESS,
      queue: QUEUES.WEBHOOKS,
      handle: (payload, context) => this.processWebhook(payload, context),
    });
  }

  private async send(payload: Record<string, unknown>, context: JobContext): Promise<void> {
    const transactionId = requireUuid(payload.transactionId, 'transactionId');
    const companyId = requireCompany(context);
    await this.payments.dispatch(companyId, transactionId);
  }

  private async sync(payload: Record<string, unknown>, context: JobContext): Promise<void> {
    const transactionId = requireUuid(payload.transactionId, 'transactionId');
    const companyId = requireCompany(context);
    await this.payments.sync(companyId, transactionId);
  }

  private async processWebhook(
    payload: Record<string, unknown>,
    context: JobContext,
  ): Promise<void> {
    const eventId = requireUuid(payload.eventId, 'eventId');
    await this.webhooks.process(eventId, context);
  }
}

/** Payload malformado não melhora com repetição. */
function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PermanentJobError(`Job sem ${field} no payload.`);
  }
  return value;
}

function requireCompany(context: JobContext): string {
  if (!context.companyId) {
    throw new PermanentJobError('Job sem empresa: não é possível aplicar a RLS.');
  }
  return context.companyId;
}
