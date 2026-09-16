import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import { comCache } from './query-cache';
import type { ListQuery } from './query';
import type { PaginatedResult, PermissionCatalogItem, Role, RoleInput } from './types';

/** Perfis de acesso e catálogo de permissões (RF-010 / RF-011 — UI-010). */
@Injectable({ providedIn: 'root' })
export class RolesApiService {
  private readonly http = inject(HttpClient);

  list(query: ListQuery = {}): Observable<PaginatedResult<Role>> {
    return this.http.get<PaginatedResult<Role>>('roles', { params: toHttpParams(query) });
  }

  get(id: string): Observable<Role> {
    return this.http.get<Role>(`roles/${id}`);
  }

  create(body: RoleInput): Observable<Role> {
    return this.http.post<Role>('roles', body);
  }

  update(id: string, body: Partial<RoleInput>): Observable<Role> {
    return this.http.patch<Role>(`roles/${id}`, body);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`roles/${id}`);
  }

  /** Catálogo global de permissões — a matriz da UI-010 é montada a partir dele. */
  permissionCatalog(): Observable<PermissionCatalogItem[]> {
    return this.http.get<PermissionCatalogItem[]>('permissions', { context: comCache() });
  }
}
