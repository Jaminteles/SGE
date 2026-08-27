import { JournalLineType, LedgerAccountType, Prisma } from '@prisma/client';

/**
 * Forma do lançamento na API (RF-081/RF-082).
 *
 * `number` é `bigint` no banco (sequencial do lançamento) e vira `number` aqui:
 * `bigint` não é serializável em JSON, e o sequencial de lançamentos não chega
 * perto do limite seguro do tipo. Valores continuam `Decimal` até a
 * serialização — nenhum passa por `Number` no caminho (RN-012).
 */
export interface JournalEntryLineResponse {
  id: string;
  sequence: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: LedgerAccountType;
  type: JournalLineType;
  amount: Prisma.Decimal;
  costCenterId: string | null;
  extraHistory: string | null;
}

export interface JournalEntryResponse {
  id: string;
  number: number;
  branchId: string | null;
  periodId: string | null;
  entryDate: Date;
  competenceDate: Date;
  history: string;
  totalAmount: Prisma.Decimal;
  origin: string | null;
  originId: string | null;
  settlementId: string | null;
  fiscalDocumentId: string | null;
  batch: string | null;
  reversalOfId: string | null;
  isReversed: boolean;
  exported: boolean;
  exportedAt: Date | null;
  createdAt: Date;
  lines: JournalEntryLineResponse[];
}

/** Linha de `lancamento_contabil` com as partidas, na forma da API. */
export function toJournalEntryResponse(entry: {
  id: string;
  number: bigint;
  branchId: string | null;
  periodId: string | null;
  entryDate: Date;
  competenceDate: Date;
  history: string;
  totalAmount: Prisma.Decimal;
  origin: string | null;
  originId: string | null;
  settlementId: string | null;
  fiscalDocumentId: string | null;
  batch: string | null;
  reversalOfId: string | null;
  isReversed: boolean;
  exported: boolean;
  exportedAt: Date | null;
  createdAt: Date;
  lines: {
    id: string;
    sequence: number;
    accountId: string;
    type: JournalLineType;
    amount: Prisma.Decimal;
    costCenterId: string | null;
    extraHistory: string | null;
    account: { id: string; code: string; name: string; type: LedgerAccountType };
  }[];
}): JournalEntryResponse {
  return {
    id: entry.id,
    number: Number(entry.number),
    branchId: entry.branchId,
    periodId: entry.periodId,
    entryDate: entry.entryDate,
    competenceDate: entry.competenceDate,
    history: entry.history,
    totalAmount: entry.totalAmount,
    origin: entry.origin,
    originId: entry.originId,
    settlementId: entry.settlementId,
    fiscalDocumentId: entry.fiscalDocumentId,
    batch: entry.batch,
    reversalOfId: entry.reversalOfId,
    isReversed: entry.isReversed,
    exported: entry.exported,
    exportedAt: entry.exportedAt,
    createdAt: entry.createdAt,
    lines: entry.lines.map((line) => ({
      id: line.id,
      sequence: line.sequence,
      accountId: line.accountId,
      accountCode: line.account.code,
      accountName: line.account.name,
      accountType: line.account.type,
      type: line.type,
      amount: line.amount,
      costCenterId: line.costCenterId,
      extraHistory: line.extraHistory,
    })),
  };
}
