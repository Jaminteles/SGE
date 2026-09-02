import { Component, computed, input } from '@angular/core';

export type TomAlerta = 'erro' | 'aviso' | 'info' | 'sucesso';

/**
 * Bloco de feedback padrão das telas (UI-005).
 *
 * Erro usa `role="alert"`, que faz o leitor de tela interromper e anunciar na
 * hora; os demais tons usam `role="status"`, que espera uma brecha. Um aviso de
 * sucesso não deve cortar a leitura do usuário.
 */
@Component({
  selector: 'sge-alert',
  template: `
    <div class="alerta alerta--{{ tom() }}" [attr.role]="papel()">
      <p class="alerta__titulo">{{ titulo() }}</p>
      @if (mensagem()) {
        <p class="alerta__mensagem">{{ mensagem() }}</p>
      }
      @if (detalhes().length > 1) {
        <ul class="alerta__detalhes">
          @for (detalhe of detalhes(); track detalhe) {
            <li>{{ detalhe }}</li>
          }
        </ul>
      }
      <ng-content />
    </div>
  `,
})
export class Alert {
  readonly tom = input<TomAlerta>('erro');
  readonly titulo = input.required<string>();
  readonly mensagem = input('');
  /**
   * Itens de validação devolvidos pela API. A lista só aparece com mais de um:
   * com um só, ele já é a mensagem principal.
   */
  readonly detalhes = input<string[]>([]);

  protected readonly papel = computed(() => (this.tom() === 'erro' ? 'alert' : 'status'));
}
