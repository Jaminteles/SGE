import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  Category,
  CategoryInput,
  CompanySetting,
  CostCenter,
  CostCenterInput,
  PaginatedResult,
  SettingInput,
  SettingScope,
} from './types';

/**
 * Categorias, centros de custo e parâmetros da empresa ativa (RF-006 — UI-008).
 *
 * As três coleções vivem no módulo `configurations` do backend e são escopadas
 * pela empresa ativa (`x-company-id` + RLS).
 */
@Injectable({ providedIn: 'root' })
export class ConfigurationsApiService {
  private readonly http = inject(HttpClient);

  listCategories(query: ListQuery = {}): Observable<PaginatedResult<Category>> {
    return this.http.get<PaginatedResult<Category>>('categories', { params: toHttpParams(query) });
  }

  createCategory(body: CategoryInput): Observable<Category> {
    return this.http.post<Category>('categories', body);
  }

  updateCategory(id: string, body: Partial<CategoryInput>): Observable<Category> {
    return this.http.patch<Category>(`categories/${id}`, body);
  }

  /** Inativa a categoria (RF-006) — o backend não apaga a linha. */
  inactivateCategory(id: string): Observable<void> {
    return this.http.delete<void>(`categories/${id}`);
  }

  listCostCenters(query: ListQuery = {}): Observable<PaginatedResult<CostCenter>> {
    return this.http.get<PaginatedResult<CostCenter>>('cost-centers', {
      params: toHttpParams(query),
    });
  }

  createCostCenter(body: CostCenterInput): Observable<CostCenter> {
    return this.http.post<CostCenter>('cost-centers', body);
  }

  updateCostCenter(id: string, body: Partial<CostCenterInput>): Observable<CostCenter> {
    return this.http.patch<CostCenter>(`cost-centers/${id}`, body);
  }

  inactivateCostCenter(id: string): Observable<void> {
    return this.http.delete<void>(`cost-centers/${id}`);
  }

  /** Parâmetros não são paginados: a API devolve a lista inteira do escopo. */
  listSettings(scope?: SettingScope): Observable<CompanySetting[]> {
    return this.http.get<CompanySetting[]>('settings', { params: toHttpParams({ scope }) });
  }

  upsertSetting(body: SettingInput): Observable<CompanySetting> {
    return this.http.put<CompanySetting>('settings', body);
  }

  removeSetting(id: string): Observable<void> {
    return this.http.delete<void>(`settings/${id}`);
  }
}
