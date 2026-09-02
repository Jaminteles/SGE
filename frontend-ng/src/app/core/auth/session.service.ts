import { Injectable, signal } from '@angular/core';

import { sessionStore } from './session-store';

/**
 * Estado da sessão para a interface.
 *
 * O armazenamento em si continua no `session-store` portado (access token em
 * memória, refresh em `sessionStorage`). Este service só publica o estado como
 * sinal e sinaliza a expiração — que é o que o interceptor precisa avisar e a
 * interface precisa observar, no lugar do `setSessionExpiredHandler` do React.
 *
 * Cresce na etapa seguinte da migração, com o perfil do usuário e o login.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly _expirada = signal(false);

  /** Vira `true` quando a renovação falha — a interface reage mandando ao login. */
  readonly expirada = this._expirada.asReadonly();

  get accessToken(): string | null {
    return sessionStore.getAccessToken();
  }

  get refreshToken(): string | null {
    return sessionStore.getRefreshToken();
  }

  get autenticado(): boolean {
    return sessionStore.getAccessToken() !== null;
  }

  definirTokens(tokens: { accessToken: string; refreshToken: string }): void {
    sessionStore.set(tokens);
    this._expirada.set(false);
  }

  /** Saída deliberada do usuário: limpa sem marcar expiração. */
  encerrar(): void {
    sessionStore.clear();
    this._expirada.set(false);
  }

  /** A sessão caiu sozinha (renovação impossível ou recusada). */
  expirar(): void {
    sessionStore.clear();
    this._expirada.set(true);
  }
}
