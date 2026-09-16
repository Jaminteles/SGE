import { Routes } from '@angular/router';

import { permissaoGuard } from '../core/auth/guards';
import type { PermissionCheck } from '../core/authz/permissions';

export interface AbaIntegracao {
  path: string;
  label: string;
  permissions: PermissionCheck;
}

/** Sub-navegação do módulo Integrações (UI-074/UI-075) — a mesma fonte das rotas. */
export const ABAS_INTEGRACOES: AbaIntegracao[] = [
  { path: 'provedores', label: 'Integrações', permissions: { all: ['integrations:READ'] } },
  { path: 'monitoramento', label: 'Monitoramento', permissions: { all: ['integrations:READ'] } },
];

/**
 * Telas de administração e monitoramento das integrações (UI-074/UI-075).
 *
 * Cada rota declara a permissão que o backend vai exigir, para não abrir uma
 * tela que só conseguiria mostrar 403. A autorização real continua no
 * `PermissionsGuard` + RLS a cada requisição.
 */
export const INTEGRACOES_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'provedores' },
  {
    path: 'provedores',
    loadComponent: () => import('./integrations-page').then((m) => m.IntegrationsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['integrations:READ'] } },
    title: 'Integrações · SGE',
  },
  {
    path: 'monitoramento',
    loadComponent: () =>
      import('./integration-monitor-page').then((m) => m.IntegrationMonitorPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['integrations:READ'] } },
    title: 'Monitoramento das integrações · SGE',
  },
];
