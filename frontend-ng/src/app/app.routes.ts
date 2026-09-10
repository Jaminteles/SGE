import { Route, Routes } from '@angular/router';

import {
  apenasAnonimoGuard,
  areaAutenticadaGuard,
  permissaoGuard,
  sessaoGuard,
} from './core/auth/guards';
import { NAVIGATION } from './core/navigation';

/**
 * Mapa de rotas (UI-005).
 *
 * Tudo é `loadComponent`: cada módulo vira um pedaço separado do bundle, que só
 * baixa quando o usuário entra nele. É o `UI-085` (code splitting) saindo de
 * graça da estrutura de rotas.
 *
 * As rotas de módulo são geradas a partir de `core/navigation.ts`, então a
 * navegação lateral e as permissões de rota **não podem divergir**: são a mesma
 * fonte.
 */
/**
 * Módulos já entregues, com telas próprias. Os demais continuam no espaço
 * reservado até a sprint correspondente da Fase 9.
 */
const ROTAS_PRONTAS: Record<string, Route> = {
  administracao: {
    // A moldura de abas carrega junto; as telas ficam nas rotas filhas.
    loadComponent: () => import('./admin/admin-shell').then((m) => m.AdminShell),
    loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  cadastros: {
    loadComponent: () => import('./cadastros/cadastros-shell').then((m) => m.CadastrosShell),
    loadChildren: () => import('./cadastros/cadastros.routes').then((m) => m.CADASTROS_ROUTES),
  },
  rh: {
    // Mesma moldura de abas da Administração; as telas ficam nas rotas filhas.
    loadComponent: () => import('./hr/hr-shell').then((m) => m.HrShell),
    loadChildren: () => import('./hr/hr.routes').then((m) => m.HR_ROUTES),
  },
  compras: {
    loadComponent: () => import('./compras/compras-shell').then((m) => m.ComprasShell),
    loadChildren: () => import('./compras/compras.routes').then((m) => m.COMPRAS_ROUTES),
  },
  estoque: {
    loadComponent: () => import('./estoque/estoque-shell').then((m) => m.EstoqueShell),
    loadChildren: () => import('./estoque/estoque.routes').then((m) => m.ESTOQUE_ROUTES),
  },
  financeiro: {
    loadComponent: () => import('./financeiro/financeiro-shell').then((m) => m.FinanceiroShell),
    loadChildren: () => import('./financeiro/financeiro.routes').then((m) => m.FINANCEIRO_ROUTES),
  },
  auditoria: {
    loadComponent: () => import('./audit/audit-page').then((m) => m.AuditPage),
  },
};

const rotasDeModulo: Routes = NAVIGATION.filter((item) => item.path !== '/').map((item) => {
  const path = item.path.replace(/^\//, '');
  return {
    path,
    ...(ROTAS_PRONTAS[path] ?? {
      loadComponent: () => import('./pages/module-page').then((m) => m.ModulePage),
    }),
    canActivate: [permissaoGuard],
    data: { permissions: item.permissions, titulo: item.label },
    title: `${item.label} · SGE`,
  };
});

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login-page').then((m) => m.LoginPage),
    canActivate: [apenasAnonimoGuard],
    title: 'Entrar · SGE',
  },
  {
    path: 'recuperar-senha',
    loadComponent: () => import('./auth/forgot-password-page').then((m) => m.ForgotPasswordPage),
    canActivate: [apenasAnonimoGuard],
    title: 'Recuperar acesso · SGE',
  },
  {
    path: 'redefinir-senha',
    loadComponent: () => import('./auth/reset-password-page').then((m) => m.ResetPasswordPage),
    canActivate: [apenasAnonimoGuard],
    title: 'Definir nova senha · SGE',
  },
  {
    // Exige sessão, mas não empresa ativa — é justamente onde ela é escolhida.
    path: 'selecionar-empresa',
    loadComponent: () => import('./company/company-select-page').then((m) => m.CompanySelectPage),
    canActivate: [sessaoGuard],
    title: 'Selecionar empresa · SGE',
  },
  {
    path: '',
    loadComponent: () => import('./layout/app-layout').then((m) => m.AppLayout),
    canActivate: [areaAutenticadaGuard],
    children: [
      {
        path: '',
        loadComponent: () => import('./pages/home-page').then((m) => m.HomePage),
        title: 'Início · SGE',
      },
      ...rotasDeModulo,
      {
        path: 'sem-permissao',
        loadComponent: () => import('./pages/sem-permissao-page').then((m) => m.SemPermissaoPage),
        title: 'Sem permissão · SGE',
      },
      {
        path: '**',
        loadComponent: () => import('./pages/not-found-page').then((m) => m.NotFoundPage),
        title: 'Não encontrado · SGE',
      },
    ],
  },
];
