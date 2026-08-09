import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RecordStatus } from '@prisma/client';
import { PermissionsGuard } from './permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { SUPER_ADMIN_KEY } from '../decorators/super-admin.decorator';
import { ACTIVE_COMPANY_HEADER } from '../decorators/active-company.decorator';

type Meta = { [SUPER_ADMIN_KEY]?: boolean; [PERMISSIONS_KEY]?: string[] };

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
  const prisma = {
    membership: { findUnique: jest.fn().mockResolvedValue(membership) },
  } as unknown as PrismaService;
  return { guard: new PermissionsGuard(reflector, prisma), prisma };
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

  it('super admin ignora RBAC mas fixa a empresa ativa', async () => {
    const { guard, prisma } = buildGuard({ [PERMISSIONS_KEY]: ['branches:READ'] }, null);
    const request: Record<string, unknown> = {
      user: superUser,
      headers: { [ACTIVE_COMPANY_HEADER]: 'c1' },
    };
    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(request.companyId).toBe('c1');
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it('nega usuário sem associação à empresa (isolamento multiempresa)', async () => {
    const { guard } = buildGuard({ [PERMISSIONS_KEY]: ['branches:READ'] }, null);
    await expect(
      guard.canActivate(buildContext({ user, headers: { [ACTIVE_COMPANY_HEADER]: 'c1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('nega associação inativa', async () => {
    const membership = {
      status: RecordStatus.INACTIVE,
      role: { permissions: [{ permission: { code: 'branches:READ' } }] },
    };
    const { guard } = buildGuard({ [PERMISSIONS_KEY]: ['branches:READ'] }, membership);
    await expect(
      guard.canActivate(buildContext({ user, headers: { [ACTIVE_COMPANY_HEADER]: 'c1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('nega quando falta a permissão exigida', async () => {
    const membership = {
      status: RecordStatus.ACTIVE,
      role: { permissions: [{ permission: { code: 'branches:READ' } }] },
    };
    const { guard } = buildGuard({ [PERMISSIONS_KEY]: ['branches:CREATE'] }, membership);
    await expect(
      guard.canActivate(buildContext({ user, headers: { [ACTIVE_COMPANY_HEADER]: 'c1' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('permite quando a associação concede todas as permissões', async () => {
    const membership = {
      status: RecordStatus.ACTIVE,
      role: {
        permissions: [
          { permission: { code: 'branches:READ' } },
          { permission: { code: 'branches:CREATE' } },
        ],
      },
    };
    const { guard } = buildGuard(
      { [PERMISSIONS_KEY]: ['branches:READ', 'branches:CREATE'] },
      membership,
    );
    const request: Record<string, unknown> = {
      user,
      headers: { [ACTIVE_COMPANY_HEADER]: 'c1' },
    };
    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(request.companyId).toBe('c1');
  });
});
