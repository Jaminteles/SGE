/**
 * Porta dos provedores de e-mail (RF-120, RNF-011).
 *
 * Mesma forma das portas do M09 e do M13: o módulo conversa com esta interface,
 * nunca com um serviço específico. Quem decide *o que* avisar é o M17; o
 * adaptador só sabe entregar uma mensagem já escrita.
 *
 * Não há anexo nem HTML aqui de propósito. O corpo de um aviso é uma frase e um
 * link para o sistema — mandar o documento por e-mail tiraria o dado de dentro
 * do controle de acesso que o resto do sistema aplica.
 */

/** O que o provedor sabe fazer — vem de `provider.capacidades` (jsonb). */
export interface EmailCapabilities {
  email?: boolean;
  anexos?: boolean;
}

/** Credencial decifrada da empresa para aquele provedor (RNF-003). */
export interface EmailCredentials {
  baseUrl?: string;
  apiKey?: string;
  /** Remetente cadastrado no serviço. Nunca vem do cliente da API. */
  from?: string;
  [key: string]: unknown;
}

export interface EmailContext {
  companyId: string;
  providerCode: string;
  capabilities: EmailCapabilities;
  credentials: EmailCredentials;
  environment: string;
}

export interface EmailMessage {
  /** Id da notificação — vira chave de idempotência no serviço de envio. */
  notificationId: string;
  to: string;
  subject: string;
  /** Texto puro. O aviso é uma frase e, quando há, um link. */
  body: string;
}

export interface EmailResult {
  /** Id da mensagem no provedor, quando ele devolve um. */
  externalId?: string;
  /** Falso no adaptador que não envia nada — registra a tentativa e para. */
  delivered: boolean;
}

export interface EmailProvider {
  /** Código em `gestao.provider.codigo`. */
  readonly code: string;
  readonly requiresCredentials: boolean;

  send(message: EmailMessage, context: EmailContext): Promise<EmailResult>;
}

/**
 * Falha vinda do provedor, já classificada.
 *
 * `retryable` separa "o serviço está fora" de "o endereço não existe": o
 * primeiro volta para a fila com backoff, o segundo encerra a notificação em
 * FALHA na hora — reenviar para um endereço inválido não melhora na quinta vez.
 */
export class EmailProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EmailProviderError';
  }
}
