import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobRegistry } from '../../../common/queue/job-registry.service';
import { JobContext, PermanentJobError, QUEUES } from '../../../common/queue/job.types';
import { FiscalTransmissionService } from '../fiscal-transmission.service';
import { FISCAL_JOBS } from '../fiscal.constants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Handler da fila fiscal (RF-094).
 *
 * Fino como os do módulo bancário, do de conciliação e do de OCR: traduz o
 * payload e chama o serviço. Payload malformado é `PermanentJobError` — um id
 * inválido não melhora na quinta tentativa, e gastar o backoff com ele atrasa os
 * eventos que ainda podem ser transmitidos.
 */
@Injectable()
export class FiscalJobsService implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly transmission: FiscalTransmissionService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: FISCAL_JOBS.TRANSMIT_EVENT,
      queue: QUEUES.FISCAL,
      handle: (payload, context) => this.run(payload, context),
    });
  }

  private async run(payload: Record<string, unknown>, context: JobContext): Promise<void> {
    if (!context.companyId) {
      throw new PermanentJobError('Job sem empresa: não é possível aplicar a RLS.');
    }

    const eventId = payload.eventId;
    if (typeof eventId !== 'string' || !UUID.test(eventId)) {
      throw new PermanentJobError('Job fiscal sem eventId válido no payload.');
    }

    await this.transmission.run(context.companyId, eventId);
  }
}
