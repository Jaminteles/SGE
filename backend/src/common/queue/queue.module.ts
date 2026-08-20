import { Global, Module } from '@nestjs/common';
import { JobQueueService } from './job-queue.service';
import { JobRegistry } from './job-registry.service';
import { JobWorkerService } from './job-worker.service';

/**
 * Fila e runner (RF-069/RF-070, RN-011, RNF-009/RNF-013).
 *
 * Global porque enfileirar é operação de qualquer módulo. O runner só roda onde
 * `WORKER_ENABLED` for verdadeiro: a mesma imagem sobe como API (sem worker) e
 * como processo de fila (só worker), que é o que RNF-009 pede.
 */
@Global()
@Module({
  providers: [JobQueueService, JobRegistry, JobWorkerService],
  exports: [JobQueueService, JobRegistry],
})
export class QueueModule {}
