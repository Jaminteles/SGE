import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { PermissionsService } from '../core/authz/permissions.service';
import type { PermissionCheck } from '../core/authz/permissions';

interface AbaFinanceiro {
  path: string;
  label: string;
  permissions: PermissionCheck;
}

/** Sub-navegação do módulo Financeiro (UI-024 a UI-029). */
const ABAS: AbaFinanceiro[] = [
  {
    path: 'titulos',
    label: 'Contas a pagar e receber',
    permissions: { all: ['financial-entries:READ'] },
  },
  {
    path: 'aprovacoes',
    label: 'Aprovações',
    permissions: { all: ['financial-entries:READ', 'financial-entries:APPROVE'] },
  },
  { path: 'inadimplencia', label: 'Inadimplência', permissions: { all: ['delinquency:READ'] } },
  { path: 'fluxo-caixa', label: 'Fluxo de caixa', permissions: { all: ['cash-flow:READ'] } },
  { path: 'cenarios', label: 'Cenários', permissions: { all: ['cash-flow-scenarios:READ'] } },
  { path: 'alertas', label: 'Alertas de caixa', permissions: { all: ['cash-alerts:READ'] } },
];

/**
 * Moldura do módulo Financeiro: faixa de abas mais o `router-outlet`.
 *
 * Aba sem permissão não é desenhada — o usuário já está dentro do módulo, e
 * listar seção que só devolveria 403 não ajuda. A decisão real continua no
 * backend (PermissionsGuard + RLS).
 */
@Component({
  selector: 'sge-financeiro-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <nav class="abas" aria-label="Seções do financeiro">
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
export class FinanceiroShell {
  private readonly permissoes = inject(PermissionsService);

  protected readonly abas = computed(() =>
    ABAS.filter((aba) => this.permissoes.permite(aba.permissions)),
  );
}
