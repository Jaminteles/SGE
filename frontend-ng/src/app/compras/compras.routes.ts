import { Routes } from '@angular/router';

import { permissaoGuard } from '../core/auth/guards';

/**
 * Telas do módulo Compras (UI-030 a UI-035).
 *
 * Cada rota declara a permissão que o backend vai exigir, para não abrir uma
 * tela que só conseguiria mostrar 403. A autorização real continua no
 * `PermissionsGuard` + RLS a cada requisição.
 */
export const COMPRAS_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'pedidos' },
  {
    path: 'pedidos',
    loadComponent: () => import('./purchase-orders-page').then((m) => m.PurchaseOrdersPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['purchase-orders:READ'] } },
    title: 'Pedidos de compra · SGE',
  },
  {
    path: 'pedidos/novo',
    loadComponent: () => import('./purchase-order-form-page').then((m) => m.PurchaseOrderFormPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['purchase-orders:CREATE'] } },
    title: 'Novo pedido de compra · SGE',
  },
  {
    path: 'pedidos/:id',
    loadComponent: () =>
      import('./purchase-order-detail-page').then((m) => m.PurchaseOrderDetailPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['purchase-orders:READ'] } },
    title: 'Pedido de compra · SGE',
  },
  {
    path: 'pedidos/:id/editar',
    loadComponent: () => import('./purchase-order-form-page').then((m) => m.PurchaseOrderFormPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['purchase-orders:READ', 'purchase-orders:UPDATE'] } },
    title: 'Editar pedido de compra · SGE',
  },
  {
    path: 'pedidos/:id/receber',
    loadComponent: () => import('./goods-receipt-form-page').then((m) => m.GoodsReceiptFormPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['purchase-orders:READ', 'goods-receipts:CREATE'] } },
    title: 'Receber mercadoria · SGE',
  },
  {
    path: 'recebimentos',
    loadComponent: () => import('./goods-receipts-page').then((m) => m.GoodsReceiptsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['goods-receipts:READ'] } },
    title: 'Recebimentos · SGE',
  },
  {
    path: 'recebimentos/:id',
    loadComponent: () =>
      import('./goods-receipt-detail-page').then((m) => m.GoodsReceiptDetailPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['goods-receipts:READ'] } },
    title: 'Recebimento · SGE',
  },
  {
    path: 'historico',
    loadComponent: () => import('./purchase-history-page').then((m) => m.PurchaseHistoryPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['purchase-history:READ'] } },
    title: 'Histórico de compras · SGE',
  },
];
