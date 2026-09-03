import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams, type QueryValue } from './params';
import type { AuditEntry, AuditEventType, PaginatedResult } from './types';

/** Filtros da trilha (RF-117). Datas em ISO 8601; `to` é exclusivo. */
export interface AuditQuery extends Record<string, QueryValue> {
  page?: number;
  pageSize?: number;
  event?: AuditEventType | '';
  entity?: string;
  entityId?: string;
  userId?: string;
  from?: string;
  to?: string;
}

/** Consulta da trilha de auditoria (RF-114 a RF-118 — UI-012). */
@Injectable({ providedIn: 'root' })
export class AuditApiService {
  private readonly http = inject(HttpClient);

  list(query: AuditQuery = {}): Observable<PaginatedResult<AuditEntry>> {
    return this.http.get<PaginatedResult<AuditEntry>>('audit', { params: toHttpParams(query) });
  }

  get(id: string): Observable<AuditEntry> {
    return this.http.get<AuditEntry>(`audit/${id}`);
  }
}
