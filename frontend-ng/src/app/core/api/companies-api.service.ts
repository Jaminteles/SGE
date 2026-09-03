import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { semEmpresa } from './http-context';
import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type { Company, CompanyInput, PaginatedResult } from './types';

/**
 * Empresas (RF-001 / RF-003 — UI-007).
 *
 * O ciclo de vida (`POST`, `GET /companies`, ativar/inativar) é de
 * administrador de plataforma e **não** é escopado por empresa: o backend usa
 * `@RequireSuperAdmin()`, não a empresa ativa. Já `current` é o autoatendimento
 * do administrador da empresa ativa, e depende do `x-company-id`.
 */
@Injectable({ providedIn: 'root' })
export class CompaniesApiService {
  private readonly http = inject(HttpClient);

  list(query: ListQuery = {}): Observable<PaginatedResult<Company>> {
    return this.http.get<PaginatedResult<Company>>('companies', {
      params: toHttpParams(query),
      context: semEmpresa(),
    });
  }

  get(id: string): Observable<Company> {
    return this.http.get<Company>(`companies/${id}`, { context: semEmpresa() });
  }

  create(body: CompanyInput): Observable<Company> {
    return this.http.post<Company>('companies', body, { context: semEmpresa() });
  }

  update(id: string, body: Partial<CompanyInput>): Observable<Company> {
    return this.http.patch<Company>(`companies/${id}`, body, { context: semEmpresa() });
  }

  setActive(id: string, ativa: boolean): Observable<Company> {
    const acao = ativa ? 'activate' : 'inactivate';
    return this.http.post<Company>(`companies/${id}/${acao}`, {}, { context: semEmpresa() });
  }

  /** Dados cadastrais da empresa ativa (RF-003) — permissão `company:READ`. */
  current(): Observable<Company> {
    return this.http.get<Company>('companies/current');
  }

  updateCurrent(body: Partial<CompanyInput>): Observable<Company> {
    return this.http.patch<Company>('companies/current', body);
  }
}
