import { Routes } from '@angular/router';

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
const rotasDeModulo: Routes = NAVIGATION.filter((item) => item.path !== '/').map((item) => ({
  path: item.path.replace(/^\//, ''),
  loadComponent: () => import('./pages/module-page').then((m) => m.ModulePage),
  canActivate: [permissaoGuard],
  data: { permissions: item.permissions, titulo: item.label },
  title: `${item.label} · SGE`,
}));

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login-page').then((m) => m.LoginPage),
    canActivate: [apenasAnonimoGuard],
    title: 'Entrar · SGE',
  },
  {
    path: 'recuperar-senha',
    loadComponent: () =>
      import('./auth/forgot-password-page').then((m) => m.ForgotPasswordPage),
    canActivate: [apenasAnonimoGuard],
    title: 'Recuperar acesso · SGE',
  },
  {
    path: 'redefinir-senha',
    loadComponent: () =>
      import('./auth/reset-password-page').then((m) => m.ResetPasswordPage),
    canActivate: [apenasAnonimoGuard],
    title: 'Definir nova senha · SGE',
  },
  {
    // Exige sessão, mas não empresa ativa — é justamente onde ela é escolhida.
    path: 'selecionar-empresa',
    loadComponent: () =>
      import('./company/company-select-page').then((m) => m.CompanySelectPage),
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
        loadComponent: () =>
          import('./pages/sem-permissao-page').then((m) => m.SemPermissaoPage),
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
