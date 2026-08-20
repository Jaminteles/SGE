import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sha256 } from '../../common/crypto/crypto.service';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { QUEUES } from '../../common/queue/job.types';
import { ProviderResolver } from './providers/provider-resolver.service';
import { WEBHOOK_JOBS } from './webhook-processor.service';

export interface WebhookRequest {
  providerCode: string;
  companyId: string;
  rawBody: Buffer;
  signature?: string;
  headers: Record<string, string>;
}

export interface WebhookReceipt {
  eventId: string;
  duplicated: boolean;
}

/** Cabeçalhos que nunca entram no registro: são credencial. */
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

/**
 * Recepção de webhooks de provedores financeiros (RF-066, RN-005).
 *
 * A rota é pública — é o banco quem chama, e ele não tem JWT nosso. O que
 * autentica a chamada é a **assinatura HMAC** conferida contra o segredo da
 * credencial daquela empresa. O `companyId` vem na URL e não é segredo: ele
 * seleciona qual segredo verifica a assinatura, e uma URL com empresa errada
 * simplesmente não valida.
 *
 * Três decisões:
 *
 *  1. **grava antes de processar**. O banco espera 2xx rápido; processar em
 *     linha faria o provedor reenviar por timeout enquanto o primeiro ainda
 *     roda. O que chega vira linha em `webhook_evento` e um job (RF-069);
 *  2. **grava mesmo com assinatura inválida**, e responde 401. Um evento
 *     forjado é a única evidência de que alguém tentou confirmar um pagamento
 *     que não existe — descartá-lo apagaria o ataque. O banco recusa que ele
 *     seja processado (bd/13 §7);
 *  3. **deduplica por id de evento, ou pelo hash do corpo no dia** quando o
 *     provedor não manda id (RN-005). Reentrega não vira segundo efeito.
 *
 * Roda em contexto de sistema (`runAsSystem`), fora da transação da requisição:
 * o registro do evento precisa sobreviver a uma resposta 401.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderResolver,
    private readonly queue: JobQueueService,
  ) {}

  async receive(request: WebhookRequest): Promise<WebhookReceipt> {
    const payloadHash = sha256(request.rawBody);

    const outcome = await this.prisma.runAsSystem(
      { origin: 'WEBHOOK', companyId: request.companyId },
      async () => {
        const resolved = await this.providers.resolveByCode(
          request.companyId,
          request.providerCode,
        );

        const valid = resolved.provider.verifyWebhookSignature(
          request.rawBody,
          request.signature,
          resolved.context,
        );

        const payload = parseJson(request.rawBody);
        const parsed = valid ? resolved.provider.parseWebhookEvent(payload) : null;

        const duplicate = await this.findDuplicate(
          resolved.providerId,
          parsed?.eventId,
          payloadHash,
        );
        if (duplicate) {
          return { eventId: duplicate.id, duplicated: true, valid };
        }

        const event = await this.prisma.db.webhookEvent.create({
          data: {
            companyId: request.companyId,
            providerId: resolved.providerId,
            eventType: parsed?.eventType ?? 'desconhecido',
            externalId: parsed?.eventId,
            signature: request.signature,
            signatureValid: valid,
            payload: payload as Prisma.InputJsonValue,
            payloadHash,
            headers: sanitizeHeaders(request.headers) as Prisma.InputJsonValue,
            status: valid ? 'PENDENTE' : 'FALHA',
            error: valid ? undefined : 'Assinatura inválida: evento registrado e não processado.',
          },
          select: { id: true },
        });

        if (valid) {
          await this.queue.enqueue({
            queue: QUEUES.WEBHOOKS,
            name: WEBHOOK_JOBS.PROCESS,
            companyId: request.companyId,
            payload: { eventId: event.id },
            idempotencyKey: `webhook:${event.id}`,
          });
        }

        return { eventId: event.id, duplicated: false, valid };
      },
    );

    if (!outcome.valid) {
      this.logger.warn(
        `Webhook de ${request.providerCode} para a empresa ${request.companyId} com assinatura inválida.`,
      );
      throw new UnauthorizedException('Assinatura do webhook inválida.');
    }

    return { eventId: outcome.eventId, duplicated: outcome.duplicated };
  }

  /**
   * Reentrega já conhecida (RN-005).
   *
   * Com id de evento, a chave é ele. Sem id, é o hash do corpo **no dia** — fora
   * dessa janela o mesmo corpo pode ser um evento novo e legítimo (duas
   * cobranças idênticas em dias diferentes).
   */
  private async findDuplicate(
    providerId: string,
    externalId: string | undefined,
    payloadHash: string,
  ): Promise<{ id: string } | null> {
    if (externalId) {
      return this.prisma.db.webhookEvent.findFirst({
        where: { providerId, externalId },
        select: { id: true },
      });
    }

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    return this.prisma.db.webhookEvent.findFirst({
      where: { providerId, payloadHash, externalId: null, receivedAt: { gte: startOfDay } },
      select: { id: true },
    });
  }
}

/** Corpo ilegível não derruba a recepção: vira payload registrado como texto. */
function parseJson(raw: Buffer): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { _raw: raw.toString('utf8').slice(0, 4000) };
  }
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !SENSITIVE_HEADERS.has(name.toLowerCase())),
  );
}
