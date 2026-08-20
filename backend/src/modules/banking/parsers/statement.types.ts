/**
 * Resultado da leitura de um extrato (RF-060), no vocabulário do domínio.
 *
 * Valores são **string decimal**, sempre positivos: o sinal do arquivo vira
 * `direction`, porque a coluna `valor` do banco tem CHECK `> 0` e porque somar
 * grandezas com sinal embutido é como se perde um crédito no meio de débitos.
 */
export interface ParsedStatementEntry {
  /** Identificador da linha no banco (FITID do OFX). Chave da deduplicação. */
  externalId?: string;
  /** Dia civil `YYYY-MM-DD`. */
  movementDate: string;
  postedDate?: string;
  direction: 'DEBITO' | 'CREDITO';
  amount: string;
  description?: string;
  document?: string;
  counterpartName?: string;
  counterpartDocument?: string;
}

export interface ParsedStatement {
  periodStart?: string;
  periodEnd?: string;
  openingBalance?: string;
  closingBalance?: string;
  entries: ParsedStatementEntry[];
}

/** O arquivo não é o esperado — vira 400, não 500. */
export class StatementParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatementParseError';
  }
}

/** Teto de linhas por arquivo: um extrato maior que isso é importado em partes. */
export const MAX_STATEMENT_ENTRIES = 10_000;
