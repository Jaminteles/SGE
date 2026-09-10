import { Routes } from '@angular/router';

import { permissaoGuard } from '../core/auth/guards';

/**
 * Telas do módulo Estoque (UI-021 a UI-023).
 *
 * Cada rota declara a permissão que o backend vai exigir, para não abrir uma
 * tela que só conseguiria mostrar 403. A autorização real continua no
 * `PermissionsGuard` + RLS a cada requisição.
 */
export const ESTOQUE_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'saldos' },
  {
    path: 'saldos',
    loadComponent: () => import('./stock-balances-page').then((m) => m.StockBalancesPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['stock:READ'] } },
    title: 'Saldos por local · SGE',
  },
  {
    path: 'locais',
    loadComponent: () => import('./stock-locations-page').then((m) => m.StockLocationsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['stock-locations:READ'] } },
    title: 'Locais de estoque · SGE',
  },
  {
    path: 'movimentacoes',
    loadComponent: () => import('./stock-movements-page').then((m) => m.StockMovementsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['stock-movements:READ'] } },
    title: 'Movimentações · SGE',
  },
  {
    path: 'inventarios',
    loadComponent: () => import('./inventories-page').then((m) => m.InventoriesPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['inventories:READ'] } },
    title: 'Inventário · SGE',
  },
  {
    path: 'inventarios/:id',
    loadComponent: () => import('./inventory-detail-page').then((m) => m.InventoryDetailPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['inventories:READ'] } },
    title: 'Inventário · SGE',
  },
];
