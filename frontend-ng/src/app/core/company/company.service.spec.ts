import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../api/interceptors';
import type { UserProfile } from '../api/types';
import { AuthService } from '../auth/auth.service';
import { makeMembership, makeUser } from '../test/factories';
import { activeCompanyStore } from './active-company-store';
import { CompanyService } from './company.service';

const BASE = '/api/v1';
const EMPRESA_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const EMPRESA_B = 'bbbbbbbb-2222-4222-8222-222222222222';

describe('CompanyService', () => {
  let mock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    activeCompanyStore.set(null);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
      ],
    });
    mock = TestBed.inject(HttpTestingController);
  });

  /** Autentica de verdade, pelo mesmo caminho que a aplicação usa. */
  async function autenticar(usuario: UserProfile): Promise<CompanyService> {
    const auth = TestBed.inject(AuthService);
    const empresa = TestBed.inject(CompanyService);
    const entrando = auth.login('jamile@empresa.com.br', 'senha');
    mock
      .expectOne(`${BASE}/auth/login`)
      .flush({ accessToken: 'tok', refreshToken: 'ref', tokenType: 'Bearer', user: usuario });
    await entrando;
    TestBed.tick();
    return empresa;
  }

  it('seleciona sozinho quando há um único vínculo', async () => {
    const empresa = await autenticar(
      makeUser({ memberships: [makeMembership({ companyId: EMPRESA_A, isDefault: false })] }),
    );

    expect(empresa.ativaId()).toBe(EMPRESA_A);
    expect(empresa.precisaSelecionar()).toBe(false);
    expect(activeCompanyStore.get()).toBe(EMPRESA_A);
  });

  it('usa o vínculo padrão quando há vários', async () => {
    const empresa = await autenticar(
      makeUser({
        memberships: [
          makeMembership({ companyId: EMPRESA_A, isDefault: false }),
          makeMembership({ companyId: EMPRESA_B, isDefault: true }),
        ],
      }),
    );

    expect(empresa.ativaId()).toBe(EMPRESA_B);
  });

  it('pede seleção quando há vários vínculos e nenhum é padrão', async () => {
    const empresa = await autenticar(
      makeUser({
        memberships: [
          makeMembership({ companyId: EMPRESA_A, isDefault: false }),
          makeMembership({ companyId: EMPRESA_B, isDefault: false }),
        ],
      }),
    );

    expect(empresa.ativaId()).toBeNull();
    expect(empresa.precisaSelecionar()).toBe(true);
  });

  it('nunca expõe id sem vínculo, mesmo antes do efeito de limpeza rodar', async () => {
    // O construtor lê a escolha do `localStorage` na hora; o efeito que a
    // valida só roda na detecção de mudanças seguinte. Nessa janela, quem
    // segura o id inválido é a guarda do `ativaId`, não o efeito — por isso
    // este teste não chama `TestBed.tick()`.
    activeCompanyStore.set('empresa-de-outro-usuario');

    const auth = TestBed.inject(AuthService);
    const empresa = TestBed.inject(CompanyService);
    const entrando = auth.login('jamile@empresa.com.br', 'senha');
    mock.expectOne(`${BASE}/auth/login`).flush({
      accessToken: 'tok',
      refreshToken: 'ref',
      tokenType: 'Bearer',
      user: makeUser({ memberships: [makeMembership({ companyId: EMPRESA_A })] }),
    });
    await entrando;

    expect(empresa.ativaId()).toBeNull();
    expect(empresa.ativa()).toBeNull();
    expect([...empresa.permissoes()]).toEqual([]);
  });

  it('descarta id guardado que não pertence ao usuário', async () => {
    activeCompanyStore.set('empresa-de-outro-usuario');

    const empresa = await autenticar(
      makeUser({
        memberships: [
          makeMembership({ companyId: EMPRESA_A, isDefault: false }),
          makeMembership({ companyId: EMPRESA_B, isDefault: false }),
        ],
      }),
    );

    expect(empresa.ativaId()).toBeNull();
    expect(activeCompanyStore.get()).toBeNull();
  });

  it('ignora seleção de empresa sem vínculo', async () => {
    const empresa = await autenticar(
      makeUser({ memberships: [makeMembership({ companyId: EMPRESA_A })] }),
    );

    empresa.selecionar('empresa-inexistente');
    TestBed.tick();

    expect(empresa.ativaId()).toBe(EMPRESA_A);
  });

  it('ignora vínculo com empresa inativa', async () => {
    const empresa = await autenticar(
      makeUser({
        memberships: [
          makeMembership({
            companyId: EMPRESA_A,
            isDefault: true,
            company: {
              legalName: 'Inativa LTDA',
              tradeName: null,
              taxId: null,
              isActive: false,
            },
          }),
          makeMembership({ companyId: EMPRESA_B, isDefault: false }),
        ],
      }),
    );

    // Só sobra a B, então ela é escolhida sozinha mesmo sem ser padrão.
    expect(empresa.empresas().length).toBe(1);
    expect(empresa.ativaId()).toBe(EMPRESA_B);
  });

  it('expõe as permissões do perfil na empresa ativa', async () => {
    const empresa = await autenticar(
      makeUser({
        memberships: [
          makeMembership({
            companyId: EMPRESA_A,
            isDefault: true,
            permissions: ['company:READ', 'partners:CREATE'],
          }),
          makeMembership({
            companyId: EMPRESA_B,
            isDefault: false,
            permissions: ['audit:READ'],
          }),
        ],
      }),
    );

    expect([...empresa.permissoes()].sort()).toEqual(['company:READ', 'partners:CREATE']);

    empresa.selecionar(EMPRESA_B);
    TestBed.tick();

    expect([...empresa.permissoes()]).toEqual(['audit:READ']);
  });

  it('troca a empresa ativa e persiste a escolha', async () => {
    const empresa = await autenticar(
      makeUser({
        memberships: [
          makeMembership({ companyId: EMPRESA_A, isDefault: true }),
          makeMembership({ companyId: EMPRESA_B, isDefault: false }),
        ],
      }),
    );

    expect(empresa.ativaId()).toBe(EMPRESA_A);

    empresa.selecionar(EMPRESA_B);
    TestBed.tick();

    expect(empresa.ativaId()).toBe(EMPRESA_B);
    expect(empresa.ativa()?.companyId).toBe(EMPRESA_B);
    expect(activeCompanyStore.get()).toBe(EMPRESA_B);
  });

  describe('super admin da plataforma', () => {
    /** Responde a busca que o serviço dispara para o super admin. */
    function responderPlataforma(empresas: unknown[]): void {
      mock
        .expectOne((r) => r.url === `${BASE}/companies`)
        .flush({ data: empresas, total: empresas.length, page: 1, pageSize: 100, totalPages: 1 });
      TestBed.tick();
    }

    it('escolhe empresa sem vínculo — o backend aceita qualquer x-company-id dele', async () => {
      const empresa = await autenticar(makeUser({ isSuperAdmin: true, memberships: [] }));

      responderPlataforma([
        {
          id: EMPRESA_B,
          legalName: 'Empresa Sem Vínculo LTDA',
          tradeName: null,
          taxId: null,
          isActive: true,
        },
      ]);

      expect(empresa.empresas().map((m) => m.companyId)).toEqual([EMPRESA_B]);
      expect(empresa.ativaId()).toBe(EMPRESA_B);
    });

    it('não fica sem saída quando ainda não existe empresa nenhuma', async () => {
      const empresa = await autenticar(makeUser({ isSuperAdmin: true, memberships: [] }));

      responderPlataforma([]);

      // Sem empresa para escolher, a tela de seleção oferece o cadastro da
      // primeira — e a rota de empresas abre sem empresa ativa.
      expect(empresa.empresas()).toEqual([]);
      expect(empresa.precisaSelecionar()).toBe(true);
    });

    it('não busca a plataforma para quem não é super admin', async () => {
      await autenticar(makeUser({ memberships: [makeMembership({ companyId: EMPRESA_A })] }));

      mock.expectNone((r) => r.url === `${BASE}/companies`);
    });
  });
});
