import type { PermissionCheck } from '../authz/permissions';

export interface NavItem {
  /** Rota do módulo dentro da área autenticada. */
  path: string;
  label: string;
  /** Permissões que liberam o item (RF-011). Vazio = disponível a todos. */
  permissions: PermissionCheck;
}

/**
 * Navegação por módulo (UI-005). Cada item declara a permissão que o libera;
 * o que o perfil não tem aparece desabilitado com o aviso "Sem permissão no
 * perfil", como nas telas.
 *
 * As telas de cada módulo entram nas sprints 19 a 24; aqui ficam as rotas e o
 * controle de visibilidade da fundação.
 */
export const NAVIGATION: NavItem[] = [
  { path: '/', label: 'Início', permissions: {} },
  {
    path: '/administracao',
    label: 'Administração',
    permissions: { any: ['company:READ', 'branches:READ', 'roles:READ', 'memberships:READ'] },
  },
  {
    path: '/cadastros',
    label: 'Cadastros',
    permissions: { any: ['partners:READ', 'products:READ'] },
  },
  { path: '/rh', label: 'RH', permissions: { any: ['employees:READ', 'payroll:READ'] } },
  {
    path: '/compras',
    label: 'Compras',
    permissions: { any: ['purchase-orders:READ', 'goods-receipts:READ'] },
  },
  {
    path: '/estoque',
    label: 'Estoque',
    permissions: { any: ['stock:READ', 'stock-movements:READ', 'inventories:READ'] },
  },
  {
    path: '/financeiro',
    label: 'Financeiro',
    permissions: { any: ['financial-entries:READ', 'settlements:READ', 'cash-flow:READ'] },
  },
  {
    path: '/bancos',
    label: 'Bancos',
    permissions: { any: ['company-bank-accounts:READ', 'payments:READ', 'bank-statements:READ'] },
  },
  {
    path: '/fiscal',
    label: 'Fiscal',
    permissions: { any: ['fiscal-documents:READ', 'fiscal-reports:READ'] },
  },
  {
    path: '/contabil',
    label: 'Contábil',
    permissions: { any: ['ledger-accounts:READ', 'journal-entries:READ'] },
  },
  {
    path: '/relatorios',
    label: 'Relatórios',
    permissions: { any: ['reports:READ', 'dashboards:READ'] },
  },
  { path: '/auditoria', label: 'Auditoria', permissions: { all: ['audit:READ'] } },
];
