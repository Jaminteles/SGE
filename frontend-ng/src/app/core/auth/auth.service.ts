import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AuthApiService } from '../api/auth-api.service';
import { TokenRefreshService } from '../api/token-refresh.service';
import type { UserProfile } from '../api/types';
import { activeCompanyStore } from '../company/active-company-store';
import { accessTokenExpiresAt } from './session-store';
import { SessionService } from './session.service';

export type StatusSessao = 'carregando' | 'autenticado' | 'anonimo';

/**
 * Sessão do usuário (UI-002) — substitui o `AuthProvider` do projeto React.
 *
 * Fica **acima** do `SessionService` de propósito. Aquele guarda só os tokens e
 * é usado pelo `TokenRefreshService`; se o perfil do usuário e o login também
 * morassem lá, `TokenRefreshService → SessionService → AuthApiService →
 * interceptor → TokenRefreshService` fecharia um ciclo de injeção. Com a
 * separação, a dependência anda em uma direção só.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(AuthApiService);
  private readonly sessao = inject(SessionService);
  private readonly renovacao = inject(TokenRefreshService);

  private readonly _usuario = signal<UserProfile | null>(null);
  private readonly _status = signal<StatusSessao>('carregando');
  private readonly _expiraEm = signal<number | null>(null);

  readonly usuario = this._usuario.asReadonly();
  readonly status = this._status.asReadonly();
  /** Momento (ms) em que o access token expira, quando conhecido (UI-005). */
  readonly expiraEm = this._expiraEm.asReadonly();

  readonly autenticado = computed(() => this._status() === 'autenticado');
  readonly superAdmin = computed(() => this._usuario()?.isSuperAdmin ?? false);

  constructor() {
    // O interceptor marca a sessão como expirada quando não há mais como
    // renovar. Este efeito é a ponte que o `setSessionExpiredHandler` do
    // projeto React fazia com um callback global.
    effect(() => {
      if (this.sessao.expirada()) this.limparEstado();
    });
  }

  private restauracao: Promise<void> | null = null;

  /**
   * Restauração única, esperada pelas guardas de rota.
   *
   * A primeira navegação aguarda; as seguintes reaproveitam o mesmo resultado.
   * Fica fora do `provideAppInitializer` de propósito: bloquear o bootstrap
   * numa chamada de rede deixaria a tela em branco se o backend estivesse fora
   * do ar — assim o app sobe e só a navegação espera.
   */
  prontidao(): Promise<void> {
    this.restauracao ??= this.restaurar();
    return this.restauracao;
  }

  /**
   * Restaura a sessão da aba a partir do refresh token guardado. Se falhar, o
   * app simplesmente cai na tela de login — nenhum erro é propagado.
   */
  async restaurar(): Promise<void> {
    if (!this.sessao.refreshToken) {
      this._status.set('anonimo');
      return;
    }

    const renovou = await firstValueFrom(this.renovacao.garantirRenovacao());
    if (!renovou) {
      this.encerrarLocal();
      return;
    }

    try {
      const perfil = await firstValueFrom(this.api.me());
      this._usuario.set(perfil);
      this.sincronizarExpiracao();
      this._status.set('autenticado');
    } catch {
      this.encerrarLocal();
    }
  }

  async login(email: string, senha: string): Promise<UserProfile> {
    const resultado = await firstValueFrom(this.api.login(email, senha));
    this.sessao.definirTokens({
      accessToken: resultado.accessToken,
      refreshToken: resultado.refreshToken,
    });
    this._usuario.set(resultado.user);
    this.sincronizarExpiracao();
    this._status.set('autenticado');
    this.marcarRestaurado();
    return resultado.user;
  }

  async logout(): Promise<void> {
    const refreshToken = this.sessao.refreshToken;
    if (refreshToken) {
      try {
        await firstValueFrom(this.api.logout(refreshToken));
      } catch {
        // A sessão local cai mesmo se a API falhar — o usuário pediu para sair.
      }
    }
    this.encerrarLocal();
  }

  /** Renovação sob demanda (botão do aviso de expiração). */
  async renovar(): Promise<boolean> {
    const renovou = await firstValueFrom(this.renovacao.garantirRenovacao());
    if (!renovou) {
      this.encerrarLocal();
      return false;
    }
    this.sincronizarExpiracao();
    return true;
  }

  private encerrarLocal(): void {
    this.sessao.encerrar();
    this.limparEstado();
  }

  private limparEstado(): void {
    activeCompanyStore.set(null);
    this._usuario.set(null);
    this._expiraEm.set(null);
    this._status.set('anonimo');
    this.marcarRestaurado();
  }

  /**
   * Quando a sessão já é conhecida — acabou de entrar ou de sair — não há nada
   * a restaurar. Sem isso, uma guarda que rodasse depois de um login feito
   * fora do fluxo normal dispararia um `/auth/refresh` desnecessário.
   * O `??=` respeita uma restauração que já esteja em andamento.
   */
  private marcarRestaurado(): void {
    this.restauracao ??= Promise.resolve();
  }

  private sincronizarExpiracao(): void {
    this._expiraEm.set(accessTokenExpiresAt(this.sessao.accessToken));
  }
}
