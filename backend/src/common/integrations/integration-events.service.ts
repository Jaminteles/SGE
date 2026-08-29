import { Injectable, Logger } from '@nestjs/common';
import { IntegrationEventSeverity, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Naturezas de evento aceitas por `integracao_evento.tipo` (CHECK em bd/20). */
export const INTEGRATION_EVENT_TYPE = {
  /** Saiu daqui para o provedor. */
  CALL: 'CHAMADA',
  /** O provedor respondeu, e a resposta foi aceita. */
  RESPONSE: 'RESPOSTA',
  ERROR: 'ERRO',
  /** Chegou do provedor sem termos pedido. */
  WEBHOOK: 'WEBHOOK',
  REPROCESS: 'REPROCESSAMENTO',
  /** Alguém mudou a configuração da integração. */
  CONFIGURATION: 'CONFIGURACAO',
  TEST: 'TESTE',
  SUSPENSION: 'SUSPENSAO',
} as const;

export type IntegrationEventType =
  (typeof INTEGRATION_EVENT_TYPE)[keyof typeof INTEGRATION_EVENT_TYPE];

export interface IntegrationEventInput {
  companyId: string;
  integrationId?: string | null;
  providerId?: string | null;
  type: IntegrationEventType;
  severity?: IntegrationEventSeverity;
  operation?: string;
  message: string;
  detail?: Record<string, unknown>;
  /** Tabela referida (`job_execucao`, `webhook_evento`, ...) e o id da linha. */
  referenceType?: string;
  referenceId?: string;
  httpStatus?: number;
  durationMs?: number;
  attempt?: number;
}

/**
 * Chaves cujo valor nunca é gravado no diário, em qualquer profundidade.
 *
 * A lista repete a do trigger de `parametros` em bd/20 de propósito: são duas
 * defesas com falhas independentes — o trigger recusa o cadastro, este filtro
 * recusa o registro. Uma resposta de erro do provedor costuma ecoar o corpo da
 * requisição, e é assim que um `Authorization` acaba dentro do log de erro.
 */
const REDACTED_KEY =
  /(senha|password|secret|segredo|token|api[_-]?key|chave[_-]?api|private[_-]?key|credential|credencial|authorization|passphrase|cookie|assinatura|signature)/i;

/** Teto do detalhe gravado: log não é armazenamento de payload. */
const MAX_DETAIL_CHARS = 8_000;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_DEPTH = 6;

/**
 * Registro do diário de integrações (RF-129).
 *
 * Global, como a auditoria: qualquer módulo que fale com o mundo externo emite
 * eventos daqui sem importar o M18. A divisão com `AuditService` é de assunto —
 * a trilha de auditoria responde "quem fez o quê no sistema", este diário
 * responde "o que aconteceu entre nós e o provedor", que é a pergunta de quem
 * está investigando uma integração parada às três da manhã.
 *
 * Duas propriedades que o chamador não precisa lembrar de garantir:
 *
 *  1. **redação** — todo detalhe passa por `redact` antes de tocar o banco;
 *  2. **não propaga exceção** — registrar é efeito colateral. Uma falha ao
 *     gravar o evento de erro não pode substituir o erro original, que é o que
 *     o chamador precisa tratar.
 *
 * A gravação usa `prisma.root` (fora da transação da requisição) porque o
 * evento de falha precisa sobreviver ao rollback: numa resposta 5xx o
 * TenantContextMiddleware reverte a transação, e o evento que explicaria o 5xx
 * sumiria junto.
 */
@Injectable()
export class IntegrationEventsService {
  private readonly logger = new Logger(IntegrationEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava um evento. Nunca lança: devolve o id ou `null` quando o registro
   * falhou (e nesse caso o motivo vai para o log da aplicação).
   */
  async record(input: IntegrationEventInput): Promise<string | null> {
    try {
      const created = await this.prisma.root.integrationEvent.create({
        data: {
          companyId: input.companyId,
          integrationId: input.integrationId ?? null,
          providerId: input.providerId ?? null,
          type: input.type,
          severity: input.severity ?? IntegrationEventSeverity.INFO,
          operation: input.operation?.slice(0, 120),
          message: input.message.slice(0, MAX_MESSAGE_CHARS),
          detail: this.buildDetail(input.detail),
          referenceType: input.referenceType?.slice(0, 60),
          referenceId: input.referenceId,
          httpStatus: input.httpStatus,
          durationMs: input.durationMs,
          attempt: input.attempt,
          correlationId: this.prisma.currentRequestMetadata?.correlationId,
        },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      this.logger.error(
        `Falha ao registrar evento ${input.type} da integração ${input.integrationId ?? '-'}: ${String(error)}`,
      );
      return null;
    }
  }

  /** Atalho de erro: mesma coisa, com a severidade certa e sem repetição. */
  async recordFailure(
    input: Omit<IntegrationEventInput, 'type' | 'severity'> & {
      severity?: IntegrationEventSeverity;
    },
  ): Promise<string | null> {
    return this.record({
      ...input,
      type: INTEGRATION_EVENT_TYPE.ERROR,
      severity: input.severity ?? IntegrationEventSeverity.ERRO,
    });
  }

  private buildDetail(detail?: Record<string, unknown>): Prisma.InputJsonValue | undefined {
    if (!detail) return undefined;
    const redacted = this.redact(detail, 0) as Prisma.InputJsonValue;
    const serialized = JSON.stringify(redacted);
    if (serialized !== undefined && serialized.length > MAX_DETAIL_CHARS) {
      return {
        truncado: true,
        motivo: `detalhe com ${serialized.length} caracteres excede o teto de ${MAX_DETAIL_CHARS}`,
      };
    }
    return redacted;
  }

  /**
   * Substitui por `[REDIGIDO]` o valor de toda chave com cara de segredo, em
   * qualquer profundidade, e corta a recursão em `MAX_DEPTH` — payload de
   * provedor com ciclo ou aninhamento absurdo não pode travar quem o registra.
   */
  redact(value: unknown, depth = 0): unknown {
    if (depth >= MAX_DEPTH) return '[PROFUNDO]';
    if (Array.isArray(value)) {
      return value.slice(0, 50).map((item) => this.redact(item, depth + 1));
    }
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        out[key] = REDACTED_KEY.test(key) ? '[REDIGIDO]' : this.redact(item, depth + 1);
      }
      return out;
    }
    if (typeof value === 'string') {
      return value.length > 500 ? `${value.slice(0, 500)}…` : value;
    }
    if (typeof value === 'bigint') return value.toString();
    return value;
  }
}
