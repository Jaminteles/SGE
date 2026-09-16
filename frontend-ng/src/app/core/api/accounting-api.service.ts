import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { toHttpParams } from './params';
import { comCache } from './query-cache';
import type { ListQuery } from './query';
import type {
  AccountClassification,
  AccountingExportFile,
  AccountingExportInput,
  AccountingPeriod,
  AccountingPeriodStatus,
  ClassifiableSource,
  IncomeStatement,
  JournalEntry,
  JournalEntryInput,
  LedgerAccount,
  LedgerAccountInput,
  LedgerAccountNode,
  LedgerAccountType,
  LedgerAccountUpdate,
  LedgerReport,
  PaginatedResult,
  TrialBalance,
} from './types';

/** Filtros do plano de contas (`QueryLedgerAccountDto`). */
export interface LedgerAccountQuery extends ListQuery {
  type?: LedgerAccountType;
  acceptsEntry?: boolean;
}

/** Filtros do diário (`QueryJournalEntryDto`). Datas de competência, inclusivas. */
export interface JournalEntryQuery extends ListQuery {
  from?: string;
  to?: string;
  accountId?: string;
  origin?: string;
  batch?: string;
}

/** Recorte dos relatórios (RF-083 a RF-085). */
export interface ReportQuery {
  from: string;
  to: string;
  costCenterId?: string;
}

export interface LedgerQuery extends ReportQuery {
  accountId: string;
  limit?: number;
  offset?: number;
}

export interface TrialBalanceQuery extends ReportQuery {
  includeZeroed?: boolean;
}

/** Nome de arquivo do `Content-Disposition`; o servidor é quem o gera. */
export function nomeDoAnexo(disposicao: string | null): string | null {
  if (!disposicao) return null;
  const encontrado = /filename="?([^";]+)"?/i.exec(disposicao);
  return encontrado ? encontrado[1] : null;
}

function inteiroOuNulo(valor: string | null): number | null {
  if (valor === null || !/^\d+$/.test(valor)) return null;
  return Number.parseInt(valor, 10);
}

/**
 * Contabilidade (RF-078 a RF-087 — UI-054 a UI-060).
 *
 * Não há rota de alteração de lançamento: o lançamento é imutável e corrigir é
 * estornar (RF-082). A autorização real é do backend (`PermissionsGuard` +
 * RLS); as checagens de permissão na tela só evitam oferecer o que daria 403.
 */
@Injectable({ providedIn: 'root' })
export class AccountingApiService {
  private readonly http = inject(HttpClient);

  // --- Plano de contas (RF-078/RF-079) -------------------------------------

  tree(): Observable<LedgerAccountNode[]> {
    return this.http.get<LedgerAccountNode[]>('ledger-accounts/tree', { context: comCache() });
  }

  listAccounts(query: LedgerAccountQuery = {}): Observable<PaginatedResult<LedgerAccount>> {
    return this.http.get<PaginatedResult<LedgerAccount>>('ledger-accounts', {
      params: toHttpParams(query),
    });
  }

  createAccount(body: LedgerAccountInput): Observable<LedgerAccount> {
    return this.http.post<LedgerAccount>('ledger-accounts', body);
  }

  updateAccount(id: string, body: LedgerAccountUpdate): Observable<LedgerAccount> {
    return this.http.patch<LedgerAccount>(`ledger-accounts/${id}`, body);
  }

  /** Inativa: o razão de período fechado não pode apontar para conta que sumiu. */
  deactivateAccount(id: string): Observable<void> {
    return this.http.delete<void>(`ledger-accounts/${id}`);
  }

  // --- Classificação (RF-080) ----------------------------------------------

  listClassifications(
    source: ClassifiableSource,
    unclassifiedOnly = false,
  ): Observable<AccountClassification[]> {
    return this.http.get<AccountClassification[]>(`accounting/classifications/${source}`, {
      params: toHttpParams({ unclassifiedOnly: unclassifiedOnly || undefined }),
    });
  }

  /** `accountId` nulo remove a classificação. */
  assignClassification(
    source: ClassifiableSource,
    id: string,
    accountId: string | null,
  ): Observable<AccountClassification> {
    return this.http.put<AccountClassification>(`accounting/classifications/${source}/${id}`, {
      accountId,
    });
  }

  // --- Lançamentos (RF-081/RF-082) -----------------------------------------

  listEntries(query: JournalEntryQuery = {}): Observable<PaginatedResult<JournalEntry>> {
    return this.http.get<PaginatedResult<JournalEntry>>('journal-entries', {
      params: toHttpParams(query),
    });
  }

  getEntry(id: string): Observable<JournalEntry> {
    return this.http.get<JournalEntry>(`journal-entries/${id}`);
  }

  createEntry(body: JournalEntryInput): Observable<JournalEntry> {
    return this.http.post<JournalEntry>('journal-entries', body);
  }

  /** Estorno com motivo — exige `journal-entries:DELETE`. */
  reverseEntry(id: string, reason: string, competenceDate?: string): Observable<JournalEntry> {
    return this.http.post<JournalEntry>(`journal-entries/${id}/reverse`, {
      reason,
      ...(competenceDate ? { competenceDate } : {}),
    });
  }

  // --- Relatórios (RF-083 a RF-085) ----------------------------------------

  ledger(query: LedgerQuery): Observable<LedgerReport> {
    return this.http.get<LedgerReport>('accounting/reports/ledger', {
      params: toHttpParams({ ...query }),
    });
  }

  trialBalance(query: TrialBalanceQuery): Observable<TrialBalance> {
    return this.http.get<TrialBalance>('accounting/reports/trial-balance', {
      params: toHttpParams({ ...query }),
    });
  }

  incomeStatement(query: { from: string; to: string }): Observable<IncomeStatement> {
    return this.http.get<IncomeStatement>('accounting/reports/income-statement', {
      params: toHttpParams(query),
    });
  }

  // --- Períodos (RF-086) ---------------------------------------------------

  listPeriods(
    query: { year?: number; status?: AccountingPeriodStatus } = {},
  ): Observable<AccountingPeriod[]> {
    return this.http.get<AccountingPeriod[]>('accounting/periods', { params: toHttpParams(query) });
  }

  openYear(year: number): Observable<AccountingPeriod[]> {
    return this.http.post<AccountingPeriod[]>('accounting/periods', { year });
  }

  closePeriod(id: string, status: 'EM_FECHAMENTO' | 'FECHADO'): Observable<AccountingPeriod> {
    return this.http.post<AccountingPeriod>(`accounting/periods/${id}/close`, { status });
  }

  reopenPeriod(id: string, reason: string): Observable<AccountingPeriod> {
    return this.http.post<AccountingPeriod>(`accounting/periods/${id}/reopen`, { reason });
  }

  // --- Exportação (RF-087) -------------------------------------------------

  /**
   * Gera o arquivo para o sistema contábil — exige `accounting-reports:EXPORT`.
   *
   * Volta como `Blob`: a rota exige token e empresa, então não há `<a href>`
   * direto. O nome e as contagens vêm dos cabeçalhos da resposta.
   */
  export(body: AccountingExportInput): Observable<AccountingExportFile> {
    return this.http
      .post('accounting/export', body, { observe: 'response', responseType: 'blob' })
      .pipe(
        map((resposta) => ({
          content: resposta.body ?? new Blob([]),
          filename:
            nomeDoAnexo(resposta.headers.get('Content-Disposition')) ??
            `contabil_${body.from}_${body.to}.${body.format ?? 'csv'}`,
          entries: inteiroOuNulo(resposta.headers.get('X-Total-Entries')),
          lines: inteiroOuNulo(resposta.headers.get('X-Total-Lines')),
        })),
      );
  }
}
