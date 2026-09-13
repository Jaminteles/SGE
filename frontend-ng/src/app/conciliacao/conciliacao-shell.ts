import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { PermissionsService } from '../core/authz/permissions.service';
import { ABAS_CONCILIACAO } from './conciliacao.routes';

/**
 * Moldura do módulo Conciliação: a faixa de abas mais o `router-outlet`.
 *
 * Aba sem permissão não é desenhada — listar seção que só devolveria 403 não
 * ajuda quem já está dentro do módulo.
 */
@Component({
  selector: 'sge-conciliacao-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <nav class="abas" aria-label="Seções da conciliação">
      @for (aba of abas(); track aba.path) {
        <a
          class="abas__item"
          [routerLink]="aba.path"
          routerLinkActive="abas__item--ativa"
          [routerLinkActiveOptions]="{ exact: false }"
        >
          {{ aba.label }}
        </a>
      }
    </nav>

    <router-outlet />
  `,
  styles: `
    .abas {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-bottom: 1rem;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .abas__item {
      padding: 0.5rem 0.75rem;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--p-text-muted-color);
      text-decoration: none;
      border-bottom: 2px solid transparent;
    }
    .abas__item:hover {
      color: var(--p-text-color);
    }
    .abas__item--ativa {
      color: var(--p-primary-color);
      border-bottom-color: var(--p-primary-color);
    }
  `,
})
export class ConciliacaoShell {
  private readonly permissoes = inject(PermissionsService);

  protected readonly abas = computed(() =>
    ABAS_CONCILIACAO.filter((aba) => this.permissoes.permite(aba.permissions)),
  );
}
