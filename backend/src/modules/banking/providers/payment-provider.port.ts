import { PaymentMethodType, TransactionDirection } from '@prisma/client';

/**
 * Porta dos provedores financeiros (RF-061, RNF-011).
 *
 * A regra de negócio conversa com esta interface, nunca com um banco
 * específico: quem decide se um pagamento pode ser criado, agendado ou
 * cancelado é `PaymentTransactionsService`, e o adaptador só sabe falar HTTP com
 * o outro lado. Trocar de banco é registrar outro adaptador.
 *
 * Valores trafegam como **string decimal**, jamais como `number`: o dinheiro sai
 * de `Prisma.Decimal` e só vira texto — ponto flutuante não entra no caminho.
 */

/** O que o provedor sabe fazer — vem de `provider.capacidades` (jsonb). */
export interface ProviderCapabilities {
  pix?: boolean;
  boleto?: boolean;
  ted?: boolean;
  doc?: boolean;
  transferencia_interna?: boolean;
  /** RF-065: cancelar depois de enviado. */
  cancelamento?: boolean;
  /** RF-066: o provedor notifica em vez de a gente perguntar. */
  webhook?: boolean;
  /** RF-064: consulta de situação por identificador externo. */
  consulta?: boolean;
}

/** Conta de origem — de onde o dinheiro sai (RF-059). */
export interface ProviderAccount {
  id: string;
  bankCode: string;
  agency: string;
  account: string;
  accountDigit?: string | null;
  pixKey?: string | null;
}

/** Destino do pagamento, já validado pelo domínio. */
export interface ProviderPayee {
  name?: string | null;
  document?: string | null;
  bankCode?: string | null;
  agency?: string | null;
  account?: string | null;
  pixKey?: string | null;
  barcode?: string | null;
}

export interface PaymentOrder {
  transactionId: string;
  /** RF-067: repassada ao provedor, para que o retry lá também não duplique. */
  idempotencyKey: string;
  direction: TransactionDirection;
  method: PaymentMethodType;
  /** Decimal em texto, com duas casas. */
  amount: string;
  description?: string | null;
  /** ISO `YYYY-MM-DD` quando agendado (RF-063). */
  scheduledFor?: string | null;
  account: ProviderAccount;
  payee: ProviderPayee;
}

/** Situação devolvida pelo provedor, no vocabulário do domínio. */
export type ProviderStatus = 'ENVIADA' | 'PROCESSANDO' | 'CONFIRMADA' | 'FALHA' | 'CANCELADA';

export interface ProviderResult {
  status: ProviderStatus;
  /** RF-068: id da operação no provedor. */
  externalId?: string;
  endToEndId?: string;
  errorCode?: string;
  errorMessage?: string;
  /** Resposta crua, já sem credenciais — vai para `payload_retorno`. */
  raw?: Record<string, unknown>;
}

/** Credencial decifrada da empresa para aquele provedor (RNF-003). */
export interface ProviderCredentials {
  baseUrl?: string;
  apiKey?: string;
  clientId?: string;
  webhookSecret?: string;
  [key: string]: unknown;
}

export interface ProviderContext {
  companyId: string;
  providerCode: string;
  capabilities: ProviderCapabilities;
  credentials: ProviderCredentials;
  environment: string;
}

export interface PaymentProvider {
  /** Código em `gestao.provider.codigo`. */
  readonly code: string;

  /**
   * Se o adaptador precisa de credencial para operar.
   *
   * Nem todo provedor fala com alguém: o adaptador manual registra a ordem e
   * para aí. Exigir credencial dele impediria de usar o módulo sem integração
   * bancária contratada — que é o estado inicial de toda empresa.
   */
  readonly requiresCredentials: boolean;

  /** Envia a ordem (RF-064). */
  send(order: PaymentOrder, context: ProviderContext): Promise<ProviderResult>;

  /** Consulta a situação de uma ordem já enviada (RF-064). */
  query(externalId: string, context: ProviderContext): Promise<ProviderResult>;

  /** Cancela, quando o provedor suporta (RF-065). */
  cancel(externalId: string, reason: string, context: ProviderContext): Promise<ProviderResult>;

  /**
   * Confere a assinatura do webhook (RF-066). Recebe o corpo **cru**: recalcular
   * o HMAC sobre o JSON reserializado daria resultado diferente do assinado.
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    signature: string | undefined,
    context: ProviderContext,
  ): boolean;

  /**
   * Traduz o corpo do webhook para o vocabulário do domínio (RF-066).
   *
   * Fica no adaptador, e não no processador, porque é aqui que o dialeto do
   * provedor termina: nomes de campo e de status são dele. Devolve `null` quando
   * o evento não diz respeito a uma ordem de pagamento — notificação de extrato,
   * aviso de manutenção, teste de configuração.
   */
  parseWebhookEvent(payload: Record<string, unknown>): ParsedWebhookEvent | null;
}

export interface ParsedWebhookEvent {
  /** Identificador do evento no provedor — chave de deduplicação (RN-005). */
  eventId?: string;
  eventType: string;
  /** Identificador da ordem no provedor (RF-068). */
  externalId?: string;
  /** Chave de idempotência devolvida pelo provedor, quando ele a ecoa. */
  idempotencyKey?: string;
  result: ProviderResult;
}

/**
 * Falha vinda do provedor, já classificada.
 *
 * `retryable` é o que separa "o banco está fora" de "o banco recusou": o
 * primeiro volta para a fila, o segundo encerra a transação em FALHA (RF-070).
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
