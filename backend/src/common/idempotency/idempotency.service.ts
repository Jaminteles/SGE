import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sha256 } from '../crypto/crypto.service';

/**
 * Espaço de nomes da chave (`gestao.idempotencia.escopo`, com CHECK em bd/13).
 *
 * O escopo separa espaços de chave: o cliente escolhe a chave, e a mesma chave
 * em escopos diferentes é outra operação.
 */
export const IDEMPOTENCY_SCOPE = {
  PAYMENT: 'PAGAMENTO',
  CANCELLATION: 'CANCELAMENTO',
  WEBHOOK: 'WEBHOOK',
  IMPORT: 'IMPORTACAO',
  JOB: 'JOB',
} as const;

export type IdempotencyScope = (typeof IDEMPOTENCY_SCOPE)[keyof typeof IDEMPOTENCY_SCOPE];

export interface IdempotentOutcome<T> {
  /** Identidade do que foi criado — grava em `recurso_id`/`recurso_tipo`. */
  resourceId?: string;
  resourceType?: string;
  response: T;
}

export interface IdempotentRun<T> {
  /** `true` quando a resposta veio da execução anterior, não desta chamada. */
  replayed: boolean;
  response: T;
}

interface RunParams<T> {
  companyId?: string;
  scope: IdempotencyScope;
  key: string;
  /** Corpo da requisição: entra no hash que detecta reuso indevido da chave. */
  request: unknown;
  userId?: string;
  execute: () => Promise<IdempotentOutcome<T>>;
}

/**
 * Execução idempotente de operações que movem dinheiro (RF-067, RN-004/RN-005).
 *
 * O contrato tem três respostas possíveis para a mesma chave:
 *
 *  - **primeira vez**: reserva, executa e grava o resultado;
 *  - **repetição com o mesmo corpo**: devolve o resultado gravado sem executar
 *    nada — é o retry do cliente, o reenvio do worker, o webhook duplicado;
 *  - **repetição com corpo diferente**: 409. Reusar a chave de um pagamento de
 *    R$ 10 para um de R$ 10.000 é erro de quem chama, e executar seria o pior
 *    desfecho possível.
 *
 * Tudo roda dentro da transação da requisição, e é isso que faz a reserva valer:
 * duas chamadas simultâneas com a mesma chave disputam o índice único
 * `ux_idempotencia_empresa_escopo_chave` (bd/13 §4). A que perder recebe 409 —
 * um retry depois já encontra o resultado da vencedora.
 *
 * O que **não** está aqui, de propósito: nada de `catch` no `execute`. Se a
 * operação falhar, a transação da requisição é revertida inteira (inclusive a
 * reserva) e a chave volta a estar livre — o correto para algo que não chegou a
 * acontecer.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run<T>(params: RunParams<T>): Promise<IdempotentRun<T>> {
    const requestHash = sha256(JSON.stringify(params.request ?? null));

    const existing = await this.prisma.db.idempotencyRecord.findFirst({
      where: { companyId: params.companyId ?? null, scope: params.scope, key: params.key },
    });

    if (existing) {
      return { replayed: true, response: this.replay<T>(existing, requestHash, params) };
    }

    await this.prisma.db.idempotencyRecord.create({
      data: {
        companyId: params.companyId,
        scope: params.scope,
        key: params.key,
        requestHash,
        userId: params.userId,
      },
      select: { id: true },
    });

    const outcome = await params.execute();

    await this.prisma.db.idempotencyRecord.updateMany({
      where: { companyId: params.companyId ?? null, scope: params.scope, key: params.key },
      data: {
        resourceId: outcome.resourceId,
        resourceType: outcome.resourceType,
        response: outcome.response as Prisma.InputJsonValue,
        statusCode: 201,
      },
    });

    return { replayed: false, response: outcome.response };
  }

  private replay<T>(
    record: { requestHash: string | null; response: Prisma.JsonValue | null },
    requestHash: string,
    params: RunParams<T>,
  ): T {
    if (record.requestHash && record.requestHash !== requestHash) {
      throw new ConflictException(
        `A chave de idempotência informada já foi usada com outro conteúdo (${params.scope}).`,
      );
    }
    if (record.response === null) {
      // Reserva sem resultado só sobrevive ao commit se a execução tiver
      // gravado o recurso e falhado depois de gravá-lo — ou se outro processo
      // ainda estiver dentro da transação. Nos dois casos, repetir é pior que
      // devolver conflito e deixar o cliente tentar de novo.
      this.logger.warn(`Reserva de idempotência ${params.scope}/${params.key} sem resultado.`);
      throw new ConflictException(
        'Uma operação com esta chave de idempotência ainda está em andamento.',
      );
    }
    return record.response as T;
  }
}
