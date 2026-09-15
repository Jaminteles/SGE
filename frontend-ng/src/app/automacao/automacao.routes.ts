import { Routes } from '@angular/router';

import { permissaoGuard } from '../core/auth/guards';
import type { PermissionCheck } from '../core/authz/permissions';

export interface AbaAutomacao {
  path: string;
  label: string;
  permissions: PermissionCheck;
}

/** Sub-navegação do módulo Automação (UI-065 a UI-067) — a mesma fonte das rotas. */
export const ABAS_AUTOMACAO: AbaAutomacao[] = [
  { path: 'notificacoes', label: 'Notificações', permissions: { all: ['notifications:READ'] } },
  {
    path: 'preferencias',
    label: 'Preferências de alerta',
    permissions: { all: ['automation-rules:READ'] },
  },
  { path: 'regras', label: 'Regras', permissions: { all: ['automation-rules:READ'] } },
];

/**
 * Telas de notificações e automação (UI-065 a UI-067).
 *
 * Cada rota declara a permissão que o backend vai exigir, para não abrir uma
 * tela que só conseguiria mostrar 403. A autorização real continua no
 * `PermissionsGuard` + RLS a cada requisição — e, na caixa de entrada, também
 * no cruzamento com o usuário do token.
 */
export const AUTOMACAO_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'notificacoes' },
  {
    path: 'notificacoes',
    loadComponent: () => import('./notifications-page').then((m) => m.NotificationsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['notifications:READ'] } },
    title: 'Notificações · SGE',
  },
  {
    path: 'preferencias',
    loadComponent: () => import('./alert-preferences-page').then((m) => m.AlertPreferencesPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['automation-rules:READ'] } },
    title: 'Preferências de alerta · SGE',
  },
  {
    path: 'regras',
    loadComponent: () => import('./automation-rules-page').then((m) => m.AutomationRulesPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['automation-rules:READ'] } },
    title: 'Regras de automação · SGE',
  },
];
