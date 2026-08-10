import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

export interface RequestTransaction {
  end: (commit: boolean) => Promise<void>;
}

/** Chave onde a transação da requisição fica pendurada no objeto Request. */
export const REQUEST_TX = Symbol('sge.request.tx');

export type RequestWithTx = Request & { [REQUEST_TX]?: RequestTransaction };

/**
 * Abre a transação que carrega o contexto de RLS da requisição (RN-001/RN-002).
 *
 * Roda antes dos guards — é o JwtStrategy que informa `app.usuario_id` e o
 * PermissionsGuard que informa `app.empresa_id`, ambos já dentro deste contexto.
 * O encerramento normal é feito pelo TransactionInterceptor (antes de a resposta
 * ser enviada); os listeners de `finish`/`close` aqui são a rede de segurança
 * para o que falha antes dos interceptors, como um guard que nega acesso.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: RequestWithTx, res: Response, next: NextFunction): Promise<void> {
    let ctx: Awaited<ReturnType<PrismaService['openRequestContext']>>;
    try {
      ctx = await this.prisma.openRequestContext();
    } catch (error) {
      // Banco indisponível: vira erro HTTP em vez de requisição pendurada.
      next(error);
      return;
    }

    let finished = false;
    const end = async (commit: boolean): Promise<void> => {
      if (finished) return;
      finished = true;
      await ctx.end(commit);
    };

    req[REQUEST_TX] = { end };

    const fallback = (): void => {
      void end(res.statusCode < 400);
    };
    res.on('finish', fallback);
    res.on('close', fallback);

    ctx.run(() => next());
  }
}
