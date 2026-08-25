import { OcrProcessing, OcrStatus, Prisma } from '@prisma/client';
import { formatDateOnly } from '../../common/utils/date-only';

/**
 * Resposta do processamento (RF-097/RF-100).
 *
 * `payload_bruto` fica de fora: é a resposta do provedor, guardada para prova e
 * para depuração, e pode conter identificadores da conta contratada. Quem
 * precisa dele consulta o banco — não a API.
 *
 * Valor e confiança saem como **string decimal**: serializar `Decimal` como
 * número devolveria ponto flutuante ao cliente, que é onde o centavo some.
 */
export interface OcrResponse {
  id: string;
  documentId: string;
  status: OcrStatus;
  fileName?: string;
  confidence: string | null;
  extractedText: string | null;
  fields: {
    amount: string | null;
    issueDate: string | null;
    merchantName: string | null;
    merchantDocument: string | null;
    documentKey: string | null;
    documentNumber: string | null;
  };
  suggestions: {
    partnerId: string | null;
    categoryId: string | null;
    costCenterId: string | null;
  };
  corrections: Prisma.JsonValue | null;
  validatedById: string | null;
  validatedAt: Date | null;
  error: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

type WithDocument = OcrProcessing & { document?: { fileName: string } | null };

export function toOcrResponse(processing: WithDocument): OcrResponse {
  return {
    id: processing.id,
    documentId: processing.documentId,
    status: processing.status,
    fileName: processing.document?.fileName,
    confidence: processing.confidence?.toFixed(2) ?? null,
    extractedText: processing.extractedText,
    fields: {
      amount: processing.amount?.toFixed(2) ?? null,
      issueDate: processing.issueDate ? formatDateOnly(processing.issueDate) : null,
      merchantName: processing.merchantName,
      merchantDocument: processing.merchantDocument,
      documentKey: processing.documentKey,
      documentNumber: processing.documentNumber,
    },
    suggestions: {
      partnerId: processing.suggestedPartnerId,
      categoryId: processing.suggestedCategoryId,
      costCenterId: processing.suggestedCostCenterId,
    },
    corrections: processing.corrections,
    validatedById: processing.validatedById,
    validatedAt: processing.validatedAt,
    error: processing.error,
    attempts: processing.attempts,
    createdAt: processing.createdAt,
    updatedAt: processing.updatedAt,
  };
}
