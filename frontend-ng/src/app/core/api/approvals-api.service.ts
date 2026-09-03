import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type { ApprovalThreshold, ApprovalThresholdInput, PaginatedResult } from './types';

/**
 * Alçadas de aprovação (RF-012 — UI-011).
 *
 * As faixas de valor trafegam como string decimal canônica: o backend valida
 * por regex e grava em `numeric(18,2)`. Converter para `number` aqui
 * reintroduziria ponto flutuante numa regra que decide aprovação de dinheiro.
 */
@Injectable({ providedIn: 'root' })
export class ApprovalsApiService {
  private readonly http = inject(HttpClient);

  list(query: ListQuery = {}): Observable<PaginatedResult<ApprovalThreshold>> {
    return this.http.get<PaginatedResult<ApprovalThreshold>>('approval-thresholds', {
      params: toHttpParams(query),
    });
  }

  create(body: ApprovalThresholdInput): Observable<ApprovalThreshold> {
    return this.http.post<ApprovalThreshold>('approval-thresholds', body);
  }

  update(id: string, body: Partial<ApprovalThresholdInput>): Observable<ApprovalThreshold> {
    return this.http.patch<ApprovalThreshold>(`approval-thresholds/${id}`, body);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`approval-thresholds/${id}`);
  }
}
