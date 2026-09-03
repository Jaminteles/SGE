import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../api/interceptors';
import type { UserProfile } from '../api/types';
import { PermissionsService } from '../authz/permissions.service';
import { activeCompanyStore } from '../company/active-company-store';
import { makeMembership, makeUser } from '../test/factories';
import { AuthService } from './auth.service';
import { apenasAnonimoGuard, areaAutenticadaGuard, permissaoGuard, sessaoGuard } from './guards';

const BASE = '/api/v1';
const EMPRESA_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const EMPRESA_B = 'bbbbbbbb-2222-4222-8222-222222222222';

@Component({ template: 'inicio' })
class Inicio {}
@Component({ template: 'login' })
class Login {}
@Component({ template: 'selecionar' })
class Selecionar {}
@Component({ template: 'sem-permissao' })
class SemPermissao {}
@Component({ template: 'financeiro' })
class Financeiro {}

const rotas: Routes = [
  { path: 'login', component: Login, canActivate: [apenasAnonimoGuard] },
  { path: 'selecionar-empresa', component: Selecionar, canActivate: [sessaoGuard] },
  { path: 'sem-permissao', component: SemPermissao },
  {
    path: 'financeiro',
    component: Financeiro,
    canActivate: [areaAutenticadaGuard, permissaoGuard],
    data: { permissions: { any: ['financial-entries:READ'] } },
  },
  { path: '', component: Inicio, canActivate: [areaAutenticadaGuard] },
];

describe('guardas de rota', () => {
  let router: Router;
  let mock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    activeCompanyStore.set(null);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
        provideRouter(rotas),
      ],
    });

    router = TestBed.inject(Router);
    mock = TestBed.inject(HttpTestingController);
    // Espelha o `provideAppInitializer` do app: instancia a cadeia de services
    // para que o efeito de auto-seleção de empresa exista desde o começo.
    TestBed.inject(PermissionsService);
  });

  async function autenticar(usuario: UserProfile): Promise<void> {
    const auth = TestBed.inject(AuthService);
    const entrando = auth.login('jamile@empresa.com.br', 'senha');
    mock
      .expectOne(`${BASE}/auth/login`)
      .flush({ accessToken: 'tok', refreshToken: 'ref', tokenType: 'Bearer', user: usuario });
    await entrando;
    TestBed.tick();

    // O super admin escolhe entre todas as empresas: o servico busca a lista
    // assim que a sessao existe, e as guardas esperam por ela.
    if (usuario.isSuperAdmin) {
      mock
        .expectOne((r) => r.url === `${BASE}/companies`)
        .flush({ data: [], total: 0, page: 1, pageSize: 100, totalPages: 1 });
      TestBed.tick();
    }
  }

  const comUmVinculo = () =>
    makeUser({
      memberships: [
        makeMembership({ companyId: EMPRESA_A, permissions: ['financial-entries:READ'] }),
      ],
    });

  const comDoisVinculosSemPadrao = () =>
    makeUser({
      memberships: [
        makeMembership({ companyId: EMPRESA_A, isDefault: false }),
        makeMembership({ companyId: EMPRESA_B, isDefault: false }),
      ],
    });

  describe('areaAutenticadaGuard', () => {
    it('espera a lista do super admin antes de decidir (F5 numa rota interna)', async () => {
      // Um F5: a escolha ja esta no storage quando os services nascem. O super
      // admin nao tem vinculo, entao ela so volta a valer com a lista da
      // plataforma -- e a guarda precisa esperar por ela.
      TestBed.resetTestingModule();
      activeCompanyStore.set(EMPRESA_A);
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
          provideHttpClientTesting(),
          provideRouter(rotas),
        ],
      });
      router = TestBed.inject(Router);
      mock = TestBed.inject(HttpTestingController);
      TestBed.inject(PermissionsService);

      const auth = TestBed.inject(AuthService);
      const entrando = auth.login('admin@sge.local', 'senha');
      mock.expectOne(`${BASE}/auth/login`).flush({
        accessToken: 'tok',
        refreshToken: 'ref',
        tokenType: 'Bearer',
        user: makeUser({ isSuperAdmin: true, memberships: [] }),
      });
      await entrando;
      TestBed.tick();

      const navegacao = router.navigateByUrl('/financeiro');
      mock
        .expectOne((r) => r.url === `${BASE}/companies`)
        .flush({
          data: [
            {
              id: EMPRESA_A,
              legalName: 'Empresa Fantasma Teste LTDA',
              tradeName: null,
              taxId: null,
              isActive: true,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 100,
          totalPages: 1,
        });
      await navegacao;

      expect(router.url).toBe('/financeiro');
    });

    it('manda ao login quem não tem sessão, guardando a origem', async () => {
      await router.navigateByUrl('/financeiro');
      expect(router.url).toBe('/login?origem=%2Ffinanceiro');
    });

    it('libera quem tem sessão e empresa ativa', async () => {
      await autenticar(comUmVinculo());
      await router.navigateByUrl('/');
      expect(router.url).toBe('/');
    });

    it('manda escolher empresa quando há sessão mas nenhuma ativa', async () => {
      await autenticar(comDoisVinculosSemPadrao());
      await router.navigateByUrl('/');
      expect(router.url).toBe('/selecionar-empresa');
    });
  });

  describe('sessaoGuard', () => {
    it('deixa entrar na seleção de empresa sem empresa ativa', async () => {
      await autenticar(comDoisVinculosSemPadrao());
      await router.navigateByUrl('/selecionar-empresa');
      expect(router.url).toBe('/selecionar-empresa');
    });

    it('manda ao login quem não tem sessão', async () => {
      await router.navigateByUrl('/selecionar-empresa');
      expect(router.url).toBe('/login?origem=%2Fselecionar-empresa');
    });
  });

  describe('apenasAnonimoGuard', () => {
    it('deixa o anônimo ver o login', async () => {
      await router.navigateByUrl('/login');
      expect(router.url).toBe('/login');
    });

    it('tira do login quem já está autenticado', async () => {
      await autenticar(comUmVinculo());
      await router.navigateByUrl('/login');
      expect(router.url).toBe('/');
    });
  });

  describe('permissaoGuard', () => {
    it('libera o módulo quando o perfil tem a permissão', async () => {
      await autenticar(comUmVinculo());
      await router.navigateByUrl('/financeiro');
      expect(router.url).toBe('/financeiro');
    });

    it('bloqueia o módulo quando falta a permissão', async () => {
      await autenticar(
        makeUser({
          memberships: [makeMembership({ companyId: EMPRESA_A, permissions: ['company:READ'] })],
        }),
      );
      await router.navigateByUrl('/financeiro');
      expect(router.url).toBe('/sem-permissao?modulo=financeiro');
    });

    it('libera tudo para o super admin', async () => {
      await autenticar(
        makeUser({
          isSuperAdmin: true,
          memberships: [makeMembership({ companyId: EMPRESA_A, permissions: [] })],
        }),
      );
      await router.navigateByUrl('/financeiro');
      expect(router.url).toBe('/financeiro');
    });
  });

  it('não dispara renovação depois de um login explícito', async () => {
    await autenticar(comUmVinculo());
    await router.navigateByUrl('/');
    // A sessão já é conhecida: nada a restaurar.
    mock.expectNone(`${BASE}/auth/refresh`);
    mock.expectNone(`${BASE}/auth/me`);
  });
});
