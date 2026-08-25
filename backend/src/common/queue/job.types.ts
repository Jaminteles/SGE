/**
 * Contrato da fila (RF-069/RF-070, RN-011).
 *
 * O handler recebe o payload e a empresa do job e devolve nada: quem grava o
 * resultado é ele, na mesma transação em que o job é fechado. Lançar é sinalizar
 * falha — o runner decide entre reagendar e desistir (RF-070).
 */

/** Filas conhecidas. Uma por natureza de trabalho, não uma por handler. */
export const QUEUES = {
  /** Ordens de pagamento: envio, consulta e cancelamento junto ao provedor. */
  PAYMENTS: 'pagamentos',
  /** Notificações recebidas de provedores financeiros. */
  WEBHOOKS: 'webhooks',
  /** Conciliação bancária em lote (RF-075). */
  RECONCILIATION: 'conciliacao',
  /** Leitura automática de documentos (RF-096). */
  OCR: 'ocr',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobContext {
  jobId: string;
  companyId?: string;
  /** Tentativa corrente, começando em 1. */
  attempt: number;
  maxAttempts: number;
  correlationId?: string;
}

export interface JobHandler {
  /** Nome do job — chave do registro e coluna `job_execucao.nome`. */
  readonly name: string;
  readonly queue: QueueName;
  handle(payload: Record<string, unknown>, context: JobContext): Promise<void>;
}

/**
 * Erro que não melhora com repetição: credencial inválida, valor recusado,
 * recurso que não existe mais. O runner marca FALHA na hora, sem gastar as
 * tentativas restantes (RF-070).
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}
