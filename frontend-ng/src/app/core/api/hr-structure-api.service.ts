import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  Department,
  DepartmentInput,
  PaginatedResult,
  Position,
  PositionInput,
} from './types';

/**
 * Estrutura organizacional: cargos e departamentos (RF-014 — UI-014).
 *
 * Os dois recursos andam juntos na tela e têm o mesmo contrato de listagem
 * (`PaginationQueryDto`), como `configurations-api` faz com categorias e
 * centros de custo.
 */
@Injectable({ providedIn: 'root' })
export class HrStructureApiService {
  private readonly http = inject(HttpClient);

  listDepartments(query: ListQuery = {}): Observable<PaginatedResult<Department>> {
    return this.http.get<PaginatedResult<Department>>('departments', {
      params: toHttpParams(query),
    });
  }

  createDepartment(body: DepartmentInput): Observable<Department> {
    return this.http.post<Department>('departments', body);
  }

  updateDepartment(id: string, body: Partial<DepartmentInput>): Observable<Department> {
    return this.http.patch<Department>(`departments/${id}`, body);
  }

  /** Inativação lógica (`DELETE` não apaga a linha). */
  inactivateDepartment(id: string): Observable<void> {
    return this.http.delete<void>(`departments/${id}`);
  }

  listPositions(query: ListQuery = {}): Observable<PaginatedResult<Position>> {
    return this.http.get<PaginatedResult<Position>>('positions', { params: toHttpParams(query) });
  }

  createPosition(body: PositionInput): Observable<Position> {
    return this.http.post<Position>('positions', body);
  }

  updatePosition(id: string, body: Partial<PositionInput>): Observable<Position> {
    return this.http.patch<Position>(`positions/${id}`, body);
  }

  inactivatePosition(id: string): Observable<void> {
    return this.http.delete<void>(`positions/${id}`);
  }
}
