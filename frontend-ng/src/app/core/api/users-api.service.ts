import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { semEmpresa } from './http-context';
import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  CreateMembershipInput,
  CreateUserInput,
  MembershipRow,
  PaginatedResult,
  UpdateMembershipInput,
  UpdateUserInput,
  User,
} from './types';

/**
 * Usuários e vínculos com a empresa (RF-004 / RF-007 — UI-009).
 *
 * `/users` é rota de plataforma: exige super admin e não é escopada por
 * empresa. `/memberships` é da empresa ativa e exige `memberships:*`. São dois
 * níveis de autorização diferentes — a tela precisa tratar o 403 de `/users`
 * sem derrubar a listagem de vínculos.
 */
@Injectable({ providedIn: 'root' })
export class UsersApiService {
  private readonly http = inject(HttpClient);

  listUsers(query: ListQuery = {}): Observable<PaginatedResult<User>> {
    return this.http.get<PaginatedResult<User>>('users', {
      params: toHttpParams(query),
      context: semEmpresa(),
    });
  }

  createUser(body: CreateUserInput): Observable<User> {
    return this.http.post<User>('users', body, { context: semEmpresa() });
  }

  updateUser(id: string, body: UpdateUserInput): Observable<User> {
    return this.http.patch<User>(`users/${id}`, body, { context: semEmpresa() });
  }

  listMemberships(query: ListQuery = {}): Observable<PaginatedResult<MembershipRow>> {
    return this.http.get<PaginatedResult<MembershipRow>>('memberships', {
      params: toHttpParams(query),
    });
  }

  createMembership(body: CreateMembershipInput): Observable<MembershipRow> {
    return this.http.post<MembershipRow>('memberships', body);
  }

  updateMembership(id: string, body: UpdateMembershipInput): Observable<MembershipRow> {
    return this.http.patch<MembershipRow>(`memberships/${id}`, body);
  }

  removeMembership(id: string): Observable<void> {
    return this.http.delete<void>(`memberships/${id}`);
  }
}
