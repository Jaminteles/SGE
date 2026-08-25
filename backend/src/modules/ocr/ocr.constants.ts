import { OcrStatus } from '@prisma/client';

/** `documento.entidade` das linhas enviadas para leitura automática (RF-095). */
export const OCR_DOCUMENT_ENTITY = 'ocr_processamento';

/** `documento.categoria` — o que o arquivo é para quem o enviou. */
export const OCR_DOCUMENT_CATEGORIES = ['COMPROVANTE', 'NOTA', 'BOLETO', 'OUTRO'] as const;
export type OcrDocumentCategory = (typeof OCR_DOCUMENT_CATEGORIES)[number];

/** Pasta do storage onde os documentos de OCR ficam. */
export const OCR_STORAGE_SCOPE = 'ocr';

/** Nome do job de leitura na fila (RF-096). */
export const OCR_JOBS = {
  PROCESS: 'ocr.processar',
} as const;

/**
 * Situações em que o processamento ainda pode voltar para a fila (RF-096).
 *
 * `PROCESSADO` fica de fora de propósito: reprocessar um resultado já lido
 * substituiria o texto que a revisão humana está olhando. Quem discorda de um
 * resultado o rejeita (RF-099) e envia o documento de novo.
 */
export const REPROCESSABLE: OcrStatus[] = [OcrStatus.ERRO];

/**
 * Teto de tentativas de leitura do mesmo documento (bd/15 §3).
 *
 * A fila já desiste sozinha depois de `max_tentativas` (RF-070); este teto é
 * para o reprocessamento pedido a mão, que enfileira de novo. Vinte leituras do
 * mesmo arquivo sem sucesso não são azar: ou o provedor não lê aquele formato,
 * ou o arquivo está ilegível — e nos dois casos o caminho é a digitação manual
 * (RF-099), não a vigésima primeira tentativa.
 */
export const MAX_ATTEMPTS = 20;

/** Situações que ainda aceitam decisão humana (RF-099). */
export const REVIEWABLE: OcrStatus[] = [OcrStatus.PROCESSADO];
