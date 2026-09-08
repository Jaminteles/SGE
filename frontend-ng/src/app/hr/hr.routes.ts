import { Routes } from '@angular/router';

import { permissaoGuard } from '../core/auth/guards';

/**
 * Telas do módulo RH (UI-013 a UI-017).
 *
 * Cada rota declara a permissão que o backend vai exigir, para não abrir uma
 * tela que só conseguiria mostrar 403. A autorização real continua no
 * `PermissionsGuard` + RLS a cada requisição — a rota é conveniência, não
 * controle de acesso.
 */
export const HR_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'funcionarios' },
  {
    path: 'funcionarios',
    loadComponent: () => import('./employees-page').then((m) => m.EmployeesPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['employees:READ'] } },
    title: 'Funcionários · SGE',
  },
  {
    // ":id" também aceita "novo": o formulário decide pelo parâmetro.
    path: 'funcionarios/:id',
    loadComponent: () => import('./employee-form-page').then((m) => m.EmployeeFormPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['employees:READ'] } },
    title: 'Funcionário · SGE',
  },
  {
    path: 'funcionarios/:id/historico',
    loadComponent: () => import('./employee-history-page').then((m) => m.EmployeeHistoryPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['employee-events:READ'] } },
    title: 'Histórico funcional · SGE',
  },
  {
    path: 'funcionarios/:id/verbas',
    loadComponent: () =>
      import('./employee-compensation-page').then((m) => m.EmployeeCompensationPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['compensation:READ'] } },
    title: 'Verbas do funcionário · SGE',
  },
  {
    path: 'estrutura',
    loadComponent: () => import('./org-page').then((m) => m.OrgPage),
    canActivate: [permissaoGuard],
    data: { permissions: { any: ['positions:READ', 'departments:READ'] } },
    title: 'Cargos e departamentos · SGE',
  },
  {
    path: 'verbas',
    loadComponent: () => import('./payroll-page').then((m) => m.PayrollPage),
    canActivate: [permissaoGuard],
    data: { permissions: { any: ['payroll:READ', 'payroll-items:READ'] } },
    title: 'Salários e verbas · SGE',
  },
  {
    path: 'reembolsos',
    loadComponent: () => import('./reimbursements-page').then((m) => m.ReimbursementsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['reimbursements:READ'] } },
    title: 'Reembolsos · SGE',
  },
];
