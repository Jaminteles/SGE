import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OutboundUrlError,
  outboundUrlOptions,
  resolveOutboundUrl,
} from '../../../common/http/outbound-url';
import { CircuitBreaker } from '../../../common/http/circuit-breaker';
import {
  OcrContext,
  OcrProvider,
  OcrProviderError,
  OcrRequest,
  OcrResult,
} from './ocr-provider.port';

/** Código em `gestao.provider.codigo` (bd/03). */
export const HTTP_OCR_PROVIDER_CODE = 'OCR_GENERICO';

/** Códigos HTTP que melhoram sozinhos com o tempo. */
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Confiança aceita: 0 a 100, com até duas casas. */
const CONFIDENCE_PATTERN = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;

/** Teto do texto guardado. Um PDF longo devolve megabytes de texto. */
const MAX_TEXT_LENGTH = 200_000;

interface OcrPayload {
  text?: unknown;
  confidence?: unknown;
  [key: string]: unknown;
}

/**
 * Adaptador HTTP genérico para serviços de OCR REST (RF-096, RNF-011).
 *
 * Os mesmos controles do adaptador bancário, pelas mesmas razões:
 *
 *  - **timeout** em toda chamada — um serviço lento prenderia a conexão de
 *    banco do job até o timeout do pool;
 *  - **idempotência repassada**, para que o retry da fila não faça o serviço
 *    cobrar duas leituras do mesmo arquivo;
 *  - **disjuntor** por empresa+provedor: serviço fora para de ser chamado;
 *  - **destino validado** (`common/http/outbound-url`) — a URL vem da
 *    credencial cadastrada, e cadastro é entrada de usuário;
 *  - **resposta validada** antes de virar estado: confiança fora da faixa ou
 *    texto que não é texto viram erro, não "leitura feita".
 *
 * O arquivo vai como base64 em JSON, e não como multipart, porque o corpo é
 * pequeno (o upload já é limitado a `UPLOAD_MAX_BYTES`) e assim o adaptador não
 * precisa de nenhuma biblioteca a mais.
 *
 * O retry **não** está aqui: é da fila (RF-070), que já tem backoff, teto e
 * registro de tentativas. Repetir nos dois lugares multiplicaria as chamadas.
 */
@Injectable()
export class HttpOcrProvider implements OcrProvider {
  readonly code = HTTP_OCR_PROVIDER_CODE;
  readonly requiresCredentials = true;

  private readonly logger = new Logger(HttpOcrProvider.name);
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

  async extract(request: OcrRequest, context: OcrContext): Promise<OcrResult> {
    const url = this.resolveUrl(context, '/ocr');
    const circuitKey = `${context.companyId}:${context.providerCode}`;

    if (this.breaker.check(circuitKey) === 'ABERTO') {
      throw new OcrProviderError(
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
          'idempotency-key': request.processingId,
        },
        body: JSON.stringify({
          idempotencyKey: request.processingId,
          fileName: request.fileName,
          mimeType: request.mimeType,
          content: request.content.toString('base64'),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      this.breaker.recordFailure(circuitKey);
      // A mensagem do fetch pode conter a URL, e a URL é cadastro da empresa:
      // fica no log do servidor, não na exceção que sobe.
      this.logger.warn(`Falha de rede em ${context.providerCode}: ${String(error)}`);
      throw new OcrProviderError(
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
      throw new OcrProviderError(
        typeof payload.message === 'string'
          ? payload.message
          : `Provedor ${context.providerCode} recusou o documento.`,
        typeof payload.errorCode === 'string' ? payload.errorCode : `HTTP_${response.status}`,
        retryable,
      );
    }

    this.breaker.recordSuccess(circuitKey);
    return this.toResult(payload, context);
  }

  private async parseBody(response: Response): Promise<OcrPayload> {
    try {
      const parsed: unknown = await response.json();
      return parsed && typeof parsed === 'object' ? (parsed as OcrPayload) : {};
    } catch {
      return {};
    }
  }

  /** Resposta só vira estado depois de reconhecida (RNF-011). */
  private toResult(payload: OcrPayload, context: OcrContext): OcrResult {
    if (typeof payload.text !== 'string') {
      throw new OcrProviderError(
        `Resposta de ${context.providerCode} sem o texto reconhecido.`,
        'RESPOSTA_INVALIDA',
        false,
      );
    }

    const confidence = this.readConfidence(payload.confidence, context);

    // O payload cru é guardado (RF-100), mas sem o texto duplicado dentro dele:
    // são duas cópias do mesmo megabyte em toda linha da tabela.
    const raw = { ...payload };
    delete raw.text;

    return {
      text: payload.text.slice(0, MAX_TEXT_LENGTH),
      confidence,
      raw,
    };
  }

  private readConfidence(value: unknown, context: OcrContext): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    // Aceita número e string: os dois aparecem em serviços reais. A conversão é
    // para texto, e a validação é sobre o texto — o `numeric(5,2)` do banco
    // recusaria o resto, e recusar aqui dá mensagem em vez de 500.
    const text = typeof value === 'number' ? value.toFixed(2) : String(value);
    if (!CONFIDENCE_PATTERN.test(text)) {
      throw new OcrProviderError(
        `Resposta de ${context.providerCode} com confiança fora da faixa 0..100.`,
        'RESPOSTA_INVALIDA',
        false,
      );
    }
    return text;
  }

  /** Valida o destino antes de chamar (SSRF) — controle em `common/http`. */
  private resolveUrl(context: OcrContext, path: string): string {
    try {
      return resolveOutboundUrl(context.credentials.baseUrl, path, this.outbound);
    } catch (error) {
      if (error instanceof OutboundUrlError) {
        throw new OcrProviderError(`${error.message} (${context.providerCode})`, error.code, false);
      }
      throw error;
    }
  }
}
