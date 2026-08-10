import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { SUPER_ADMIN_KEY } from '../decorators/super-admin.decorator';
import { ACTIVE_COMPANY_HEADER } from '../decorators/active-company.decorator';
import { AuthenticatedUser } from '../authorization/authenticated-user';
import { permissionCode } from '../authorization/permission-catalog';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Autorização no backend (RNF-004):
 *  - @RequireSuperAdmin(): exige administrador de plataforma.
 *  - @RequirePermissions(...): exige as permissões no contexto da empresa
 *    ativa (header x-company-id), validando a associação do usuário à empresa
 *    (RF-004, RF-005, RF-011). Super admins ignoram a checagem de permissão,
 *    mas a empresa ativa continua obrigatória para escopo dos dados.
 *
 * Também é aqui que a empresa ativa entra na sessão de banco (`app.empresa_id`),
 * habilitando as políticas de RLS para o restante da requisição.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requireSuperAdmin = this.reflector.getAllAndOverride<boolean>(SUPER_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    // Rota sem exigências específicas de autorização: basta estar autenticado.
    if (!requireSuperAdmin && requiredPermissions.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser; companyId?: string }>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('Autenticação necessária.');
    }

    if (requireSuperAdmin && !user.isSuperAdmin) {
      throw new ForbiddenException('Operação restrita ao administrador de plataforma.');
    }

    // Rotas com permissões são sempre escopadas por empresa (multiempresa).
    if (requiredPermissions.length > 0) {
      const companyId = this.resolveCompanyId(request);
      // Habilita a RLS para a empresa informada antes de qualquer consulta.
      await this.prisma.setCurrentCompany(companyId);

      if (user.isSuperAdmin) {
        request.companyId = companyId;
        return true;
      }

      const membership = await this.prisma.db.membership.findFirst({
        where: { userId: user.id, companyId, isActive: true },
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      });

      if (!membership) {
        // Não revela existência da empresa a quem não pertence a ela (RF-005).
        throw new ForbiddenException('Sem acesso à empresa informada.');
      }

      const granted = new Set(
        membership.role.permissions.map((rp) =>
          permissionCode(rp.permission.resource, rp.permission.action),
        ),
      );
      const missing = requiredPermissions.filter((p) => !granted.has(p));
      if (missing.length > 0) {
        throw new ForbiddenException(`Permissão insuficiente: ${missing.join(', ')}.`);
      }

      request.companyId = companyId;
    }

    return true;
  }

  private resolveCompanyId(request: Request): string {
    const header = request.headers[ACTIVE_COMPANY_HEADER];
    const companyId = Array.isArray(header) ? header[0] : header;
    if (!companyId || companyId.trim() === '') {
      throw new BadRequestException(`Header ${ACTIVE_COMPANY_HEADER} é obrigatório.`);
    }
    const value = companyId.trim();
    // Os ids são uuid no banco: barrar aqui evita erro de cast no PostgreSQL.
    if (!UUID_PATTERN.test(value)) {
      throw new BadRequestException(`Header ${ACTIVE_COMPANY_HEADER} deve ser um uuid válido.`);
    }
    return value;
  }
}
