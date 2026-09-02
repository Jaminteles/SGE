import { Component, input } from '@angular/core';

/**
 * Estado padrão de tela: vazio, sem permissão, erro ou "em construção"
 * (UI-081). Substitui o `StateScreen` do projeto React.
 */
@Component({
  selector: 'sge-state-screen',
  template: `
    <div class="estado">
      @if (icone()) {
        <i class="pi {{ icone() }}" aria-hidden="true"></i>
      }
      <h2>{{ titulo() }}</h2>
      @if (mensagem()) {
        <p>{{ mensagem() }}</p>
      }
      <ng-content />
    </div>
  `,
  styles: `
    .estado {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.6rem;
      padding: 3rem 1.5rem;
      text-align: center;
    }
    i {
      font-size: 1.6rem;
      color: var(--p-text-muted-color);
    }
    h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--p-text-color);
    }
    p {
      margin: 0;
      max-width: 32rem;
      font-size: 0.82rem;
      line-height: 1.5;
      color: var(--p-text-muted-color);
    }
  `,
})
export class StateScreen {
  readonly titulo = input.required<string>();
  readonly mensagem = input<string>('');
  readonly icone = input<string>('');
}
