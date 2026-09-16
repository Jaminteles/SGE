import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { OnboardingStatusService } from './onboarding-status.service';

/**
 * Chamada para o assistente na tela inicial (UI-079).
 *
 * Só aparece quando falta configuração de verdade — e desaparece sozinha quando
 * a empresa fica pronta. Enquanto a contagem não chega, não mostra nada: um
 * aviso de "empresa não configurada" que pisca e some é pior do que aviso
 * nenhum.
 */
@Component({
  selector: 'sge-onboarding-banner',
  imports: [RouterLink, ButtonModule],
  template: `
    @if (status.pendente()) {
      <div class="card convite">
        <div>
          <p class="convite__titulo">Esta empresa ainda não está configurada</p>
          <p class="convite__texto">
            Faltam filial, categorias ou centros de custo — sem eles não dá para lançar títulos. O
            assistente resolve em quatro passos.
          </p>
        </div>
        <p-button label="Abrir assistente" icon="pi pi-compass" routerLink="/onboarding" />
      </div>
    }
  `,
  styles: `
    .convite {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem 1.125rem;
      margin-bottom: 1rem;
      border-color: color-mix(in srgb, var(--p-primary-color) 45%, transparent);
      background: color-mix(in srgb, var(--p-primary-color) 8%, var(--p-content-background));
    }
    .convite__titulo {
      margin: 0 0 0.2rem;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--p-text-color);
    }
    .convite__texto {
      margin: 0;
      font-size: 0.78rem;
      color: var(--p-text-muted-color);
    }
    .convite p-button {
      margin-left: auto;
    }
  `,
})
export class OnboardingBanner {
  protected readonly status = inject(OnboardingStatusService);

  constructor() {
    this.status.carregar();
  }
}
