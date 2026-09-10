import { Routes } from '@angular/router';

import { permissaoGuard } from '../core/auth/guards';

/**
 * Telas do módulo Financeiro (UI-024 a UI-029).
 *
 * Cada rota declara a permissão que o backend vai exigir, para não abrir uma
 * tela que só conseguiria mostrar 403. A autorização real continua no
 * `PermissionsGuard` + RLS a cada requisição.
 */
export const FINANCEIRO_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'titulos' },
  {
    path: 'titulos',
    loadComponent: () => import('./entries-page').then((m) => m.EntriesPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['financial-entries:READ'] } },
    title: 'Contas a pagar e receber · SGE',
  },
  {
    path: 'titulos/novo',
    loadComponent: () => import('./entry-form-page').then((m) => m.EntryFormPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['financial-entries:CREATE'] } },
    title: 'Novo título · SGE',
  },
  {
    path: 'titulos/:id',
    loadComponent: () => import('./entry-detail-page').then((m) => m.EntryDetailPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['financial-entries:READ'] } },
    title: 'Título · SGE',
  },
  {
    path: 'titulos/:id/editar',
    loadComponent: () => import('./entry-form-page').then((m) => m.EntryFormPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['financial-entries:UPDATE'] } },
    title: 'Editar título · SGE',
  },
  {
    path: 'aprovacoes',
    loadComponent: () => import('./approvals-page').then((m) => m.ApprovalsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['financial-entries:READ', 'financial-entries:APPROVE'] } },
    title: 'Aprovação de títulos · SGE',
  },
  {
    path: 'inadimplencia',
    loadComponent: () => import('./delinquency-page').then((m) => m.DelinquencyPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['delinquency:READ'] } },
    title: 'Inadimplência · SGE',
  },
  {
    path: 'fluxo-caixa',
    loadComponent: () => import('./cash-flow-page').then((m) => m.CashFlowPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['cash-flow:READ'] } },
    title: 'Fluxo de caixa · SGE',
  },
  {
    path: 'cenarios',
    loadComponent: () => import('./scenarios-page').then((m) => m.ScenariosPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['cash-flow-scenarios:READ'] } },
    title: 'Cenários de caixa · SGE',
  },
  {
    path: 'alertas',
    loadComponent: () => import('./cash-alerts-page').then((m) => m.CashAlertsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['cash-alerts:READ'] } },
    title: 'Alertas de caixa · SGE',
  },
];
