import { Routes } from '@angular/router';

import { permissaoGuard, superAdminGuard } from '../core/auth/guards';

/**
 * Telas do módulo Administração (UI-007 a UI-011).
 *
 * Cada rota declara a permissão que o backend vai exigir, para não abrir uma
 * tela que só conseguiria mostrar 403. A autorização real continua no
 * `PermissionsGuard` + RLS a cada requisição.
 */
export const ADMIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'empresa' },
  {
    path: 'empresa',
    loadComponent: () => import('./company-form-page').then((m) => m.CompanyFormPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['company:READ'] } },
    title: 'Empresa · SGE',
  },
  {
    path: 'empresas',
    loadComponent: () => import('./companies-page').then((m) => m.CompaniesPage),
    canActivate: [superAdminGuard],
    title: 'Empresas · SGE',
  },
  {
    // ":id" também aceita "nova": o formulário decide pelo parâmetro.
    path: 'empresas/:id',
    loadComponent: () => import('./company-form-page').then((m) => m.CompanyFormPage),
    canActivate: [superAdminGuard],
    title: 'Empresa · SGE',
  },
  {
    path: 'filiais',
    loadComponent: () => import('./branches-page').then((m) => m.BranchesPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['branches:READ'] } },
    title: 'Filiais · SGE',
  },
  {
    path: 'configuracoes',
    loadComponent: () => import('./configurations-page').then((m) => m.ConfigurationsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { any: ['categories:READ', 'cost-centers:READ', 'settings:READ'] } },
    title: 'Configurações · SGE',
  },
  {
    path: 'usuarios',
    loadComponent: () => import('./users-page').then((m) => m.UsersPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['memberships:READ'] } },
    title: 'Usuários · SGE',
  },
  {
    path: 'perfis',
    loadComponent: () => import('./roles-page').then((m) => m.RolesPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['roles:READ'] } },
    title: 'Perfis e permissões · SGE',
  },
  {
    path: 'alcadas',
    loadComponent: () => import('./approval-thresholds-page').then((m) => m.ApprovalThresholdsPage),
    canActivate: [permissaoGuard],
    data: { permissions: { all: ['approval-thresholds:READ'] } },
    title: 'Alçadas · SGE',
  },
];
