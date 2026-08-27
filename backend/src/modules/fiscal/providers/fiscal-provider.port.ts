import { FiscalEventStatus, FiscalEventType } from '../../../common/enums';

/**
 * Porta dos provedores fiscais (RF-094, RNF-011).
 *
 * O módulo conversa com esta interface, nunca com um serviço específico: quem
 * decide o que fazer com a resposta é `FiscalTransmissionService`, e o adaptador
 * só sabe levar o evento até o provedor e trazer o retorno. Trocar de emissor é
 * registrar outro adaptador — nenhuma regra de negócio muda.
 */

/** O que o provedor sabe fazer — vem de `provider.capacidades` (jsonb). */
export interface FiscalCapabilities {
  /** Transmite eventos (cancelamento, CC-e, manifestação). */
  evento?: boolean;
  /** Falso no adaptador manual: não há transmissão automática nenhuma. */
  automatico?: boolean;
}

/** Credencial decifrada da empresa para aquele provedor (RNF-003). */
export interface FiscalCredentials {
  baseUrl?: string;
  apiKey?: string;
  [key: string]: unknown;
}

export interface FiscalContext {
  companyId: string;
  providerCode: string;
  capabilities: FiscalCapabilities;
  credentials: FiscalCredentials;
  environment: string;
}

/** O evento a transmitir. Nada aqui vem do cliente HTTP: tudo é lido do banco. */
export interface FiscalTransmissionRequest {
  /** Id do evento — repassado como chave de idempotência ao provedor. */
  eventId: string;
  type: FiscalEventType;
  sequence?: number | null;
  /** Chave de acesso da nota; ausente na inutilização. */
  accessKey?: string | null;
  documentNumber?: string | null;
  justification?: string | null;
  xmlContent?: string | null;
}

export interface FiscalTransmissionResult {
  /**
   * `TRANSMITIDO` é "o provedor recebeu e ainda não há resposta do fisco".
   * `AUTORIZADO`/`REJEITADO` exigem protocolo — resposta do fisco sem protocolo
   * não é resposta, e o banco recusa (bd/18 §6).
   */
  status: FiscalEventStatus;
  protocol?: string;
  message?: string;
  /** Resposta crua, já sem credenciais — vai para `retorno`. */
  raw?: Record<string, unknown>;
}

export interface FiscalProvider {
  /** Código em `gestao.provider.codigo`. */
  readonly code: string;

  /** Se o adaptador precisa de credencial para operar. */
  readonly requiresCredentials: boolean;

  /**
   * Se o adaptador fala com o fisco.
   *
   * Falso no manual: a empresa que transmite pelo emissor da contabilidade
   * registra o evento aqui e lança o protocolo a mão. Enfileirar transmissão
   * nesse caso seria criar um job que nunca poderia dar certo.
   */
  readonly canTransmit: boolean;

  transmit(
    request: FiscalTransmissionRequest,
    context: FiscalContext,
  ): Promise<FiscalTransmissionResult>;
}

/**
 * Falha vinda do provedor, já classificada.
 *
 * `retryable` separa "o serviço está fora" de "o fisco recusou o evento": o
 * primeiro volta para a fila com backoff, o segundo encerra o evento como
 * REJEITADO na hora (RF-070/RF-092).
 */
export class FiscalProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'FiscalProviderError';
  }
}
