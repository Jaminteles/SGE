import { Injectable, Logger } from '@nestjs/common';
import { JobHandler } from './job.types';

/**
 * Índice dos handlers conhecidos pelo processo.
 *
 * Registro explícito, e não varredura por decorator: o runner precisa recusar
 * um job cujo handler não existe neste processo (deploy antigo consumindo fila
 * nova), e um índice explícito torna esse caso detectável.
 */
@Injectable()
export class JobRegistry {
  private readonly logger = new Logger(JobRegistry.name);
  private readonly handlers = new Map<string, JobHandler>();

  register(handler: JobHandler): void {
    if (this.handlers.has(handler.name)) {
      throw new Error(`Já existe um handler registrado para o job ${handler.name}.`);
    }
    this.handlers.set(handler.name, handler);
    this.logger.log(`Job ${handler.name} registrado na fila ${handler.queue}.`);
  }

  get(name: string): JobHandler | undefined {
    return this.handlers.get(name);
  }
}
