import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type { Branch, BranchInput, PaginatedResult } from './types';

/** Filiais da empresa ativa (RF-002 / RF-003 — UI-007). */
@Injectable({ providedIn: 'root' })
export class BranchesApiService {
  private readonly http = inject(HttpClient);

  list(query: ListQuery = {}): Observable<PaginatedResult<Branch>> {
    return this.http.get<PaginatedResult<Branch>>('branches', { params: toHttpParams(query) });
  }

  get(id: string): Observable<Branch> {
    return this.http.get<Branch>(`branches/${id}`);
  }

  create(body: BranchInput): Observable<Branch> {
    return this.http.post<Branch>('branches', body);
  }

  update(id: string, body: Partial<BranchInput>): Observable<Branch> {
    return this.http.patch<Branch>(`branches/${id}`, body);
  }

  /** Inativação lógica (`DELETE /branches/:id` não apaga a linha). */
  inactivate(id: string): Observable<void> {
    return this.http.delete<void>(`branches/${id}`);
  }
}
