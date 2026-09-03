import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../core/auth/auth.service';
import { PermissionsService } from '../core/authz/permissions.service';
import type { PermissionCheck } from '../core/authz/permissions';

interface AbaAdmin {
  path: string;
  label: string;
  permissions: PermissionCheck;
  /** Rota de plataforma: só aparece para o super admin (RF-001 / RF-007). */
  plataforma?: boolean;
}

/** Sub-navegação do módulo Administração (UI-007 a UI-011). */
const ABAS: AbaAdmin[] = [
  { path: 'empresa', label: 'Empresa', permissions: { all: ['company:READ'] } },
  { path: 'empresas', label: 'Empresas', permissions: {}, plataforma: true },
  { path: 'filiais', label: 'Filiais', permissions: { all: ['branches:READ'] } },
  {
    path: 'configuracoes',
    label: 'Configurações',
    permissions: { any: ['categories:READ', 'cost-centers:READ', 'settings:READ'] },
  },
  { path: 'usuarios', label: 'Usuários', permissions: { all: ['memberships:READ'] } },
  { path: 'perfis', label: 'Perfis e permissões', permissions: { all: ['roles:READ'] } },
  { path: 'alcadas', label: 'Alçadas', permissions: { all: ['approval-thresholds:READ'] } },
];

/**
 * Moldura do módulo Administração: a faixa de abas do Figma mais o
 * `router-outlet` das telas.
 *
 * Aba sem permissão simplesmente não é desenhada — diferente da navegação
 * lateral, que mostra o módulo bloqueado. Aqui o usuário já está dentro do
 * módulo; listar seções que ele não pode abrir só geraria 403.
 */
@Component({
  selector: 'sge-admin-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <nav class="abas" aria-label="Seções da administração">
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
export class AdminShell {
  private readonly permissoes = inject(PermissionsService);
  private readonly auth = inject(AuthService);

  protected readonly abas = computed(() =>
    ABAS.filter((aba) =>
      aba.plataforma ? this.auth.superAdmin() : this.permissoes.permite(aba.permissions),
    ),
  );
}
