import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';

import { ApiError } from '../api/errors';
import { uuidV4 } from '../lib/idempotency';
import { ClientErrorsService } from './client-errors.service';

/** Cabeçalho lido pelo `genReqId` do backend (`app.module.ts`) — RNF-010. */
export const CABECALHO_CORRELACAO = 'x-correlation-id';

/**
 * Correlation id por requisição (RNF-010 — UI-090).
 *
 * O backend já gera um id por requisição e o carrega em todo log e em toda
 * linha de auditoria; ele só **reaproveita** o id quando o cliente o manda.
 * Enviando daqui, a tela com problema e as linhas de log do servidor passam a
 * ter a mesma chave — sem isso, achar a requisição de um usuário no log é
 * procurar por horário aproximado.
 *
 * Fica logo depois do interceptor de base e **antes** do de erro, de propósito:
 * assim o erro que sobe até aqui já é o `ApiError` exibível, e recebe o id da
 * requisição que falhou. Mais para dentro, só passaria o `HttpErrorResponse`
 * cru e o id se perderia na tradução.
 */
export const correlationInterceptor: HttpInterceptorFn = (req, next) => {
  const registro = inject(ClientErrorsService);
  const id = uuidV4();

  return next(req.clone({ setHeaders: { [CABECALHO_CORRELACAO]: id } })).pipe(
    catchError((erro: unknown) => {
      if (erro instanceof ApiError) erro.correlationId = id;
      registro.registrar(erro, 'http');
      return throwError(() => erro);
    }),
  );
};
