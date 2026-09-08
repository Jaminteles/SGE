import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  Compensation,
  CompensationInput,
  PaginatedResult,
  PayrollItem,
  PayrollItemInput,
  PayrollSummary,
} from './types';

/** Filtros da consolidação de folha (`QueryPayrollDto`). */
export interface PayrollSummaryQuery {
  /** Competência `YYYY-MM` — obrigatória. */
  competence: string;
  costCenterId?: string;
  departmentId?: string;
  employeeId?: string;
}

/**
 * Verbas de folha (RF-017/RF-021 — UI-016).
 *
 * Três recursos da mesma tela: o catálogo da empresa (`payroll-items`), a
 * atribuição por funcionário com vigência (`employees/:id/payroll-items`) e a
 * consolidação por competência (`payroll/summary`).
 *
 * Todo valor trafega como string decimal: a folha inteira é dinheiro (RN-012).
 */
@Injectable({ providedIn: 'root' })
export class PayrollApiService {
  private readonly http = inject(HttpClient);

  listItems(query: ListQuery = {}): Observable<PaginatedResult<PayrollItem>> {
    return this.http.get<PaginatedResult<PayrollItem>>('payroll-items', {
      params: toHttpParams(query),
    });
  }

  createItem(body: PayrollItemInput): Observable<PayrollItem> {
    return this.http.post<PayrollItem>('payroll-items', body);
  }

  updateItem(id: string, body: Partial<PayrollItemInput>): Observable<PayrollItem> {
    return this.http.patch<PayrollItem>(`payroll-items/${id}`, body);
  }

  inactivateItem(id: string): Observable<void> {
    return this.http.delete<void>(`payroll-items/${id}`);
  }

  listCompensation(employeeId: string): Observable<Compensation[]> {
    return this.http.get<Compensation[]>(`employees/${employeeId}/payroll-items`);
  }

  createCompensation(employeeId: string, body: CompensationInput): Observable<Compensation> {
    return this.http.post<Compensation>(`employees/${employeeId}/payroll-items`, body);
  }

  /** A verba em si não muda: trocá-la seria outra atribuição, com outra vigência. */
  updateCompensation(
    employeeId: string,
    id: string,
    body: Partial<Omit<CompensationInput, 'payrollItemId'>>,
  ): Observable<Compensation> {
    return this.http.patch<Compensation>(`employees/${employeeId}/payroll-items/${id}`, body);
  }

  /** Encerra a vigência da atribuição — o histórico da folha é preservado. */
  closeCompensation(employeeId: string, id: string): Observable<Compensation> {
    return this.http.delete<Compensation>(`employees/${employeeId}/payroll-items/${id}`);
  }

  summary(query: PayrollSummaryQuery): Observable<PayrollSummary> {
    return this.http.get<PayrollSummary>('payroll/summary', {
      params: toHttpParams({ ...query }),
    });
  }
}
