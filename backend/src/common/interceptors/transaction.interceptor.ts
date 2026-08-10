import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, switchMap, catchError, throwError, of } from 'rxjs';
import { REQUEST_TX, RequestWithTx } from '../middleware/tenant-context.middleware';

/**
 * Confirma (ou reverte) a transação aberta pelo TenantContextMiddleware antes
 * de a resposta ser serializada — assim uma falha no commit ainda vira erro
 * HTTP, em vez de acontecer depois que o cliente já recebeu 2xx (RNF-006/007).
 */
@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithTx>();
    const tx = request[REQUEST_TX];

    if (!tx) {
      return next.handle();
    }

    return next.handle().pipe(
      switchMap((data) => from(tx.end(true)).pipe(switchMap(() => of(data)))),
      catchError((error: unknown) =>
        from(tx.end(false)).pipe(switchMap(() => throwError(() => error))),
      ),
    );
  }
}
