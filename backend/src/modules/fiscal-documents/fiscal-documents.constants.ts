import { FiscalDocumentStatus } from '@prisma/client';

/** Máximo de itens de uma NF-e pelo layout da SEFAZ. */
export const MAX_ITEMS_PER_DOCUMENT = 990;

/**
 * Tolerância na conferência de valores (RF-045).
 *
 * O XML traz valores já arredondados pelo emitente: centavos de arredondamento
 * por linha são normais, diferença real não é. A tolerância do documento cresce
 * com o número de itens porque é assim que o erro de arredondamento se acumula.
 * Os mesmos números estão em bd/12 — a duplicação é proposital: aqui a
 * divergência vira status ERRO com mensagem, e não 500 de violação de regra.
 */
export const LINE_TOLERANCE = '0.02';
export const DOCUMENT_TOLERANCE_PER_ITEM = '0.01';
export const DOCUMENT_TOLERANCE_BASE = '0.01';

/** `documento.entidade` das linhas de anexo de uma nota (RF-048). */
export const FISCAL_ATTACHMENT_ENTITY = 'documento_fiscal';

/** `documento.categoria` — DANFE é o espelho da nota; ANEXO é o resto. */
export const FISCAL_ATTACHMENT_CATEGORIES = ['DANFE', 'ANEXO'] as const;
export type FiscalAttachmentCategory = (typeof FISCAL_ATTACHMENT_CATEGORIES)[number];

/** Pasta do storage onde os anexos da nota ficam. */
export const FISCAL_ATTACHMENT_SCOPE = 'documentos-fiscais';

/** Situações em que o documento ainda pode ser reprocessado (RF-049). */
export const REPROCESSABLE: FiscalDocumentStatus[] = [
  FiscalDocumentStatus.RECEBIDO,
  FiscalDocumentStatus.ERRO,
];

/** Situações que ainda aceitam vínculo e anexo (RF-047/RF-048). */
export const LINKABLE: FiscalDocumentStatus[] = [
  FiscalDocumentStatus.RECEBIDO,
  FiscalDocumentStatus.PROCESSANDO,
  FiscalDocumentStatus.PROCESSADO,
  FiscalDocumentStatus.ERRO,
];
