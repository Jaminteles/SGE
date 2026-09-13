import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  AutoReconciliationJob,
  BankTransactionIdentification,
  PaginatedResult,
  PendingBankTransaction,
  Reconciliation,
  ReconciliationDivergences,
  ReconciliationInput,
  ReconciliationListItem,
  ReconciliationMovement,
  ReconciliationOrigin,
  ReconciliationRule,
  ReconciliationRuleInput,
  ReconciliationStatus,
  ReconciliationSuggestions,
  TransactionDirection,
} from './types';

/** Filtros dos movimentos pendentes (`QueryPendingDto`). Datas inclusivas. */
export interface PendingQuery extends ListQuery {
  bankAccountId?: string;
  direction?: TransactionDirection;
  status?: ReconciliationStatus;
  from?: string;
  to?: string;
}

/** Parâmetros da busca de correspondências (`QuerySuggestionDto`). */
export interface SuggestionQuery extends ListQuery {
  dayTolerance?: number;
  valueTolerance?: string;
  limit?: number;
}

/** Filtros do histórico (`QueryReconciliationDto`). */
export interface ReconciliationQuery extends ListQuery {
  bankTransactionId?: string;
  installmentId?: string;
  bankAccountId?: string;
  origin?: ReconciliationOrigin;
  from?: string;
  to?: string;
  confirmed?: boolean;
  hasDivergence?: boolean;
  includeUndone?: boolean;
}

/** Filtros do painel de divergências (`QueryDivergenceDto`). */
export interface DivergenceQuery extends ListQuery {
  bankAccountId?: string;
  from?: string;
  to?: string;
}

/**
 * Conciliação bancária (RF-072 a RF-077 — UI-048 a UI-053).
 *
 * Conciliar não movimenta dinheiro: o vínculo afirma que a linha do extrato
 * corresponde a um lançamento que já existe. Desfazer é um evento com motivo,
 * não uma exclusão — por isso o `DELETE` leva corpo.
 */
@Injectable({ providedIn: 'root' })
export class ReconciliationApiService {
  private readonly http = inject(HttpClient);

  listPending(query: PendingQuery = {}): Observable<PaginatedResult<PendingBankTransaction>> {
    return this.http.get<PaginatedResult<PendingBankTransaction>>('reconciliation/pending', {
      params: toHttpParams(query),
    });
  }

  /** Grava a identificação no movimento — exige `reconciliation:CREATE`. */
  identify(
    bankTransactionId: string,
  ): Observable<BankTransactionIdentification & { bankTransactionId: string }> {
    return this.http.post<BankTransactionIdentification & { bankTransactionId: string }>(
      `reconciliation/bank-transactions/${bankTransactionId}/identify`,
      {},
    );
  }

  suggest(
    bankTransactionId: string,
    query: SuggestionQuery = {},
  ): Observable<ReconciliationSuggestions> {
    return this.http.get<ReconciliationSuggestions>(
      `reconciliation/bank-transactions/${bankTransactionId}/suggestions`,
      { params: toHttpParams(query) },
    );
  }

  ignore(bankTransactionId: string, reason: string): Observable<ReconciliationMovement> {
    return this.http.post<ReconciliationMovement>(
      `reconciliation/bank-transactions/${bankTransactionId}/ignore`,
      { reason },
    );
  }

  reopen(bankTransactionId: string): Observable<ReconciliationMovement> {
    return this.http.post<ReconciliationMovement>(
      `reconciliation/bank-transactions/${bankTransactionId}/reopen`,
      {},
    );
  }

  create(body: ReconciliationInput): Observable<Reconciliation> {
    return this.http.post<Reconciliation>('reconciliation', body);
  }

  /** Desfaz com motivo (RF-074/RF-077) — exige `reconciliation:DELETE`. */
  undo(id: string, reason: string): Observable<Reconciliation> {
    return this.http.delete<Reconciliation>(`reconciliation/${id}`, { body: { reason } });
  }

  list(query: ReconciliationQuery = {}): Observable<PaginatedResult<ReconciliationListItem>> {
    return this.http.get<PaginatedResult<ReconciliationListItem>>('reconciliation', {
      params: toHttpParams(query),
    });
  }

  divergences(query: DivergenceQuery = {}): Observable<ReconciliationDivergences> {
    return this.http.get<ReconciliationDivergences>('reconciliation/divergences', {
      params: toHttpParams(query),
    });
  }

  /** Enfileira a conciliação por regras (RF-075) — exige `reconciliation:APPROVE`. */
  runAuto(body: { bankAccountId: string; from: string; to: string }): Observable<AutoReconciliationJob> {
    return this.http.post<AutoReconciliationJob>('reconciliation/run', body);
  }

  listRules(query: ListQuery = {}): Observable<PaginatedResult<ReconciliationRule>> {
    return this.http.get<PaginatedResult<ReconciliationRule>>('reconciliation-rules', {
      params: toHttpParams(query),
    });
  }

  createRule(body: ReconciliationRuleInput): Observable<ReconciliationRule> {
    return this.http.post<ReconciliationRule>('reconciliation-rules', body);
  }

  updateRule(id: string, body: Partial<ReconciliationRuleInput>): Observable<ReconciliationRule> {
    return this.http.patch<ReconciliationRule>(`reconciliation-rules/${id}`, body);
  }

  /** A regra não é removida: explica conciliações já feitas (RF-077). */
  deactivateRule(id: string): Observable<ReconciliationRule> {
    return this.http.delete<ReconciliationRule>(`reconciliation-rules/${id}`);
  }
}
