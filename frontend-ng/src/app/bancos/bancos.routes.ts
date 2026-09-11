import { Routes } from '@angular/router';

import { permissaoGuard } from '../core/auth/guards';
import type { PermissionCheck } from '../core/authz/permissions';

export interface AbaBancos {
  path: string;
  label: string;
  permissions: PermissionCheck;
}

/** Sub-navegação do módulo Bancos (UI-042 a UI-047) — a mesma fonte das rotas. */
export const ABAS_BANCOS: AbaBancos[] = [
  { path: 'contas', label: 'Contas', permissions: { all: ['company-bank-accounts:READ'] } },
  { path: 'ordens', label: 'Ordens de pagamento', permissions: { all: ['payments:READ'] } },
  { path: 'extratos', label: 'Extratos', permissions: { all: ['bank-statements:READ'] } },
  { path: 'movimentos', label: 'Movimentos', permissions: { all: ['bank-statements:READ'] } },
  {
    path: 'operacoes',
    label: 'Operações assíncronas',
    permissions: { any: ['payments:READ', 'integration-events:READ'] },
  },
];

/**
 * Telas do módulo Bancos (UI-042 a UI-047).
 *
 * Cada rota declara a permissão que o backend vai exigir, para não abrir uma
 * tela que só conseguiria mostrar 403. A autorização real continua no
 * `PermissionsGuard` + RLS a cada requisição.
 */
export const BANCOS_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'contas' },
  {
    path: 'contas',
    loadComponent: () => import('./bank-accounts-page').then((m) => m.BankAccountsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['company-bank-accounts:READ'] } },
    title: 'Contas bancárias · SGE',
  },
  {
    path: 'ordens',
    loadComponent: () => import('./payments-page').then((m) => m.PaymentsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['payments:READ'] } },
    title: 'Ordens de pagamento · SGE',
  },
  {
    // A conta de origem sai da lista de contas: sem lê-las não há ordem a montar.
    path: 'ordens/nova',
    loadComponent: () => import('./payment-form-page').then((m) => m.PaymentFormPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['payments:CREATE', 'company-bank-accounts:READ'] } },
    title: 'Nova ordem de pagamento · SGE',
  },
  {
    path: 'ordens/:id',
    loadComponent: () => import('./payment-detail-page').then((m) => m.PaymentDetailPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['payments:READ'] } },
    title: 'Ordem de pagamento · SGE',
  },
  {
    path: 'extratos',
    loadComponent: () => import('./statements-page').then((m) => m.StatementsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['bank-statements:READ'] } },
    title: 'Extratos bancários · SGE',
  },
  {
    path: 'movimentos',
    loadComponent: () => import('./bank-transactions-page').then((m) => m.BankTransactionsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['bank-statements:READ'] } },
    title: 'Movimentos bancários · SGE',
  },
  {
    path: 'operacoes',
    loadComponent: () => import('./operations-page').then((m) => m.OperationsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { any: ['payments:READ', 'integration-events:READ'] } },
    title: 'Operações assíncronas · SGE',
  },
];
