import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * `profile()` alimenta a interface (UI-003/UI-004): empresas vinculadas e os
 * códigos de permissão do perfil em cada uma delas.
 */
function buildService(user: unknown) {
  const findUniqueOrThrow = jest.fn().mockResolvedValue(user);
  const prisma = { db: { user: { findUniqueOrThrow } } } as unknown as PrismaService;
  const service = new AuthService(
    prisma,
    {} as PasswordService,
    {} as TokenService,
    {} as ConfigService,
    {} as AuditService,
  );
  return { service, findUniqueOrThrow };
}

const userWithTwoCompanies = {
  id: 'u1',
  name: 'Jamile Teles',
  email: 'jamile@empresa.com.br',
  isSuperAdmin: false,
  isActive: true,
  memberships: [
    {
      companyId: 'c1',
      branchId: null,
      isDefault: true,
      company: { legalName: 'Empresa A', tradeName: 'A', taxId: '12345678000190', isActive: true },
      role: {
        id: 'r1',
        name: 'Financeiro',
        permissions: [
          { permission: { resource: 'financial-entries', action: 'READ' } },
          { permission: { resource: 'financial-entries', action: 'CREATE' } },
        ],
      },
    },
    {
      companyId: 'c2',
      branchId: 'b2',
      isDefault: false,
      company: { legalName: 'Empresa B', tradeName: null, taxId: null, isActive: true },
      role: {
        id: 'r2',
        name: 'Consulta',
        permissions: [{ permission: { resource: 'partners', action: 'READ' } }],
      },
    },
  ],
};

describe('AuthService.profile', () => {
  it('devolve os códigos de permissão por empresa no formato recurso:AÇÃO', async () => {
    const { service } = buildService(userWithTwoCompanies);

    const profile = await service.profile('u1');

    expect(profile.memberships[0].permissions).toEqual([
      'financial-entries:READ',
      'financial-entries:CREATE',
    ]);
    expect(profile.memberships[1].permissions).toEqual(['partners:READ']);
  });

  it('não mistura as permissões de uma empresa com as da outra', async () => {
    const { service } = buildService(userWithTwoCompanies);

    const profile = await service.profile('u1');

    expect(profile.memberships[1].permissions).not.toContain('financial-entries:READ');
  });

  it('não expõe o vínculo entre perfil e permissão além dos códigos', async () => {
    const { service } = buildService(userWithTwoCompanies);

    const profile = await service.profile('u1');

    expect(profile.memberships[0].role).toEqual({ id: 'r1', name: 'Financeiro' });
    expect(profile.memberships[0].role).not.toHaveProperty('permissions');
  });

  it('considera apenas vínculos ativos (filtro na consulta)', async () => {
    const { service, findUniqueOrThrow } = buildService(userWithTwoCompanies);

    await service.profile('u1');

    const args = findUniqueOrThrow.mock.calls[0][0] as {
      select: { memberships: { where: { isActive: boolean } } };
    };
    expect(args.select.memberships.where).toEqual({ isActive: true });
  });
});
