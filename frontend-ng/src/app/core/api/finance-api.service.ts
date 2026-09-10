import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  ApprovalStatus,
  CategoryClassification,
  DelinquencySummary,
  EntryStatus,
  EntryType,
  FinancialEntry,
  FinancialEntryInput,
  FinancialEntryUpdateInput,
  FinancialInstallment,
  InstallmentUpdateInput,
  PaginatedResult,
  PortfolioInstallment,
  SettlementInput,
} from './types';

/** Filtros da carteira de títulos (`QueryFinancialEntryDto`). */
export interface FinancialEntryQuery extends ListQuery {
  type?: EntryType;
  status?: EntryStatus;
  approvalStatus?: ApprovalStatus;
  partnerId?: string;
  categoryId?: string;
  costCenterId?: string;
  issuedFrom?: string;
  issuedTo?: string;
  dueFrom?: string;
  dueTo?: string;
  openOnly?: boolean;
}

/** Filtros da posição da carteira e da inadimplência (`QueryPortfolioDto`). */
export interface PortfolioQuery extends ListQuery {
  type?: EntryType;
  partnerId?: string;
  categoryId?: string;
  costCenterId?: string;
  branchId?: string;
  dueFrom?: string;
  dueTo?: string;
  overdueOnly?: boolean;
}

/**
 * Contas a pagar e a receber (RF-051 a RF-058 — UI-024 a UI-028).
 *
 * Um serviço só para as duas carteiras, como no backend: `titulo` é uma
 * entidade discriminada por `type`. Nenhum valor é calculado aqui — líquido,
 * saldo, encargos e aging vêm do servidor, que é quem responde por eles.
 *
 * Baixa e estorno são rotas da parcela; o estorno é lançamento contrário e
 * nunca apaga a baixa original (RF-057).
 */
@Injectable({ providedIn: 'root' })
export class FinanceApiService {
  private readonly http = inject(HttpClient);

  listEntries(query: FinancialEntryQuery = {}): Observable<PaginatedResult<FinancialEntry>> {
    return this.http.get<PaginatedResult<FinancialEntry>>('financial-entries', {
      params: toHttpParams(query),
    });
  }

  getEntry(id: string): Observable<FinancialEntry> {
    return this.http.get<FinancialEntry>(`financial-entries/${id}`);
  }

  createEntry(body: FinancialEntryInput): Observable<FinancialEntry> {
    return this.http.post<FinancialEntry>('financial-entries', body);
  }

  updateEntry(id: string, body: FinancialEntryUpdateInput): Observable<FinancialEntry> {
    return this.http.patch<FinancialEntry>(`financial-entries/${id}`, body);
  }

  cancelEntry(id: string, reason: string): Observable<FinancialEntry> {
    return this.http.post<FinancialEntry>(`financial-entries/${id}/cancel`, { reason });
  }

  /** Envia para a fila de aprovação o título que nasceu abaixo da alçada (RF-056). */
  submitEntry(id: string): Observable<FinancialEntry> {
    return this.http.post<FinancialEntry>(`financial-entries/${id}/submit`, {});
  }

  approveEntry(id: string, note?: string): Observable<FinancialEntry> {
    return this.http.post<FinancialEntry>(`financial-entries/${id}/approve`, note ? { note } : {});
  }

  rejectEntry(id: string, reason: string): Observable<FinancialEntry> {
    return this.http.post<FinancialEntry>(`financial-entries/${id}/reject`, { reason });
  }

  /** Prorrogação e política de cobrança da parcela (RF-055) — o valor não muda. */
  updateInstallment(
    entryId: string,
    installmentId: string,
    body: InstallmentUpdateInput,
  ): Observable<FinancialInstallment> {
    return this.http.patch<FinancialInstallment>(
      `financial-entries/${entryId}/installments/${installmentId}`,
      body,
    );
  }

  settle(entryId: string, installmentId: string, body: SettlementInput): Observable<unknown> {
    return this.http.post(
      `financial-entries/${entryId}/installments/${installmentId}/settlements`,
      body,
    );
  }

  reverseSettlement(
    entryId: string,
    installmentId: string,
    settlementId: string,
    reason: string,
  ): Observable<unknown> {
    return this.http.post(
      `financial-entries/${entryId}/installments/${installmentId}/settlements/${settlementId}/reverse`,
      { reason },
    );
  }

  /** Posição da carteira: parcelas com atraso, encargos e faixa de aging (RF-055/RF-058). */
  portfolio(query: PortfolioQuery = {}): Observable<PaginatedResult<PortfolioInstallment>> {
    return this.http.get<PaginatedResult<PortfolioInstallment>>('installments', {
      params: toHttpParams(query),
    });
  }

  /** Aging e maiores devedores/credores — exige `delinquency:READ` (RF-058). */
  delinquency(query: PortfolioQuery = {}): Observable<DelinquencySummary> {
    return this.http.get<DelinquencySummary>('delinquency', { params: toHttpParams(query) });
  }

  /**
   * Conta contábil de cada categoria (RF-080) — exige
   * `accounting-classifications:READ`. É daí que o título herda a conta
   * contábil: ela não é digitada no lançamento.
   */
  categoryClassifications(): Observable<CategoryClassification[]> {
    return this.http.get<CategoryClassification[]>('accounting/classifications/categories');
  }
}
