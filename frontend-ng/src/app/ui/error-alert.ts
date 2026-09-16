import { Component, computed, input } from '@angular/core';

import { ApiError, errorMessage, errorTitle } from '../core/api/errors';
import { Alert } from './alert';

/** Traduz qualquer erro de API para o alerta padrão da interface (UI-005). */
@Component({
  selector: 'sge-error-alert',
  imports: [Alert],
  template: `
    @if (erro()) {
      <sge-alert
        tom="erro"
        [titulo]="titulo()"
        [mensagem]="mensagem()"
        [detalhes]="detalhes()"
      >
        @if (ocorrencia(); as id) {
          <p class="alerta__ocorrencia">
            Código da ocorrência: <code>{{ id }}</code>
            <span class="sr-only">— informe este código ao suporte.</span>
          </p>
        }
      </sge-alert>
    }
  `,
  styles: `
    .alerta__ocorrencia {
      margin: 0.5rem 0 0;
      font-size: 0.75rem;
      opacity: 0.85;
    }
  `,
})
export class ErrorAlert {
  readonly erro = input<unknown>(null);

  protected readonly titulo = computed(() => errorTitle(this.erro()));
  protected readonly mensagem = computed(() => errorMessage(this.erro()));

  protected readonly detalhes = computed(() => {
    const erro = this.erro();
    return erro instanceof ApiError ? erro.details : [];
  });

  /**
   * Correlation id da requisição que falhou (RNF-010 — UI-090).
   *
   * Só aparece em falha do servidor ou de rede: num 400 de validação o usuário
   * corrige o campo e segue, e o código seria ruído. Num 500, é com ele que o
   * suporte acha a requisição no log — o mesmo id que o backend registrou.
   */
  protected readonly ocorrencia = computed(() => {
    const erro = this.erro();
    if (!(erro instanceof ApiError) || !erro.correlationId) return null;
    return erro.status === 0 || erro.status >= 500 ? erro.correlationId : null;
  });
}
