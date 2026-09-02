import type { Membership, UserProfile } from '../api/types';

export function makeMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    companyId: '11111111-1111-4111-8111-111111111111',
    branchId: null,
    isDefault: true,
    company: {
      legalName: 'Empresa Fantasma Teste LTDA',
      tradeName: 'Empresa Fantasma',
      taxId: '12345678000190',
      isActive: true,
    },
    role: { id: 'role-1', name: 'Administrador' },
    permissions: ['company:READ', 'partners:READ'],
    ...overrides,
  };
}

export function makeUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    name: 'Jamile Teles',
    email: 'jamile@empresa.com.br',
    isSuperAdmin: false,
    isActive: true,
    memberships: [makeMembership()],
    ...overrides,
  };
}
