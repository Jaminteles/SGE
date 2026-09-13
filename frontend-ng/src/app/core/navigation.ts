import type { PermissionCheck } from './authz/permissions';

export interface NavItem {
  /** Rota do módulo dentro da área autenticada. */
  path: string;
  label: string;
  /** Ícone do PrimeIcons. */
  icon: string;
  /** Permissões que liberam o item (RF-011). Vazio = disponível a todos. */
  permissions: PermissionCheck;
}

/**
 * Navegação por módulo (UI-004 / UI-005). Portada da fundação React, com o
 * ícone acrescentado — o original está em
 * `git show 483e777:frontend/src/layout/navigation.ts`.
 *
 * Item sem permissão aparece **desabilitado**, com o aviso "Sem permissão no
 * perfil", em vez de sumir: assim o usuário sabe que o módulo existe e pode
 * pedir acesso.
 */
export const NAVIGATION: NavItem[] = [
  { path: '/', label: 'Início', icon: 'pi-home', permissions: {} },
  {
    path: '/administracao',
    label: 'Administração',
    icon: 'pi-building',
    permissions: { any: ['company:READ', 'branches:READ', 'roles:READ', 'memberships:READ'] },
  },
  {
    path: '/cadastros',
    label: 'Cadastros',
    icon: 'pi-id-card',
    permissions: { any: ['partners:READ', 'products:READ'] },
  },
  {
    path: '/rh',
    label: 'RH',
    icon: 'pi-users',
    permissions: { any: ['employees:READ', 'payroll:READ'] },
  },
  {
    path: '/compras',
    label: 'Compras',
    icon: 'pi-shopping-cart',
    permissions: { any: ['purchase-orders:READ', 'goods-receipts:READ', 'purchase-history:READ'] },
  },
  {
    path: '/estoque',
    label: 'Estoque',
    icon: 'pi-box',
    permissions: { any: ['stock:READ', 'stock-movements:READ', 'inventories:READ'] },
  },
  {
    path: '/financeiro',
    label: 'Financeiro',
    icon: 'pi-wallet',
    permissions: {
      any: [
        'financial-entries:READ',
        'settlements:READ',
        'delinquency:READ',
        'cash-flow:READ',
        'cash-flow-scenarios:READ',
        'cash-alerts:READ',
      ],
    },
  },
  {
    path: '/bancos',
    label: 'Bancos',
    icon: 'pi-credit-card',
    permissions: { any: ['company-bank-accounts:READ', 'payments:READ', 'bank-statements:READ'] },
  },
  {
    path: '/conciliacao',
    label: 'Conciliação',
    icon: 'pi-sync',
    permissions: { any: ['reconciliation:READ', 'reconciliation-rules:READ'] },
  },
  {
    path: '/fiscal',
    label: 'Fiscal',
    icon: 'pi-file',
    permissions: { any: ['fiscal-documents:READ', 'fiscal-reports:READ'] },
  },
  {
    path: '/contabil',
    label: 'Contábil',
    icon: 'pi-book',
    permissions: { any: ['ledger-accounts:READ', 'journal-entries:READ'] },
  },
  {
    path: '/relatorios',
    label: 'Relatórios',
    icon: 'pi-chart-bar',
    permissions: { any: ['reports:READ', 'dashboards:READ'] },
  },
  {
    path: '/auditoria',
    label: 'Auditoria',
    icon: 'pi-shield',
    permissions: { all: ['audit:READ'] },
  },
  {
    path: '/integracoes',
    label: 'Integrações',
    icon: 'pi-link',
    permissions: { any: ['integrations:READ'] },
  },
];
