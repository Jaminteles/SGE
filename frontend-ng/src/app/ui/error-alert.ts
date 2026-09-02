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
      />
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
}
