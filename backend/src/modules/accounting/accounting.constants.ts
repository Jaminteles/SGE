import { AccountNature, LedgerAccountType } from '@prisma/client';

/**
 * Vocabulário do M11 (RF-078 a RF-087).
 */

/** `lancamento_contabil.origem_tipo` — de onde o lançamento veio (bd/17 §5). */
export const JOURNAL_ORIGINS = {
  MANUAL: 'MANUAL',
  SETTLEMENT: 'TITULO_BAIXA',
  FISCAL_DOCUMENT: 'DOCUMENTO_FISCAL',
  STOCK: 'ESTOQUE',
  REVERSAL: 'ESTORNO',
} as const;

export type JournalOrigin = (typeof JOURNAL_ORIGINS)[keyof typeof JOURNAL_ORIGINS];

/**
 * Natureza que cada tipo de conta exige (RF-079).
 *
 * Espelha o CHECK `ck_conta_contabil_natureza` (bd/17 §3). Está aqui para a API
 * recusar com mensagem em vez de deixar o banco recusar com 23514 — a regra
 * continua sendo do banco, esta é a cópia que produz erro legível.
 */
export const NATURE_BY_TYPE: Record<LedgerAccountType, AccountNature | null> = {
  ATIVO: AccountNature.DEVEDORA,
  DESPESA: AccountNature.DEVEDORA,
  CUSTO: AccountNature.DEVEDORA,
  PASSIVO: AccountNature.CREDORA,
  PATRIMONIO_LIQUIDO: AccountNature.CREDORA,
  RECEITA: AccountNature.CREDORA,
  // Conta de compensação existe aos pares e aceita as duas naturezas.
  COMPENSACAO: null,
};

/** Contas que compõem o resultado do exercício — a base da DRE (RF-085). */
export const RESULT_ACCOUNT_TYPES: LedgerAccountType[] = [
  LedgerAccountType.RECEITA,
  LedgerAccountType.DESPESA,
  LedgerAccountType.CUSTO,
];

/** Código estruturado: dígitos separados por ponto (`1.1.01.001`). */
export const ACCOUNT_CODE_PATTERN = /^\d+(\.\d+)*$/;

/** Teto de partidas em um lançamento. */
export const MAX_JOURNAL_LINES = 200;

/** Origens que podem ser classificadas para a contabilização automática (RF-080). */
export const CLASSIFIABLE_SOURCES = ['categories', 'payroll-items', 'bank-accounts'] as const;

export type ClassifiableSource = (typeof CLASSIFIABLE_SOURCES)[number];
