import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { rotaPublica, semEmpresa } from './http-context';
import type { LoginResponse, MessageResponse, UserProfile } from './types';

/**
 * Rotas de autenticação (RF-008 / RF-009).
 *
 * Nenhuma é escopada por empresa. As de login e recuperação também não levam
 * token — daí o `rotaPublica()`, que substitui as flags `auth: false` e
 * `withCompany: false` do cliente do projeto React.
 */
@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);

  login(email: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(
      'auth/login',
      { email, password },
      { context: rotaPublica() },
    );
  }

  logout(refreshToken: string): Observable<void> {
    return this.http.post<void>('auth/logout', { refreshToken }, { context: rotaPublica() });
  }

  /** Precisa do token (é o perfil do usuário logado), mas não da empresa. */
  me(): Observable<UserProfile> {
    return this.http.get<UserProfile>('auth/me', { context: semEmpresa() });
  }

  forgotPassword(email: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(
      'auth/forgot-password',
      { email },
      { context: rotaPublica() },
    );
  }

  resetPassword(token: string, newPassword: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(
      'auth/reset-password',
      { token, newPassword },
      { context: rotaPublica() },
    );
  }
}
