import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CircuitBreaker } from '../../../common/http/circuit-breaker';
import {
  OutboundUrlError,
  outboundUrlOptions,
  resolveOutboundUrl,
} from '../../../common/http/outbound-url';
import { FiscalEventStatus } from '../../../common/enums';
import {
  FiscalContext,
  FiscalProvider,
  FiscalProviderError,
  FiscalTransmissionRequest,
  FiscalTransmissionResult,
} from './fiscal-provider.port';

/** Código em `gestao.provider.codigo`. */
export const HTTP_FISCAL_PROVIDER_CODE = 'SEFAZ_GENERICO';

/** Códigos HTTP que melhoram sozinhos com o tempo. */
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Situações que o provedor pode devolver. */
const ACCEPTED_STATUS = new Set<string>([
  FiscalEventStatus.TRANSMITIDO,
  FiscalEventStatus.AUTORIZADO,
  FiscalEventStatus.REJEITADO,
]);

interface FiscalPayload {
  status?: unknown;
  protocol?: unknown;
  message?: unknown;
  errorCode?: unknown;
  [key: string]: unknown;
}

/**
 * Adaptador HTTP genérico para emissores fiscais REST (RF-094, RNF-011).
 *
 * Os mesmos controles do adaptador bancário e do de OCR, pelas mesmas razões:
 *
 *  - **timeout** em toda chamada — um serviço lento prenderia a conexão de banco
 *    do job até o timeout do pool;
 *  - **idempotência repassada**: o id do evento vai como chave, e o retry da
 *    fila recebe de volta o mesmo protocolo em vez de gerar um segundo evento no
 *    fisco. Aqui isso não é economia, é correção — duas autorizações do mesmo
 *    cancelamento são uma autorização que não existe;
 *  - **disjuntor** por empresa+provedor: serviço fora para de ser chamado;
 *  - **destino validado** (`common/http/outbound-url`) — a URL vem da credencial
 *    cadastrada, e cadastro é entrada de usuário (SSRF);
 *  - **resposta validada** antes de virar estado: status desconhecido, ou
 *    autorização sem protocolo, viram erro — não "evento autorizado".
 *
 * O retry **não** está aqui: é da fila (RF-070), que já tem backoff, teto e
 * registro de tentativas.
 */
@Injectable()
export class HttpFiscalProvider implements FiscalProvider {
  readonly code = HTTP_FISCAL_PROVIDER_CODE;
  readonly requiresCredentials = true;
  readonly canTransmit = true;

  private readonly logger = new Logger(HttpFiscalProvider.name);
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

  async transmit(
    request: FiscalTransmissionRequest,
    context: FiscalContext,
  ): Promise<FiscalTransmissionResult> {
    const url = this.resolveUrl(context, '/eventos');
    const circuitKey = `${context.companyId}:${context.providerCode}`;

    if (this.breaker.check(circuitKey) === 'ABERTO') {
      throw new FiscalProviderError(
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
          'idempotency-key': request.eventId,
        },
        body: JSON.stringify({
          idempotencyKey: request.eventId,
          type: request.type,
          sequence: request.sequence ?? undefined,
          accessKey: request.accessKey ?? undefined,
          documentNumber: request.documentNumber ?? undefined,
          justification: request.justification ?? undefined,
          xml: request.xmlContent ?? undefined,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      this.breaker.recordFailure(circuitKey);
      // A mensagem do fetch pode conter a URL, e a URL é cadastro da empresa:
      // fica no log do servidor, não na exceção que sobe.
      this.logger.warn(`Falha de rede em ${context.providerCode}: ${String(error)}`);
      throw new FiscalProviderError(
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
      throw new FiscalProviderError(
        typeof payload.message === 'string'
          ? payload.message
          : `Provedor ${context.providerCode} recusou o evento.`,
        typeof payload.errorCode === 'string' ? payload.errorCode : `HTTP_${response.status}`,
        retryable,
      );
    }

    this.breaker.recordSuccess(circuitKey);
    return this.toResult(payload, context);
  }

  private async parseBody(response: Response): Promise<FiscalPayload> {
    try {
      const parsed: unknown = await response.json();
      return parsed && typeof parsed === 'object' ? (parsed as FiscalPayload) : {};
    } catch {
      return {};
    }
  }

  /** Resposta só vira estado depois de reconhecida (RNF-011). */
  private toResult(payload: FiscalPayload, context: FiscalContext): FiscalTransmissionResult {
    const status = typeof payload.status === 'string' ? payload.status.toUpperCase() : '';
    if (!ACCEPTED_STATUS.has(status)) {
      throw new FiscalProviderError(
        `Resposta de ${context.providerCode} com situação desconhecida.`,
        'RESPOSTA_INVALIDA',
        false,
      );
    }

    const protocol = typeof payload.protocol === 'string' ? payload.protocol.trim() : undefined;
    const settled =
      status === FiscalEventStatus.AUTORIZADO || status === FiscalEventStatus.REJEITADO;

    if (settled && !protocol) {
      throw new FiscalProviderError(
        `Resposta de ${context.providerCode} sem protocolo: resposta do fisco sem protocolo não é resposta.`,
        'RESPOSTA_INVALIDA',
        false,
      );
    }

    // O corpo cru é guardado (RF-092), sem o XML devolvido: é o mesmo conteúdo
    // que já está na coluna do evento, e duplicá-lo dobra a linha da tabela.
    const raw = { ...payload };
    delete raw.xml;

    return {
      status: status as FiscalEventStatus,
      protocol,
      message: typeof payload.message === 'string' ? payload.message : undefined,
      raw,
    };
  }

  /** Valida o destino antes de chamar (SSRF) — controle em `common/http`. */
  private resolveUrl(context: FiscalContext, path: string): string {
    try {
      return resolveOutboundUrl(context.credentials.baseUrl, path, this.outbound);
    } catch (error) {
      if (error instanceof OutboundUrlError) {
        throw new FiscalProviderError(
          `${error.message} (${context.providerCode})`,
          error.code,
          false,
        );
      }
      throw error;
    }
  }
}
