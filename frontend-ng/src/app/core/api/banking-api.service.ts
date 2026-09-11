import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  BankProvider,
  BankStatementImport,
  BankTransaction,
  CompanyBankAccount,
  CompanyBankAccountInput,
  CompanyBankAccountUpdateInput,
  ConfirmPaymentInput,
  IntegrationCredential,
  PaginatedResult,
  PaymentInput,
  PaymentMethodType,
  PaymentTransaction,
  PaymentTransactionStatus,
  StatementFormat,
  TransactionDirection,
} from './types';

/** Filtros das contas (`QueryCompanyAccountDto`). */
export interface CompanyAccountQuery extends ListQuery {
  branchId?: string;
  allowsPayment?: boolean;
  allowsReceipt?: boolean;
}

/** Filtros das ordens (`QueryPaymentDto`). Datas `YYYY-MM-DD`, inclusivas. */
export interface PaymentQuery extends ListQuery {
  status?: PaymentTransactionStatus;
  direction?: TransactionDirection;
  method?: PaymentMethodType;
  bankAccountId?: string;
  installmentId?: string;
  createdFrom?: string;
  createdTo?: string;
}

/** Filtros das importações (`QueryStatementImportDto`). */
export interface StatementImportQuery extends ListQuery {
  bankAccountId?: string;
  periodFrom?: string;
  periodTo?: string;
}

/** Filtros dos movimentos (`QueryBankTransactionDto`). Datas inclusivas. */
export interface BankTransactionQuery extends ListQuery {
  bankAccountId?: string;
  statementImportId?: string;
  direction?: TransactionDirection;
  from?: string;
  to?: string;
}

/**
 * Bancos: contas, ordens de pagamento e extratos (RF-059 a RF-071 — UI-042 a
 * UI-046).
 *
 * A ordem não se edita nem se apaga: cancelar, consultar o provedor e
 * confirmar são ações com rota e permissão próprias. E a criação exige
 * `Idempotency-Key` — sem ela, o retry de rede vira segundo pagamento (RF-067).
 */
@Injectable({ providedIn: 'root' })
export class BankingApiService {
  private readonly http = inject(HttpClient);

  listAccounts(query: CompanyAccountQuery = {}): Observable<PaginatedResult<CompanyBankAccount>> {
    return this.http.get<PaginatedResult<CompanyBankAccount>>('banking/accounts', {
      params: toHttpParams(query),
    });
  }

  getAccount(id: string): Observable<CompanyBankAccount> {
    return this.http.get<CompanyBankAccount>(`banking/accounts/${id}`);
  }

  createAccount(body: CompanyBankAccountInput): Observable<CompanyBankAccount> {
    return this.http.post<CompanyBankAccount>('banking/accounts', body);
  }

  updateAccount(id: string, body: CompanyBankAccountUpdateInput): Observable<CompanyBankAccount> {
    return this.http.patch<CompanyBankAccount>(`banking/accounts/${id}`, body);
  }

  /** Catálogo global de provedores — exige `integration-credentials:READ`. */
  listProviders(): Observable<BankProvider[]> {
    return this.http.get<BankProvider[]>('banking/providers');
  }

  /** Credenciais da empresa, sem o segredo — exige `integration-credentials:READ`. */
  listCredentials(): Observable<IntegrationCredential[]> {
    return this.http.get<IntegrationCredential[]>('banking/credentials');
  }

  /**
   * `idempotencyKey` identifica **esta** ordem: o retry da mesma tentativa reusa
   * a chave e recebe a ordem já criada, em vez de uma segunda (RF-067/RN-004).
   */
  createPayment(body: PaymentInput, idempotencyKey: string): Observable<PaymentTransaction> {
    return this.http.post<PaymentTransaction>('banking/payments', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  listPayments(query: PaymentQuery = {}): Observable<PaginatedResult<PaymentTransaction>> {
    return this.http.get<PaginatedResult<PaymentTransaction>>('banking/payments', {
      params: toHttpParams(query),
    });
  }

  getPayment(id: string): Observable<PaymentTransaction> {
    return this.http.get<PaymentTransaction>(`banking/payments/${id}`);
  }

  /** Pergunta a situação ao provedor (RF-064) — exige `payments:UPDATE`. */
  syncPayment(id: string): Observable<PaymentTransaction> {
    return this.http.post<PaymentTransaction>(`banking/payments/${id}/sync`, {});
  }

  /** Cancela com motivo (RF-065) — exige `payments:DELETE`. */
  cancelPayment(id: string, reason: string): Observable<PaymentTransaction> {
    return this.http.post<PaymentTransaction>(`banking/payments/${id}/cancel`, { reason });
  }

  /** Confirmação feita fora do sistema: gera a baixa — exige `payments:APPROVE`. */
  confirmPayment(id: string, body: ConfirmPaymentInput): Observable<PaymentTransaction> {
    return this.http.post<PaymentTransaction>(`banking/payments/${id}/confirm`, body);
  }

  /**
   * Importa um extrato (RF-060/RF-071). Vai como `FormData`: o navegador monta o
   * `multipart/form-data` com o boundary — definir `Content-Type` quebraria.
   * Sem `format`, o backend deduz pelo conteúdo.
   */
  importStatement(
    file: File,
    bankAccountId: string,
    format?: StatementFormat,
  ): Observable<BankStatementImport> {
    const corpo = new FormData();
    corpo.append('file', file, file.name);
    corpo.append('bankAccountId', bankAccountId);
    if (format) corpo.append('format', format);
    return this.http.post<BankStatementImport>('banking/statements/import', corpo);
  }

  listStatements(
    query: StatementImportQuery = {},
  ): Observable<PaginatedResult<BankStatementImport>> {
    return this.http.get<PaginatedResult<BankStatementImport>>('banking/statements', {
      params: toHttpParams(query),
    });
  }

  listTransactions(query: BankTransactionQuery = {}): Observable<PaginatedResult<BankTransaction>> {
    return this.http.get<PaginatedResult<BankTransaction>>('banking/bank-transactions', {
      params: toHttpParams(query),
    });
  }
}
