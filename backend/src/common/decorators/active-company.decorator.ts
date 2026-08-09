import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';

export const ACTIVE_COMPANY_HEADER = 'x-company-id';

/**
 * Injeta o id da empresa ativa, já validado pelo PermissionsGuard contra as
 * associações do usuário (RF-005, isolamento multiempresa). Só deve ser usado
 * em rotas protegidas pelo PermissionsGuard.
 */
export const ActiveCompanyId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request & { companyId?: string }>();
  if (!request.companyId) {
    throw new InternalServerErrorException(
      'Empresa ativa não resolvida. Verifique se a rota está protegida pelo PermissionsGuard.',
    );
  }
  return request.companyId;
});
