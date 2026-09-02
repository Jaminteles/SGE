import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import { AuthService } from '../core/auth/auth.service';
import { config } from '../core/lib/config';
import { Alert } from '../ui/alert';

/**
 * Aviso de sessão prestes a expirar (UI-002 / UI-005).
 *
 * A expiração é lida do payload do access token, e serve **só** para avisar o
 * usuário antes da hora — a validade de verdade continua sendo verificada pelo
 * backend a cada requisição.
 *
 * O relógio bate a cada 15 s: o aviso é dado em minutos, então precisão maior
 * não muda o que aparece na tela e só gastaria detecção de mudanças.
 */
@Component({
  selector: 'sge-session-expiry-banner',
  imports: [ButtonModule, Alert],
  template: `
    @if (visivel()) {
      <sge-alert
        tom="aviso"
        [titulo]="titulo()"
        mensagem="Renove para continuar trabalhando sem perder o que está preenchido."
      >
        <div class="aviso__acoes">
          <p-button
            label="Renovar sessão"
            severity="secondary"
            size="small"
            [loading]="renovando()"
            (onClick)="renovar()"
          />
        </div>
      </sge-alert>
    }
  `,
  styles: `
    .aviso__acoes {
      margin-top: 0.6rem;
    }
  `,
})
export class SessionExpiryBanner {
  private readonly auth = inject(AuthService);

  private readonly agora = signal(Date.now());
  protected readonly renovando = signal(false);

  constructor() {
    const relogio = setInterval(() => this.agora.set(Date.now()), 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(relogio));
  }

  private readonly restanteMs = computed(() => {
    const expiraEm = this.auth.expiraEm();
    return expiraEm === null ? null : expiraEm - this.agora();
  });

  protected readonly visivel = computed(() => {
    const restante = this.restanteMs();
    // Já expirado não mostra aviso: aí quem age é o interceptor, renovando ou
    // derrubando a sessão.
    return restante !== null && restante > 0 && restante <= config.sessionWarningMs;
  });

  protected readonly titulo = computed(() => {
    const minutos = Math.max(1, Math.ceil((this.restanteMs() ?? 0) / 60_000));
    return `Sua sessão expira em ${minutos} minuto${minutos > 1 ? 's' : ''}.`;
  });

  protected async renovar(): Promise<void> {
    if (this.renovando()) return;
    this.renovando.set(true);
    try {
      await this.auth.renovar();
      this.agora.set(Date.now());
    } finally {
      this.renovando.set(false);
    }
  }
}
