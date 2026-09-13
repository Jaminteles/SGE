import { Routes } from '@angular/router';

import { permissaoGuard } from '../core/auth/guards';
import type { PermissionCheck } from '../core/authz/permissions';

export interface AbaConciliacao {
  path: string;
  label: string;
  permissions: PermissionCheck;
}

/** Sub-navegação do módulo Conciliação (UI-048 a UI-053) — a mesma fonte das rotas. */
export const ABAS_CONCILIACAO: AbaConciliacao[] = [
  { path: 'movimentos', label: 'Movimentos', permissions: { all: ['reconciliation:READ'] } },
  { path: 'divergencias', label: 'Divergências', permissions: { all: ['reconciliation:READ'] } },
  { path: 'historico', label: 'Histórico', permissions: { all: ['reconciliation:READ'] } },
  { path: 'regras', label: 'Regras', permissions: { all: ['reconciliation-rules:READ'] } },
];

/**
 * Telas do módulo Conciliação (UI-048 a UI-053).
 *
 * Cada rota declara a permissão que o backend vai exigir, para não abrir uma
 * tela que só conseguiria mostrar 403. A autorização real continua no
 * `PermissionsGuard` + RLS a cada requisição.
 */
export const CONCILIACAO_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'movimentos' },
  {
    path: 'movimentos',
    loadComponent: () => import('./pending-page').then((m) => m.PendingPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['reconciliation:READ'] } },
    title: 'Movimentos a conciliar · SGE',
  },
  {
    path: 'movimentos/:id',
    loadComponent: () => import('./matching-page').then((m) => m.MatchingPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['reconciliation:READ'] } },
    title: 'Conciliar movimento · SGE',
  },
  {
    path: 'divergencias',
    loadComponent: () => import('./divergences-page').then((m) => m.DivergencesPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['reconciliation:READ'] } },
    title: 'Divergências da conciliação · SGE',
  },
  {
    path: 'historico',
    loadComponent: () => import('./history-page').then((m) => m.HistoryPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['reconciliation:READ'] } },
    title: 'Histórico de conciliações · SGE',
  },
  {
    path: 'regras',
    loadComponent: () => import('./rules-page').then((m) => m.RulesPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['reconciliation-rules:READ'] } },
    title: 'Regras de conciliação · SGE',
  },
];
