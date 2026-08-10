import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { SUPER_ADMIN_KEY } from '../decorators/super-admin.decorator';
import { ACTIVE_COMPANY_HEADER } from '../decorators/active-company.decorator';

type Meta = { [SUPER_ADMIN_KEY]?: boolean; [PERMISSIONS_KEY]?: string[] };

const COMPANY_ID = '11111111-1111-1111-1111-111111111111';

function buildContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildGuard(meta: Meta, membership: unknown) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => (meta as Record<string, unknown>)[key]),
  } as unknown as Reflector;
  const findFirst = jest.fn().mockResolvedValue(membership);
  const setCurrentCompany = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    db: { membership: { findFirst } },
    setCurrentCompany,
  } as unknown as PrismaService;
  return { guard: new PermissionsGuard(reflector, prisma), findFirst, setCurrentCompany };
}

/** A consulta só traz associações ativas: o filtro `isActive` está no where. */
function membershipWith(...codes: string[]) {
  return {
    role: {
      permissions: codes.map((code) => {
        const [resource, action] = code.split(':');
        return { permission: { resource, action } };
      }),
    },
  };
}

const user = { id: 'u1', email: 'a@b.c', isSuperAdmin: false };
const superUser = { id: 'root', email: 'root@x.y', isSuperAdmin: true };

describe('PermissionsGuard', () => {
  it('libera rotas sem exigências de autorização', async () => {
    const { guard } = buildGuard({}, null);
    await expect(guard.canActivate(buildContext({ user }))).resolves.toBe(true);
  });

  it('bloqueia super admin ausente quando exigido', async () => {
    const { guard } = buildGuard({ [SUPER_ADMIN_KEY]: true }, null);
    await expect(guard.canActivate(buildContext({ user }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('permite super admin quando exigido', async () => {
    const { guard } = buildGuard({ [SUPER_ADMIN_KEY]: true }, null);
    await expect(guard.canActivate(buildContext({ user: superUser }))).resolves.toBe(true);
  });

  it('exige header x-company-id em rotas por empresa', async () => {
    const { guard } = buildGuard({ [PERMISSIONS_KEY]: ['branches:READ'] }, null);
    await expect(guard.canActivate(buildContext({ user, headers: {} }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejeita x-company-id que não é uuid', async () => {
    const { guard } = buildGuard({ [PERMISSIONS_KEY]: ['branches:READ'] }, null);
    await expect(
      guard.canActivate(buildContext({ user, headers: { [ACTIVE_COMPANY_HEADER]: 'c1' } })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('super admin ignora RBAC mas fixa a empresa ativa', async () => {
    const { guard, findFirst, setCurrentCompany } = buildGuard(
      { [PERMISSIONS_KEY]: ['branches:READ'] },
      null,
    );
    const request: Record<string, unknown> = {
      user: superUser,
      headers: { [ACTIVE_COMPANY_HEADER]: COMPANY_ID },
    };
    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(request.companyId).toBe(COMPANY_ID);
    expect(findFirst).not.toHaveBeenCalled();
    // A empresa ativa entra na sessão de banco mesmo para super admin (RLS).
    expect(setCurrentCompany).toHaveBeenCalledWith(COMPANY_ID);
  });

  it('nega usuário sem associação à empresa (isolamento multiempresa)', async () => {
    const { guard } = buildGuard({ [PERMISSIONS_KEY]: ['branches:READ'] }, null);
    await expect(
      guard.canActivate(buildContext({ user, headers: { [ACTIVE_COMPANY_HEADER]: COMPANY_ID } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('consulta apenas associações ativas', async () => {
    const { guard, findFirst } = buildGuard(
      { [PERMISSIONS_KEY]: ['branches:READ'] },
      membershipWith('branches:READ'),
    );
    await guard.canActivate(
      buildContext({ user, headers: { [ACTIVE_COMPANY_HEADER]: COMPANY_ID } }),
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: user.id, companyId: COMPANY_ID, isActive: true },
      }),
    );
  });

  it('nega quando falta a permissão exigida', async () => {
    const { guard } = buildGuard(
      { [PERMISSIONS_KEY]: ['branches:CREATE'] },
      membershipWith('branches:READ'),
    );
    await expect(
      guard.canActivate(buildContext({ user, headers: { [ACTIVE_COMPANY_HEADER]: COMPANY_ID } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permite quando a associação concede todas as permissões', async () => {
    const { guard } = buildGuard(
      { [PERMISSIONS_KEY]: ['branches:READ', 'branches:CREATE'] },
      membershipWith('branches:READ', 'branches:CREATE'),
    );
    const request: Record<string, unknown> = {
      user,
      headers: { [ACTIVE_COMPANY_HEADER]: COMPANY_ID },
    };
    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(request.companyId).toBe(COMPANY_ID);
  });
});
