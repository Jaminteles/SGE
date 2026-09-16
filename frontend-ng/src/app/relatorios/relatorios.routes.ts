import { Routes } from '@angular/router';

import { permissaoGuard } from '../core/auth/guards';
import type { PermissionCheck } from '../core/authz/permissions';

export interface AbaRelatorio {
  path: string;
  label: string;
  permissions: PermissionCheck;
}

/** Sub-navegação do módulo Relatórios (UI-068 a UI-073) — a mesma fonte das rotas. */
export const ABAS_RELATORIOS: AbaRelatorio[] = [
  { path: 'financeiro', label: 'Financeiro', permissions: { all: ['dashboards:READ'] } },
  { path: 'carteira', label: 'Carteira', permissions: { all: ['dashboards:READ'] } },
  { path: 'caixa', label: 'Caixa e resultado', permissions: { all: ['dashboards:READ'] } },
  { path: 'compras', label: 'Compras e estoque', permissions: { all: ['dashboards:READ'] } },
  { path: 'pessoal', label: 'Pessoal', permissions: { all: ['dashboards:READ'] } },
  {
    path: 'contabil-fiscal',
    label: 'Contábil e fiscal',
    permissions: { all: ['reports:READ'] },
  },
];

/**
 * Telas de painéis e relatórios (UI-068 a UI-073).
 *
 * Cada rota declara a permissão que o backend vai exigir, para não abrir uma
 * tela que só conseguiria mostrar 403. A autorização real continua no
 * `PermissionsGuard` + RLS a cada requisição — e as peças contábil e fiscal
 * exigem, além de `reports:READ`, a permissão do módulo de origem, conferida
 * dentro da própria tela.
 */
export const RELATORIOS_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'financeiro' },
  {
    path: 'financeiro',
    loadComponent: () =>
      import('./financial-dashboard-page').then((m) => m.FinancialDashboardPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['dashboards:READ'] } },
    title: 'Dashboard financeiro · SGE',
  },
  {
    path: 'carteira',
    loadComponent: () => import('./portfolio-page').then((m) => m.PortfolioPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['dashboards:READ'] } },
    title: 'Contas a pagar e a receber · SGE',
  },
  {
    path: 'caixa',
    loadComponent: () => import('./cash-flow-report-page').then((m) => m.CashFlowReportPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['dashboards:READ'] } },
    title: 'Fluxo de caixa e resultado · SGE',
  },
  {
    path: 'compras',
    loadComponent: () => import('./purchasing-page').then((m) => m.PurchasingPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['dashboards:READ'] } },
    title: 'Compras, estoque e fornecedores · SGE',
  },
  {
    path: 'pessoal',
    loadComponent: () => import('./workforce-page').then((m) => m.WorkforcePage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['dashboards:READ'] } },
    title: 'Funcionários e centros de custo · SGE',
  },
  {
    path: 'contabil-fiscal',
    loadComponent: () => import('./statements-page').then((m) => m.StatementsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['reports:READ'] } },
    title: 'Relatórios contábeis e fiscais · SGE',
  },
];
