import { Routes } from '@angular/router';

import { permissaoGuard } from '../core/auth/guards';
import type { PermissionCheck } from '../core/authz/permissions';

export interface AbaContabil {
  path: string;
  label: string;
  permissions: PermissionCheck;
}

/** Sub-navegação do módulo Contábil (UI-054 a UI-060) — a mesma fonte das rotas. */
export const ABAS_CONTABIL: AbaContabil[] = [
  { path: 'plano', label: 'Plano de contas', permissions: { all: ['ledger-accounts:READ'] } },
  {
    path: 'classificacao',
    label: 'Classificação',
    permissions: { all: ['accounting-classifications:READ'] },
  },
  { path: 'lancamentos', label: 'Lançamentos', permissions: { all: ['journal-entries:READ'] } },
  { path: 'razao', label: 'Razão', permissions: { all: ['accounting-reports:READ'] } },
  { path: 'balancete', label: 'Balancete', permissions: { all: ['accounting-reports:READ'] } },
  { path: 'dre', label: 'DRE', permissions: { all: ['accounting-reports:READ'] } },
  { path: 'periodos', label: 'Períodos', permissions: { all: ['accounting-periods:READ'] } },
  { path: 'exportacao', label: 'Exportação', permissions: { all: ['accounting-reports:EXPORT'] } },
];

/**
 * Telas do módulo Contábil (UI-054 a UI-060).
 *
 * Cada rota declara a permissão que o backend vai exigir, para não abrir uma
 * tela que só conseguiria mostrar 403. A autorização real continua no
 * `PermissionsGuard` + RLS a cada requisição.
 */
export const CONTABIL_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'plano' },
  {
    path: 'plano',
    loadComponent: () => import('./chart-of-accounts-page').then((m) => m.ChartOfAccountsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['ledger-accounts:READ'] } },
    title: 'Plano de contas · SGE',
  },
  {
    path: 'classificacao',
    loadComponent: () => import('./classifications-page').then((m) => m.ClassificationsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['accounting-classifications:READ'] } },
    title: 'Classificação contábil · SGE',
  },
  {
    path: 'lancamentos',
    loadComponent: () => import('./journal-entries-page').then((m) => m.JournalEntriesPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['journal-entries:READ'] } },
    title: 'Lançamentos contábeis · SGE',
  },
  {
    path: 'lancamentos/novo',
    loadComponent: () => import('./journal-entry-form-page').then((m) => m.JournalEntryFormPage),
    canActivate: [permissaoGuard],
    // Escolher a conta da partida exige ler o plano.
    data: { permissions: { all: ['journal-entries:CREATE', 'ledger-accounts:READ'] } },
    title: 'Novo lançamento contábil · SGE',
  },
  {
    path: 'razao',
    loadComponent: () => import('./ledger-page').then((m) => m.LedgerPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['accounting-reports:READ'] } },
    title: 'Razão contábil · SGE',
  },
  {
    path: 'balancete',
    loadComponent: () => import('./trial-balance-page').then((m) => m.TrialBalancePage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['accounting-reports:READ'] } },
    title: 'Balancete de verificação · SGE',
  },
  {
    path: 'dre',
    loadComponent: () => import('./income-statement-page').then((m) => m.IncomeStatementPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['accounting-reports:READ'] } },
    title: 'DRE · SGE',
  },
  {
    path: 'periodos',
    loadComponent: () => import('./periods-page').then((m) => m.PeriodsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['accounting-periods:READ'] } },
    title: 'Períodos contábeis · SGE',
  },
  {
    path: 'exportacao',
    loadComponent: () => import('./export-page').then((m) => m.ExportPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['accounting-reports:EXPORT'] } },
    title: 'Exportação contábil · SGE',
  },
];
