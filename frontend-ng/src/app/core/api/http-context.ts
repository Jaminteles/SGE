import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * Marcadores de contexto que substituem as flags `auth` e `withCompany` do
 * cliente HTTP do projeto React.
 *
 * O padrão é o seguro: toda requisição leva token e empresa. Quem precisa sair
 * da regra declara explicitamente na chamada.
 */

/** Rotas públicas (login, refresh, recuperação de senha) não mandam token. */
export const SEM_AUTH = new HttpContextToken<boolean>(() => false);

/** Rotas de plataforma (ex.: `/auth/me`) não são escopadas por empresa. */
export const SEM_EMPRESA = new HttpContextToken<boolean>(() => false);

export function semAuth(contexto = new HttpContext()): HttpContext {
  return contexto.set(SEM_AUTH, true);
}

export function semEmpresa(contexto = new HttpContext()): HttpContext {
  return contexto.set(SEM_EMPRESA, true);
}

/** Rota pública e fora do escopo de empresa — o caso das rotas de autenticação. */
export function rotaPublica(): HttpContext {
  return semEmpresa(semAuth());
}
