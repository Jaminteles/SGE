import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../api/interceptors';
import type { UserProfile } from '../api/types';
import { AuthService } from '../auth/auth.service';
import { activeCompanyStore } from '../company/active-company-store';
import { CompanyService } from '../company/company.service';
import { makeMembership, makeUser } from '../test/factories';
import { PermissionsService } from './permissions.service';

const BASE = '/api/v1';
const EMPRESA_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const EMPRESA_B = 'bbbbbbbb-2222-4222-8222-222222222222';

describe('PermissionsService', () => {
  let mock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    activeCompanyStore.set(null);

    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors(SGE_INTERCEPTORS)), provideHttpClientTesting()],
    });
    mock = TestBed.inject(HttpTestingController);
  });

  async function autenticar(usuario: UserProfile): Promise<PermissionsService> {
    const auth = TestBed.inject(AuthService);
    // Instanciado ANTES do login: services `providedIn: 'root'` são preguiçosos,
    // e é o construtor do `CompanyService` (puxado por este) que registra o
    // efeito de auto-seleção da empresa. No app quem faz isso é o shell, que
    // injeta os dois no bootstrap.
    const permissoes = TestBed.inject(PermissionsService);

    const entrando = auth.login('jamile@empresa.com.br', 'senha');
    mock
      .expectOne(`${BASE}/auth/login`)
      .flush({ accessToken: 'tok', refreshToken: 'ref', tokenType: 'Bearer', user: usuario });
    await entrando;
    TestBed.tick();
    return permissoes;
  }

  it('não concede nada sem usuário autenticado', () => {
    const permissoes = TestBed.inject(PermissionsService);
    expect([...permissoes.concedidas()]).toEqual([]);
    expect(permissoes.pode('partners:READ')).toBe(false);
  });

  it('concede o que o perfil tem na empresa ativa', async () => {
    const permissoes = await autenticar(
      makeUser({
        memberships: [
          makeMembership({
            companyId: EMPRESA_A,
            permissions: ['partners:READ', 'partners:CREATE'],
          }),
        ],
      }),
    );

    expect(permissoes.pode('partners:READ')).toBe(true);
    expect(permissoes.pode('partners:CREATE')).toBe(true);
    expect(permissoes.pode('partners:DELETE')).toBe(false);
  });

  it('avalia exigência composta com all e any', async () => {
    const permissoes = await autenticar(
      makeUser({
        memberships: [
          makeMembership({
            companyId: EMPRESA_A,
            permissions: ['company:READ', 'partners:READ'],
          }),
        ],
      }),
    );

    expect(permissoes.permite({ all: ['company:READ', 'partners:READ'] })).toBe(true);
    expect(permissoes.permite({ all: ['company:READ', 'audit:READ'] })).toBe(false);
    expect(permissoes.permite({ any: ['audit:READ', 'partners:READ'] })).toBe(true);
    expect(permissoes.permite({ any: ['audit:READ', 'reports:READ'] })).toBe(false);
    // Exigência vazia libera — é o caso do item "Início" da navegação.
    expect(permissoes.permite({})).toBe(true);
  });

  it('o super admin passa em tudo', async () => {
    const permissoes = await autenticar(
      makeUser({
        isSuperAdmin: true,
        memberships: [makeMembership({ companyId: EMPRESA_A, permissions: [] })],
      }),
    );

    expect(permissoes.superAdmin()).toBe(true);
    expect(permissoes.pode('qualquer-coisa:DELETE')).toBe(true);
    expect(permissoes.permite({ all: ['a:READ'], any: ['b:READ'] })).toBe(true);
  });

  it('acompanha a troca de empresa ativa', async () => {
    const permissoes = await autenticar(
      makeUser({
        memberships: [
          makeMembership({
            companyId: EMPRESA_A,
            isDefault: true,
            permissions: ['partners:CREATE'],
          }),
          makeMembership({ companyId: EMPRESA_B, isDefault: false, permissions: ['audit:READ'] }),
        ],
      }),
    );

    expect(permissoes.pode('partners:CREATE')).toBe(true);
    expect(permissoes.pode('audit:READ')).toBe(false);

    TestBed.inject(CompanyService).selecionar(EMPRESA_B);
    TestBed.tick();

    expect(permissoes.pode('partners:CREATE')).toBe(false);
    expect(permissoes.pode('audit:READ')).toBe(true);
  });
});
