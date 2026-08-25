/**
 * Porta dos provedores de OCR (RF-096, RNF-011).
 *
 * O módulo conversa com esta interface, nunca com um serviço específico: quem
 * decide o que fazer com a leitura é `OcrProcessingService`, e o adaptador só
 * sabe transformar bytes em texto. Trocar de fornecedor é registrar outro
 * adaptador — nenhuma regra de negócio muda.
 *
 * Confiança trafega como **string decimal**: é um número que decide se a
 * interface apresenta a leitura como certa, e ponto flutuante não entra no
 * caminho de nada que decida (RN-012).
 */

/** O que o provedor sabe fazer — vem de `provider.capacidades` (jsonb). */
export interface OcrCapabilities {
  pdf?: boolean;
  imagem?: boolean;
  /** Falso no adaptador manual: não há leitura automática nenhuma. */
  automatico?: boolean;
}

/** Credencial decifrada da empresa para aquele provedor (RNF-003). */
export interface OcrCredentials {
  baseUrl?: string;
  apiKey?: string;
  [key: string]: unknown;
}

export interface OcrContext {
  companyId: string;
  providerCode: string;
  capabilities: OcrCapabilities;
  credentials: OcrCredentials;
  environment: string;
}

/** O documento a ler. O binário vem do storage, não do cliente. */
export interface OcrRequest {
  /** Id do processamento — repassado como chave de idempotência ao provedor. */
  processingId: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
}

export interface OcrResult {
  /**
   * Texto reconhecido. Vazio quando o adaptador não lê (manual) — e aí o
   * documento segue direto para a revisão humana (RF-099).
   */
  text: string;
  /** Confiança global de 0 a 100, em decimal textual. Ausente quando não há. */
  confidence?: string;
  /** Resposta crua, já sem credenciais — vai para `payload_bruto`. */
  raw?: Record<string, unknown>;
}

export interface OcrProvider {
  /** Código em `gestao.provider.codigo`. */
  readonly code: string;

  /**
   * Se o adaptador precisa de credencial para operar.
   *
   * O manual não fala com ninguém: exigir credencial dele impediria de usar o
   * módulo sem OCR contratado — que é o estado inicial de toda empresa.
   */
  readonly requiresCredentials: boolean;

  extract(request: OcrRequest, context: OcrContext): Promise<OcrResult>;
}

/**
 * Falha vinda do provedor, já classificada.
 *
 * `retryable` é o que separa "o serviço está fora" de "o serviço recusou o
 * arquivo": o primeiro volta para a fila com backoff, o segundo encerra o
 * processamento em ERRO na hora (RF-070/RF-096).
 */
export class OcrProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'OcrProviderError';
  }
}
