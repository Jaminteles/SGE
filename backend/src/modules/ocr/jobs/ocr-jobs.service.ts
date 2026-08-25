import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobRegistry } from '../../../common/queue/job-registry.service';
import { JobContext, PermanentJobError, QUEUES } from '../../../common/queue/job.types';
import { OcrProcessingService } from '../ocr-processing.service';
import { OCR_JOBS } from '../ocr.constants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Handler da fila de OCR (RF-096).
 *
 * Fino como os do módulo bancário e do de conciliação: traduz o payload e chama
 * o serviço. Payload malformado é `PermanentJobError` — um id inválido não
 * melhora na quinta tentativa, e gastar o backoff com ele atrasa os jobs que
 * ainda podem dar certo.
 */
@Injectable()
export class OcrJobsService implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly processing: OcrProcessingService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: OCR_JOBS.PROCESS,
      queue: QUEUES.OCR,
      handle: (payload, context) => this.run(payload, context),
    });
  }

  private async run(payload: Record<string, unknown>, context: JobContext): Promise<void> {
    if (!context.companyId) {
      throw new PermanentJobError('Job sem empresa: não é possível aplicar a RLS.');
    }

    const processingId = payload.processingId;
    if (typeof processingId !== 'string' || !UUID.test(processingId)) {
      throw new PermanentJobError('Job de OCR sem processingId válido no payload.');
    }

    await this.processing.run(context.companyId, processingId);
  }
}
