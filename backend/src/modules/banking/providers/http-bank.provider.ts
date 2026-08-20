import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { CircuitBreaker } from './circuit-breaker';
import {
  ParsedWebhookEvent,
  PaymentOrder,
  PaymentProvider,
  ProviderContext,
  ProviderError,
  ProviderResult,
  ProviderStatus,
} from './payment-provider.port';

/** Código em `gestao.provider.codigo`. */
export const HTTP_BANK_PROVIDER_CODE = 'SANDBOX';

/** Vocabulário do provedor -> vocabulário do domínio. */
const STATUS_MAP: Record<string, ProviderStatus> = {
  ACCEPTED: 'ENVIADA',
  RECEIVED: 'ENVIADA',
  PENDING: 'PROCESSANDO',
  PROCESSING: 'PROCESSANDO',
  SETTLED: 'CONFIRMADA',
  CONFIRMED: 'CONFIRMADA',
  COMPLETED: 'CONFIRMADA',
  FAILED: 'FALHA',
  REJECTED: 'FALHA',
  CANCELLED: 'CANCELADA',
  CANCELED: 'CANCELADA',
};

/** Códigos HTTP que melhoram sozinhos com o tempo. */
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

interface ProviderPayload {
  id?: string;
  status?: string;
  endToEndId?: string;
  errorCode?: string;
  message?: string;
  [key: string]: unknown;
}

/**
 * Adaptador HTTP genérico para provedores financeiros REST (RF-061, RNF-011).
 *
 * O que ele carrega, e nenhum desses controles é opcional quando o outro lado
 * move dinheiro:
 *
 *  - **timeout** em toda chamada — sem ele, um provedor lento prende a conexão
 *    de banco da transação do job até o timeout do pool;
 *  - **idempotência repassada** no header `Idempotency-Key`, para que o retry
 *    daqui não duplique lá (RF-067/RN-004);
 *  - **disjuntor** por empresa+provedor: banco fora para de ser chamado;
 *  - **validação de destino** — a URL vem da credencial cadastrada pela empresa,
 *    e uma URL cadastrada é entrada do usuário. Sem a checagem abaixo, um
 *    `baseUrl` apontando para `http://169.254.169.254` transformaria este
 *    adaptador em SSRF com credenciais da infraestrutura;
 *  - **resposta validada** antes de virar estado: status desconhecido é erro,
 *    não "deu certo".
 *
 * O retry propriamente dito **não** está aqui: ele é da fila (RF-070), que já
 * tem backoff, teto e registro de tentativas. Repetir nos dois lugares
 * multiplicaria as chamadas ao provedor.
 */
@Injectable()
export class HttpBankProvider implements PaymentProvider {
  readonly code = HTTP_BANK_PROVIDER_CODE;
  readonly requiresCredentials = true;

  private readonly logger = new Logger(HttpBankProvider.name);
  private readonly timeoutMs: number;
  private readonly allowedHosts: string[];
  private readonly allowInsecure: boolean;
  private readonly breaker: CircuitBreaker;

  constructor(config: ConfigService) {
    this.timeoutMs = config.get<number>('INTEGRATION_HTTP_TIMEOUT_MS') ?? 10_000;
    this.allowedHosts = (config.get<string>('INTEGRATION_ALLOWED_HOSTS') ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    this.allowInsecure = config.get<string>('NODE_ENV') !== 'production';
    this.breaker = new CircuitBreaker({
      failureThreshold: config.get<number>('INTEGRATION_CIRCUIT_THRESHOLD') ?? 5,
      openMs: config.get<number>('INTEGRATION_CIRCUIT_OPEN_MS') ?? 60_000,
    });
  }

  async send(order: PaymentOrder, context: ProviderContext): Promise<ProviderResult> {
    const body = {
      idempotencyKey: order.idempotencyKey,
      direction: order.direction,
      method: order.method,
      amount: order.amount,
      description: order.description ?? undefined,
      scheduledFor: order.scheduledFor ?? undefined,
      debitAccount: {
        bankCode: order.account.bankCode,
        agency: order.account.agency,
        account: order.account.account,
      },
      payee: order.payee,
    };

    return this.request('POST', '/payments', context, order.idempotencyKey, body);
  }

  async query(externalId: string, context: ProviderContext): Promise<ProviderResult> {
    return this.request('GET', `/payments/${encodeURIComponent(externalId)}`, context);
  }

  async cancel(
    externalId: string,
    reason: string,
    context: ProviderContext,
  ): Promise<ProviderResult> {
    if (!context.capabilities.cancelamento) {
      throw new ProviderError(
        `O provedor ${context.providerCode} não suporta cancelamento.`,
        'CANCELAMENTO_NAO_SUPORTADO',
        false,
      );
    }
    return this.request(
      'POST',
      `/payments/${encodeURIComponent(externalId)}/cancel`,
      context,
      `cancel:${externalId}`,
      { reason },
    );
  }

  /**
   * HMAC-SHA256 do corpo cru, comparado em tempo constante (RF-066).
   *
   * Sobre o corpo **cru**, não sobre o JSON reserializado: reordenar chaves ou
   * mudar espaçamento produz outro texto e outra assinatura.
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    signature: string | undefined,
    context: ProviderContext,
  ): boolean {
    const secret = context.credentials.webhookSecret;
    if (!secret || !signature) {
      return false;
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const received = Buffer.from(signature.replace(/^sha256=/, ''), 'hex');
    if (received.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(expected, received);
  }

  /**
   * Corpo do webhook -> vocabulário do domínio (RF-066).
   *
   * Contrato do adaptador genérico: `{ eventId, event, paymentId, status }`.
   * Um banco real traz outro dialeto, e é aqui que ele para — o processador
   * nunca vê nome de campo de provedor.
   */
  parseWebhookEvent(payload: Record<string, unknown>): ParsedWebhookEvent | null {
    const status = STATUS_MAP[String(payload.status ?? '').toUpperCase()];
    if (!status) {
      return null;
    }
    return {
      eventId: typeof payload.eventId === 'string' ? payload.eventId : undefined,
      eventType: typeof payload.event === 'string' ? payload.event : 'payment.updated',
      externalId: typeof payload.paymentId === 'string' ? payload.paymentId : undefined,
      idempotencyKey:
        typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : undefined,
      result: {
        status,
        externalId: typeof payload.paymentId === 'string' ? payload.paymentId : undefined,
        endToEndId: typeof payload.endToEndId === 'string' ? payload.endToEndId : undefined,
        errorCode: typeof payload.errorCode === 'string' ? payload.errorCode : undefined,
        errorMessage: typeof payload.message === 'string' ? payload.message : undefined,
        raw: payload,
      },
    };
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    context: ProviderContext,
    idempotencyKey?: string,
    body?: unknown,
  ): Promise<ProviderResult> {
    const url = this.resolveUrl(context, path);
    const circuitKey = `${context.companyId}:${context.providerCode}`;

    if (this.breaker.check(circuitKey) === 'ABERTO') {
      throw new ProviderError(
        `Integração com ${context.providerCode} temporariamente suspensa após falhas seguidas.`,
        'CIRCUITO_ABERTO',
        true,
      );
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(context.credentials.apiKey
            ? { authorization: `Bearer ${context.credentials.apiKey}` }
            : {}),
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      this.breaker.recordFailure(circuitKey);
      // A mensagem do fetch pode conter a URL, e a URL é cadastro da empresa:
      // fica no log do servidor, não na exceção que sobe.
      this.logger.warn(
        `Falha de rede em ${context.providerCode} (${method} ${path}): ${String(error)}`,
      );
      throw new ProviderError(
        `Provedor ${context.providerCode} não respondeu.`,
        'INDISPONIVEL',
        true,
      );
    }

    const payload = await this.parseBody(response);

    if (!response.ok) {
      const retryable = RETRYABLE_HTTP.has(response.status);
      if (retryable) {
        this.breaker.recordFailure(circuitKey);
      } else {
        this.breaker.recordSuccess(circuitKey);
      }
      throw new ProviderError(
        payload.message ?? `Provedor ${context.providerCode} recusou a operação.`,
        payload.errorCode ?? `HTTP_${response.status}`,
        retryable,
      );
    }

    this.breaker.recordSuccess(circuitKey);
    return this.toResult(payload, context);
  }

  private async parseBody(response: Response): Promise<ProviderPayload> {
    try {
      const parsed: unknown = await response.json();
      return parsed && typeof parsed === 'object' ? (parsed as ProviderPayload) : {};
    } catch {
      return {};
    }
  }

  /** Resposta só vira estado depois de reconhecida (RNF-011). */
  private toResult(payload: ProviderPayload, context: ProviderContext): ProviderResult {
    const status = STATUS_MAP[String(payload.status ?? '').toUpperCase()];
    if (!status) {
      throw new ProviderError(
        `Resposta de ${context.providerCode} com situação desconhecida.`,
        'RESPOSTA_INVALIDA',
        false,
      );
    }
    return {
      status,
      externalId: typeof payload.id === 'string' ? payload.id : undefined,
      endToEndId: typeof payload.endToEndId === 'string' ? payload.endToEndId : undefined,
      errorCode: typeof payload.errorCode === 'string' ? payload.errorCode : undefined,
      errorMessage: typeof payload.message === 'string' ? payload.message : undefined,
      raw: payload,
    };
  }

  /**
   * Valida o destino antes de chamar (SSRF).
   *
   * Três barreiras: só HTTPS (fora de desenvolvimento), host em allowlist quando
   * `INTEGRATION_ALLOWED_HOSTS` está definido, e nunca endereço de loopback,
   * link-local ou rede privada — que é como um `baseUrl` cadastrado alcançaria o
   * metadata service da nuvem ou um serviço interno.
   */
  private resolveUrl(context: ProviderContext, path: string): string {
    const baseUrl = context.credentials.baseUrl;
    if (!baseUrl) {
      throw new ProviderError(
        `A credencial de ${context.providerCode} não informa a URL do provedor.`,
        'CREDENCIAL_INCOMPLETA',
        false,
      );
    }

    let url: URL;
    try {
      url = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    } catch {
      throw new ProviderError(
        `A credencial de ${context.providerCode} tem URL inválida.`,
        'CREDENCIAL_INVALIDA',
        false,
      );
    }

    if (url.protocol !== 'https:' && !(this.allowInsecure && url.protocol === 'http:')) {
      throw new ProviderError('A integração exige HTTPS.', 'DESTINO_INVALIDO', false);
    }

    const host = url.hostname.toLowerCase();
    if (this.allowedHosts.length > 0 && !this.allowedHosts.includes(host)) {
      throw new ProviderError(
        `Destino ${host} não está na lista de hosts permitidos.`,
        'DESTINO_NAO_PERMITIDO',
        false,
      );
    }
    if (isPrivateHost(host)) {
      throw new ProviderError(
        'A integração não pode apontar para um endereço interno.',
        'DESTINO_INVALIDO',
        false,
      );
    }

    return url.toString();
  }
}

/**
 * Endereço que não deve ser alcançado a partir de uma credencial cadastrada.
 *
 * A checagem é sobre o host literal — resolução de DNS pode mudar entre a
 * validação e a chamada (rebinding). Por isso a allowlist de hosts é o controle
 * principal em produção, e esta função é o piso mínimo quando ela não existe.
 */
function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return true;
  }
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (isIP(host) === 6) {
    const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fe80') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd')
    );
  }
  return false;
}
