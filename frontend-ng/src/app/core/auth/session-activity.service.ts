import { DestroyRef, Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { config } from '../lib/config';
import { AuthService } from './auth.service';

/** Eventos que contam como "o usuário está aqui". */
const SINAIS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Expiração por inatividade e renovação silenciosa (RNF-002 — UI-089).
 *
 * O aviso de expiração (`SessionExpiryBanner`) resolve o caso de quem está na
 * tela: aparece o botão, a pessoa clica, a sessão continua. Faltavam as duas
 * pontas opostas:
 *
 * - **Quem saiu da frente do computador.** Uma sessão aberta numa máquina
 *   destravada, com títulos e ordens de pagamento na tela, não pode ficar
 *   renovando sozinha para sempre. Passado o tempo de inatividade, a sessão cai
 *   e o refresh token é descartado.
 * - **Quem está trabalhando.** Para essa pessoa, tomar 401 no meio de um
 *   formulário preenchido é perder o trabalho. Enquanto houver interação
 *   recente, o token é renovado **antes** de expirar, e o 401 nunca chega.
 *
 * A checagem é por relógio, não por `setTimeout` no momento da expiração: a aba
 * em segundo plano tem os temporizadores estrangulados pelo navegador, e um
 * `setTimeout` de meia hora acorda tarde e erra os dois lados.
 *
 * Nada disto é segurança por si: o backend continua validando cada token. Isto
 * reduz a janela em que um token válido fica exposto numa tela abandonada.
 */
@Injectable({ providedIn: 'root' })
export class SessionActivityService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private ultimaAtividade = Date.now();
  private renovando = false;

  /** Chamado uma vez pela moldura autenticada. */
  iniciar(): void {
    if (typeof document === 'undefined') return;

    const marcar = () => {
      this.ultimaAtividade = Date.now();
    };
    for (const sinal of SINAIS) {
      document.addEventListener(sinal, marcar, { passive: true, capture: true });
    }
    // Voltar para a aba conta como atividade: o usuário está olhando de novo.
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') marcar();
    };
    document.addEventListener('visibilitychange', aoVoltar);

    const relogio = setInterval(() => void this.verificar(), config.sessionCheckMs);

    this.destroyRef.onDestroy(() => {
      clearInterval(relogio);
      for (const sinal of SINAIS) {
        document.removeEventListener(sinal, marcar, { capture: true });
      }
      document.removeEventListener('visibilitychange', aoVoltar);
    });
  }

  /** Exposto para o teste: uma volta do relógio, sem esperar o intervalo. */
  async verificar(): Promise<void> {
    if (!this.auth.autenticado()) return;

    const ocioso = Date.now() - this.ultimaAtividade;

    if (ocioso >= config.sessionIdleMs) {
      await this.auth.logout();
      await this.router.navigate(['/login'], { queryParams: { motivo: 'inatividade' } });
      return;
    }

    const expiraEm = this.auth.expiraEm();
    if (expiraEm === null || this.renovando) return;
    if (expiraEm - Date.now() > config.sessionRenewAheadMs) return;

    this.renovando = true;
    try {
      await this.auth.renovar();
    } finally {
      this.renovando = false;
    }
  }
}
