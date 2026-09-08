import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  BankAccount,
  BankAccountInput,
  Employee,
  EmployeeEvent,
  EmployeeEventInput,
  EmployeeInput,
  EmployeeStatus,
  PaginatedResult,
  TerminateEmployeeInput,
} from './types';

/** Filtros próprios da listagem de funcionários (`QueryEmployeeDto`). */
export interface EmployeeQuery extends ListQuery {
  status?: EmployeeStatus;
  departmentId?: string;
  positionId?: string;
  costCenterId?: string;
  managerId?: string;
}

/**
 * Cadastro funcional, histórico e dados bancários (RF-013 a RF-015, RF-020 —
 * UI-013/UI-015).
 *
 * Eventos e contas bancárias são rotas aninhadas em `employees/:id`: o backend
 * confere o vínculo do funcionário com a empresa ativa antes de tocar no filho,
 * então trocar o `:id` da URL não alcança outra empresa.
 */
@Injectable({ providedIn: 'root' })
export class EmployeesApiService {
  private readonly http = inject(HttpClient);

  list(query: EmployeeQuery = {}): Observable<PaginatedResult<Employee>> {
    return this.http.get<PaginatedResult<Employee>>('employees', { params: toHttpParams(query) });
  }

  get(id: string): Observable<Employee> {
    return this.http.get<Employee>(`employees/${id}`);
  }

  create(body: EmployeeInput): Observable<Employee> {
    return this.http.post<Employee>('employees', body);
  }

  /** Admissão e salário ficam de fora do PATCH: são eventos do histórico. */
  update(id: string, body: Partial<Omit<EmployeeInput, 'hireDate' | 'baseSalary'>>) {
    return this.http.patch<Employee>(`employees/${id}`, body);
  }

  terminate(id: string, body: TerminateEmployeeInput): Observable<Employee> {
    return this.http.post<Employee>(`employees/${id}/terminate`, body);
  }

  listEvents(
    employeeId: string,
    query: ListQuery = {},
  ): Observable<PaginatedResult<EmployeeEvent>> {
    return this.http.get<PaginatedResult<EmployeeEvent>>(`employees/${employeeId}/events`, {
      params: toHttpParams(query),
    });
  }

  createEvent(employeeId: string, body: EmployeeEventInput): Observable<EmployeeEvent> {
    return this.http.post<EmployeeEvent>(`employees/${employeeId}/events`, body);
  }

  listBankAccounts(employeeId: string): Observable<BankAccount[]> {
    return this.http.get<BankAccount[]>(`employees/${employeeId}/bank-accounts`);
  }

  createBankAccount(employeeId: string, body: BankAccountInput): Observable<BankAccount> {
    return this.http.post<BankAccount>(`employees/${employeeId}/bank-accounts`, body);
  }

  updateBankAccount(
    employeeId: string,
    id: string,
    body: Partial<BankAccountInput>,
  ): Observable<BankAccount> {
    return this.http.patch<BankAccount>(`employees/${employeeId}/bank-accounts/${id}`, body);
  }

  /** Inativação lógica: a conta continua na trilha de auditoria. */
  removeBankAccount(employeeId: string, id: string): Observable<void> {
    return this.http.delete<void>(`employees/${employeeId}/bank-accounts/${id}`);
  }
}
