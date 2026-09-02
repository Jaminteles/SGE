import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { PermissionsService } from '../authz/permissions.service';
import type { PermissionCheck } from '../authz/permissions';
import { CompanyService } from '../company/company.service';
import { AuthService } from './auth.service';

/**
 * Guardas de rota (UI-002 / UI-003 / UI-004).
 *
 * Todas esperam `auth.prontidao()` antes de decidir: sem isso, um F5 numa rota
 * interna avaliaria o estado ainda em branco e jogaria para o login um usuário
 * cuja sessão seria restaurada meio segundo depois.
 *
 * Nada aqui é segurança: quem autoriza é o backend a cada requisição. Uma URL
 * forçada leva a uma tela que não consegue carregar dado nenhum.
 */

/** Exige sessão, mas não empresa ativa — é o caso da seleção de empresa. */
export const sessaoGuard: CanActivateFn = async (_rota, estado) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.prontidao();

  if (auth.autenticado()) return true;
  return router.createUrlTree(['/login'], { queryParams: { origem: estado.url } });
};

/**
 * Porta de entrada da área autenticada. Sem sessão → login; com sessão mas sem
 * empresa ativa → seleção, porque toda rota por empresa exige `x-company-id`.
 */
export const areaAutenticadaGuard: CanActivateFn = async (rota, estado) => {
  const auth = inject(AuthService);
  const empresa = inject(CompanyService);
  const router = inject(Router);

  await auth.prontidao();

  if (!auth.autenticado()) {
    return router.createUrlTree(['/login'], { queryParams: { origem: estado.url } });
  }
  if (empresa.ativaId() === null) {
    return router.createUrlTree(['/selecionar-empresa']);
  }
  return true;
};

/** Mantém quem já está logado fora das telas de login e recuperação de senha. */
export const apenasAnonimoGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.prontidao();

  return auth.autenticado() ? router.createUrlTree(['/']) : true;
};

/**
 * Bloqueia o módulo quando o perfil não tem a permissão, lendo a exigência de
 * `data.permissions` da rota.
 *
 * Redireciona para `/sem-permissao` em vez de renderizar o aviso no lugar: com
 * `loadComponent`, deixar a rota "ativar mas mostrar outra coisa" exigiria
 * carregar o módulo só para não exibi-lo.
 */
export const permissaoGuard: CanActivateFn = async (rota) => {
  const auth = inject(AuthService);
  const permissoes = inject(PermissionsService);
  const router = inject(Router);

  await auth.prontidao();

  const exigencia = (rota.data['permissions'] ?? {}) as PermissionCheck;
  if (permissoes.permite(exigencia)) return true;

  return router.createUrlTree(['/sem-permissao'], {
    queryParams: { modulo: rota.routeConfig?.path ?? '' },
  });
};
