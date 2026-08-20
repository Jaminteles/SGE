import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobRegistry } from '../../../common/queue/job-registry.service';
import { JobContext, PermanentJobError, QUEUES } from '../../../common/queue/job.types';
import { AutoReconciliationService, RECONCILIATION_JOBS } from '../auto-reconciliation.service';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Handler da fila de conciliação (RF-075).
 *
 * Fino como os do módulo bancário: traduz o payload e chama o serviço. O que
 * ele acrescenta é a recusa de payload malformado como `PermanentJobError` —
 * uma data inválida não melhora na quinta tentativa, e gastar o backoff com ela
 * atrasa os jobs que ainda podem dar certo.
 */
@Injectable()
export class ReconciliationJobsService implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly auto: AutoReconciliationService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: RECONCILIATION_JOBS.RUN,
      queue: QUEUES.RECONCILIATION,
      handle: (payload, context) => this.run(payload, context),
    });
  }

  private async run(payload: Record<string, unknown>, context: JobContext): Promise<void> {
    if (!context.companyId) {
      throw new PermanentJobError('Job sem empresa: não é possível aplicar a RLS.');
    }

    await this.auto.run(context.companyId, {
      bankAccountId: requireUuid(payload.bankAccountId),
      from: requireDate(payload.from, 'from'),
      to: requireDate(payload.to, 'to'),
    });
  }
}

function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PermanentJobError('Job de conciliação sem bankAccountId no payload.');
  }
  return value;
}

function requireDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) {
    throw new PermanentJobError(`Job de conciliação com ${field} inválido no payload.`);
  }
  return value;
}
