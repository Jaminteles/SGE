import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError, timeout } from 'rxjs';

import { SessionService } from '../auth/session.service';
import { activeCompanyStore } from '../company/active-company-store';
import { config } from '../lib/config';
import { NetworkError, toApiError } from './errors';
import { SEM_AUTH, SEM_EMPRESA } from './http-context';
import { queryCacheInterceptor } from './query-cache';
import { TokenRefreshService } from './token-refresh.service';

/**
 * Os interceptors substituem o cliente HTTP escrito à mão do projeto React.
 * A ordem em `withInterceptors` importa: o primeiro da lista é o mais externo.
 *
 *   baseUrl → cache → erro → empresa → auth → backend
 *
 * O de cache (UI-085) fica logo depois do de base porque precisa da URL final
 * como chave, e antes de todos os outros porque resposta servida da memória não
 * tem por que atravessar token, empresa e tempo limite de novo.
 *
 * O de auth fica por último (mais interno) porque a repetição depois da
 * renovação precisa acontecer **antes** da tradução de erro — senão a segunda
 * tentativa nunca teria chance de dar certo.
 */

/** Prefixa a base da API nas URLs relativas, para os services usarem `'auth/me'`. */
export const baseUrlInterceptor: HttpInterceptorFn = (req, next) => {
  if (/^https?:\/\//i.test(req.url)) return next(req);
  const base = config.apiUrl.replace(/\/$/, '');
  return next(req.clone({ url: `${base}/${req.url.replace(/^\//, '')}` }));
};

/**
 * Traduz o envelope de erro da API num `ApiError` exibível (UI-005).
 * Status 0 é falha de rede: a requisição nem chegou a ter resposta.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((erro: unknown) => {
      if (!(erro instanceof HttpErrorResponse)) return throwError(() => erro);
      if (erro.status === 0) return throwError(() => new NetworkError());
      return throwError(() => toApiError(erro.status, erro.error));
    }),
  );

/** Cabeçalho da empresa ativa em toda rota escopada (RF-005). */
export const companyInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.context.get(SEM_EMPRESA)) return next(req);
  const companyId = activeCompanyStore.get();
  if (!companyId) return next(req);
  return next(req.clone({ setHeaders: { [config.companyHeader]: companyId } }));
};

/**
 * `Authorization: Bearer` e tratamento do 401.
 *
 * No 401, espera a renovação (compartilhada por todas as requisições que
 * tomaram 401 ao mesmo tempo) e repete a requisição **uma única vez**. Se a
 * renovação falhar, ou se a repetição também tomar 401, a sessão é encerrada.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.context.get(SEM_AUTH)) return next(req);

  const sessao = inject(SessionService);
  const renovacao = inject(TokenRefreshService);

  const comToken = (requisicao: HttpRequest<unknown>): HttpRequest<unknown> => {
    const token = sessao.accessToken;
    return token
      ? requisicao.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : requisicao;
  };

  return next(comToken(req)).pipe(
    catchError((erro: unknown) => {
      if (!(erro instanceof HttpErrorResponse) || erro.status !== 401) {
        return throwError(() => erro);
      }

      return renovacao.garantirRenovacao().pipe(
        switchMap((renovou) => {
          if (!renovou) {
            sessao.expirar();
            return throwError(() => erro);
          }
          // Repete com o token novo. Não há terceira tentativa.
          return next(comToken(req)).pipe(
            catchError((novoErro: unknown) => {
              if (novoErro instanceof HttpErrorResponse && novoErro.status === 401) {
                sessao.expirar();
              }
              return throwError(() => novoErro);
            }),
          );
        }),
      );
    }),
  );
};

/** O `HttpClient` não tem tempo limite; o cliente do projeto React tinha 30 s. */
export const TEMPO_LIMITE_MS = 30_000;

/**
 * Fica **mais interno** de propósito: assim o limite vale por tentativa, e a
 * repetição depois da renovação ganha os seus próprios 30 s em vez de herdar o
 * que sobrou da primeira.
 */
export const timeoutInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    timeout({
      each: TEMPO_LIMITE_MS,
      with: () => throwError(() => new NetworkError('O servidor demorou demais para responder.')),
    }),
  );

/** Ordem de registro em `provideHttpClient(withInterceptors(...))`. */
export const SGE_INTERCEPTORS: HttpInterceptorFn[] = [
  baseUrlInterceptor,
  queryCacheInterceptor,
  errorInterceptor,
  companyInterceptor,
  authInterceptor,
  timeoutInterceptor,
];
