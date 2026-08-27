import { FiscalEventStatus, FiscalEventType, TaxClassificationType } from '../../common/enums';

/**
 * Formato do código de cada tipo de classificação (RF-089).
 *
 * Os mesmos padrões estão no CHECK de bd/18 §3. A duplicação é proposital: aqui
 * o código malformado vira 400 com mensagem, e não 500 de violação de restrição.
 */
export const CLASSIFICATION_CODE_PATTERN: Record<TaxClassificationType, RegExp> = {
  [TaxClassificationType.NCM]: /^\d{8}$/,
  [TaxClassificationType.CEST]: /^\d{7}$/,
  [TaxClassificationType.CFOP]: /^[1-7]\d{3}$/,
  [TaxClassificationType.CST]: /^\d{2,4}$/,
  [TaxClassificationType.LC116]: /^\d{2}\.\d{2}$/,
};

/** CFOP de operação, usado tanto na regra fiscal quanto no filtro do livro. */
export const CFOP_PATTERN = /^[1-7]\d{3}$/;

/** UF de origem e destino da regra fiscal — `dom_uf` é `char(2)` maiúsculo. */
export const UF_PATTERN = /^[A-Z]{2}$/;

/**
 * Tamanho mínimo da justificativa de cancelamento e carta de correção (RF-092).
 *
 * É o mínimo do layout da SEFAZ. Vale repetir aqui porque "por que esta nota foi
 * cancelada" é a única pergunta que sobra depois, e um motivo de três letras não
 * a responde.
 */
export const MIN_JUSTIFICATION_LENGTH = 15;

/** Eventos que exigem justificativa (RF-092). */
export const JUSTIFIED_EVENTS: FiscalEventType[] = [
  FiscalEventType.CANCELAMENTO,
  FiscalEventType.CCE,
];

/**
 * Situações em que o evento ainda pode ser transmitido (RF-092/RF-094).
 *
 * `TRANSMITIDO` entra: a transmissão que não recebeu resposta pode ser repetida,
 * e é o provedor quem devolve o mesmo protocolo pela chave de idempotência.
 * `AUTORIZADO` e `REJEITADO` ficam de fora — resposta do fisco não se revisa por
 * retentativa nossa.
 */
export const TRANSMITTABLE: FiscalEventStatus[] = [
  FiscalEventStatus.REGISTRADO,
  FiscalEventStatus.TRANSMITIDO,
];

/** Sequência máxima de evento por documento, pelo layout da SEFAZ. */
export const MAX_EVENT_SEQUENCE = 20;

/** Nome do job de transmissão na fila (RF-094). */
export const FISCAL_JOBS = {
  TRANSMIT_EVENT: 'fiscal.transmitir-evento',
} as const;
