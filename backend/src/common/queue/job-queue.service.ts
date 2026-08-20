import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueName } from './job.types';

export interface EnqueueParams {
  queue: QueueName;
  name: string;
  payload: Record<string, unknown>;
  companyId?: string;
  /** Quando executar. Ausente = agora. É assim que o agendamento funciona. */
  scheduledFor?: Date;
  maxAttempts?: number;
  /**
   * Dedupe do enfileiramento: com a mesma chave, o job pedido duas vezes é um
   * job só enquanto não terminar (índice parcial `ux_job_idempotencia`).
   */
  idempotencyKey?: string;
}

/**
 * Enfileiramento (RF-069, RN-011).
 *
 * Enfileirar participa da transação de quem chama — e é essa a razão de a fila
 * viver no banco. Um job que dispara sobre uma ordem de pagamento revertida, ou
 * uma ordem gravada cujo job se perdeu, seriam os dois modos de falha que a
 * combinação "grava no Postgres, enfileira no Redis" produz. Aqui os dois
 * commits são o mesmo commit.
 *
 * Trocar por BullMQ mais tarde é reescrever este serviço e o runner; o contrato
 * de `JobHandler` não muda.
 */
@Injectable()
export class JobQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(params: EnqueueParams): Promise<string | null> {
    const existing = params.idempotencyKey
      ? await this.prisma.db.jobExecution.findFirst({
          where: {
            queue: params.queue,
            idempotencyKey: params.idempotencyKey,
            status: { in: ['PENDENTE', 'AGENDADO', 'PROCESSANDO'] },
          },
          select: { id: true },
        })
      : null;

    // O job pedido de novo enquanto o primeiro ainda vive é o mesmo job.
    if (existing) {
      return existing.id;
    }

    const job = await this.prisma.db.jobExecution.create({
      data: {
        companyId: params.companyId,
        queue: params.queue,
        name: params.name,
        payload: params.payload as Prisma.InputJsonValue,
        status: params.scheduledFor ? 'AGENDADO' : 'PENDENTE',
        scheduledFor: params.scheduledFor ?? new Date(),
        maxAttempts: params.maxAttempts,
        idempotencyKey: params.idempotencyKey,
        correlationId: this.prisma.currentRequestMetadata?.correlationId,
      },
      select: { id: true },
    });

    return job.id;
  }
}
