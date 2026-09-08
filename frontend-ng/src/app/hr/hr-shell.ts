import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { PermissionsService } from '../core/authz/permissions.service';
import type { PermissionCheck } from '../core/authz/permissions';

interface AbaRh {
  path: string;
  label: string;
  permissions: PermissionCheck;
}

/** Sub-navegação do módulo RH (UI-013 a UI-017). */
const ABAS: AbaRh[] = [
  { path: 'funcionarios', label: 'Funcionários', permissions: { all: ['employees:READ'] } },
  {
    path: 'estrutura',
    label: 'Cargos e departamentos',
    permissions: { any: ['positions:READ', 'departments:READ'] },
  },
  {
    path: 'verbas',
    label: 'Salários e verbas',
    permissions: { any: ['payroll:READ', 'payroll-items:READ'] },
  },
  { path: 'reembolsos', label: 'Reembolsos', permissions: { all: ['reimbursements:READ'] } },
];

/**
 * Moldura do módulo RH: a faixa de abas do Figma mais o `router-outlet` das
 * telas.
 *
 * Igual à Administração, aba sem permissão não é desenhada — o usuário já está
 * dentro do módulo, e listar seção que só devolveria 403 não ajuda.
 */
@Component({
  selector: 'sge-hr-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <nav class="abas" aria-label="Seções do RH">
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
export class HrShell {
  private readonly permissoes = inject(PermissionsService);

  protected readonly abas = computed(() =>
    ABAS.filter((aba) => this.permissoes.permite(aba.permissions)),
  );
}
