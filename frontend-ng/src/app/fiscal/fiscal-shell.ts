import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { PermissionsService } from '../core/authz/permissions.service';
import type { PermissionCheck } from '../core/authz/permissions';

interface AbaFiscal {
  path: string;
  label: string;
  permissions: PermissionCheck;
}

/** Sub-navegação do módulo Fiscal — documentos fiscais (UI-036 a UI-041). */
const ABAS: AbaFiscal[] = [
  { path: 'documentos', label: 'Documentos', permissions: { all: ['fiscal-documents:READ'] } },
  { path: 'importar', label: 'Importar XML', permissions: { all: ['fiscal-documents:CREATE'] } },
  { path: 'coleta', label: 'Coleta automática', permissions: { all: ['fiscal-documents:READ'] } },
];

/**
 * Moldura do módulo Fiscal: a faixa de abas mais o `router-outlet` das telas.
 * Aba sem permissão não é desenhada — só devolveria 403.
 */
@Component({
  selector: 'sge-fiscal-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <nav class="abas" aria-label="Seções do fiscal">
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
export class FiscalShell {
  private readonly permissoes = inject(PermissionsService);

  protected readonly abas = computed(() =>
    ABAS.filter((aba) => this.permissoes.permite(aba.permissions)),
  );
}
