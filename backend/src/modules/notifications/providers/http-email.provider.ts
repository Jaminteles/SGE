import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CircuitBreaker } from '../../../common/http/circuit-breaker';
import {
  OutboundUrlError,
  outboundUrlOptions,
  resolveOutboundUrl,
} from '../../../common/http/outbound-url';
import {
  EmailContext,
  EmailMessage,
  EmailProvider,
  EmailProviderError,
  EmailResult,
} from './email-provider.port';

/** Código em `gestao.provider.codigo` (bd/16 §9). */
export const HTTP_EMAIL_PROVIDER_CODE = 'EMAIL_GENERICO';

/** Códigos HTTP que melhoram sozinhos com o tempo. */
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

interface EmailPayload {
  id?: unknown;
  messageId?: unknown;
  message?: unknown;
  errorCode?: unknown;
  [key: string]: unknown;
}

/**
 * Adaptador HTTP genérico para serviços REST de e-mail (RF-120, RNF-011).
 *
 * Os mesmos controles dos adaptadores bancário e de OCR, pelas mesmas razões:
 * timeout em toda chamada, idempotência repassada (o retry da fila não pode
 * fazer o destinatário receber o mesmo aviso cinco vezes), disjuntor por
 * empresa+provedor e destino validado contra SSRF — a URL vem da credencial
 * cadastrada, e cadastro é entrada de usuário.
 *
 * O retry **não** está aqui: é da fila (RF-070), que já tem backoff e teto.
 *
 * O remetente vem da credencial, nunca do corpo da requisição: deixar o cliente
 * escolher o `from` transformaria o módulo em relay de e-mail com o domínio (e
 * a reputação) da empresa que contratou o serviço.
 */
@Injectable()
export class HttpEmailProvider implements EmailProvider {
  readonly code = HTTP_EMAIL_PROVIDER_CODE;
  readonly requiresCredentials = true;

  private readonly logger = new Logger(HttpEmailProvider.name);
  private readonly timeoutMs: number;
  private readonly outbound: ReturnType<typeof outboundUrlOptions>;
  private readonly breaker: CircuitBreaker;

  constructor(config: ConfigService) {
    this.timeoutMs = config.get<number>('INTEGRATION_HTTP_TIMEOUT_MS') ?? 10_000;
    this.outbound = outboundUrlOptions((key) => config.get<string>(key));
    this.breaker = new CircuitBreaker({
      failureThreshold: config.get<number>('INTEGRATION_CIRCUIT_THRESHOLD') ?? 5,
      openMs: config.get<number>('INTEGRATION_CIRCUIT_OPEN_MS') ?? 60_000,
    });
  }

  async send(message: EmailMessage, context: EmailContext): Promise<EmailResult> {
    const url = this.resolveUrl(context, '/messages');
    const circuitKey = `${context.companyId}:${context.providerCode}`;

    if (this.breaker.check(circuitKey) === 'ABERTO') {
      throw new EmailProviderError(
        `Integração com ${context.providerCode} temporariamente suspensa após falhas seguidas.`,
        'CIRCUITO_ABERTO',
        true,
      );
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(context.credentials.apiKey
            ? { authorization: `Bearer ${context.credentials.apiKey}` }
            : {}),
          'idempotency-key': message.notificationId,
        },
        body: JSON.stringify({
          idempotencyKey: message.notificationId,
          from: context.credentials.from,
          to: message.to,
          subject: message.subject,
          text: message.body,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      this.breaker.recordFailure(circuitKey);
      // A mensagem do fetch pode conter a URL, e a URL é cadastro da empresa:
      // fica no log do servidor, não na exceção que sobe.
      this.logger.warn(`Falha de rede em ${context.providerCode}: ${String(error)}`);
      throw new EmailProviderError(
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
      throw new EmailProviderError(
        typeof payload.message === 'string'
          ? payload.message
          : `Provedor ${context.providerCode} recusou a mensagem.`,
        typeof payload.errorCode === 'string' ? payload.errorCode : `HTTP_${response.status}`,
        retryable,
      );
    }

    this.breaker.recordSuccess(circuitKey);

    const externalId = [payload.id, payload.messageId].find((value) => typeof value === 'string');
    return {
      delivered: true,
      externalId: typeof externalId === 'string' ? externalId.slice(0, 140) : undefined,
    };
  }

  private async parseBody(response: Response): Promise<EmailPayload> {
    try {
      const parsed: unknown = await response.json();
      return parsed && typeof parsed === 'object' ? (parsed as EmailPayload) : {};
    } catch {
      return {};
    }
  }

  /** Valida o destino antes de chamar (SSRF) — controle em `common/http`. */
  private resolveUrl(context: EmailContext, path: string): string {
    try {
      return resolveOutboundUrl(context.credentials.baseUrl, path, this.outbound);
    } catch (error) {
      if (error instanceof OutboundUrlError) {
        throw new EmailProviderError(
          `${error.message} (${context.providerCode})`,
          error.code,
          false,
        );
      }
      throw error;
    }
  }
}
