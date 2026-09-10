import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  PaginatedResult,
  PaymentMethod,
  PaymentMethodInput,
  PaymentTerm,
  PaymentTermInput,
} from './types';

/**
 * Condições e formas de pagamento (RF-026 — UI-019).
 *
 * Dois recursos da mesma tela e do mesmo módulo do backend: a condição define
 * o prazo (parcelas, intervalo, primeiro vencimento) e a forma define o meio de
 * liquidação. Os dois alimentam os perfis de cliente e fornecedor (UI-018).
 */
@Injectable({ providedIn: 'root' })
export class PaymentConditionsApiService {
  private readonly http = inject(HttpClient);

  listTerms(query: ListQuery = {}): Observable<PaginatedResult<PaymentTerm>> {
    return this.http.get<PaginatedResult<PaymentTerm>>('payment-terms', {
      params: toHttpParams(query),
    });
  }

  createTerm(body: PaymentTermInput): Observable<PaymentTerm> {
    return this.http.post<PaymentTerm>('payment-terms', body);
  }

  updateTerm(id: string, body: Partial<PaymentTermInput>): Observable<PaymentTerm> {
    return this.http.patch<PaymentTerm>(`payment-terms/${id}`, body);
  }

  /** Inativação lógica: a condição continua nos títulos já gerados com ela. */
  inactivateTerm(id: string): Observable<void> {
    return this.http.delete<void>(`payment-terms/${id}`);
  }

  listMethods(query: ListQuery = {}): Observable<PaginatedResult<PaymentMethod>> {
    return this.http.get<PaginatedResult<PaymentMethod>>('payment-methods', {
      params: toHttpParams(query),
    });
  }

  createMethod(body: PaymentMethodInput): Observable<PaymentMethod> {
    return this.http.post<PaymentMethod>('payment-methods', body);
  }

  updateMethod(id: string, body: Partial<PaymentMethodInput>): Observable<PaymentMethod> {
    return this.http.patch<PaymentMethod>(`payment-methods/${id}`, body);
  }

  inactivateMethod(id: string): Observable<void> {
    return this.http.delete<void>(`payment-methods/${id}`);
  }
}
