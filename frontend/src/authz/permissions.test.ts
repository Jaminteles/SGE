import { describe, expect, it } from 'vitest';
import { makeMembership, makeUser } from '../test/factories';
import { isAllowed, membershipFor, permissionCode, permissionsFor } from './permissions';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';

describe('permissionCode', () => {
  it('usa o formato recurso:AÇÃO do catálogo do backend', () => {
    expect(permissionCode('partners', 'READ')).toBe('partners:READ');
  });
});

describe('permissionsFor', () => {
  it('devolve as permissões do vínculo da empresa ativa', () => {
    const user = makeUser({
      memberships: [
        makeMembership({ companyId: COMPANY_A, permissions: ['partners:READ'] }),
        makeMembership({ companyId: COMPANY_B, permissions: ['payments:APPROVE'] }),
      ],
    });
    expect([...permissionsFor(user, COMPANY_A)]).toEqual(['partners:READ']);
    expect([...permissionsFor(user, COMPANY_B)]).toEqual(['payments:APPROVE']);
  });

  it('não vaza permissão de outra empresa quando o vínculo não existe', () => {
    const user = makeUser({ memberships: [makeMembership({ companyId: COMPANY_A })] });
    expect(permissionsFor(user, COMPANY_B).size).toBe(0);
    expect(membershipFor(user, COMPANY_B)).toBeNull();
  });

  it('devolve vazio sem usuário ou sem empresa ativa', () => {
    expect(permissionsFor(null, COMPANY_A).size).toBe(0);
    expect(permissionsFor(makeUser(), null).size).toBe(0);
  });
});

describe('isAllowed', () => {
  const granted = new Set(['partners:READ', 'partners:CREATE']);

  it('exige todas as permissões de `all`', () => {
    expect(isAllowed(granted, { all: ['partners:READ'] })).toBe(true);
    expect(isAllowed(granted, { all: ['partners:READ', 'partners:DELETE'] })).toBe(false);
  });

  it('exige ao menos uma das permissões de `any`', () => {
    expect(isAllowed(granted, { any: ['partners:DELETE', 'partners:CREATE'] })).toBe(true);
    expect(isAllowed(granted, { any: ['payments:READ'] })).toBe(false);
  });

  it('libera quando não há exigência', () => {
    expect(isAllowed(new Set(), {})).toBe(true);
  });

  it('super admin passa em qualquer exigência', () => {
    expect(isAllowed(new Set(), { all: ['payments:APPROVE'] }, { isSuperAdmin: true })).toBe(true);
  });
});
