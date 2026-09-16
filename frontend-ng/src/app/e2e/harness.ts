import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { expect } from 'vitest';

import { routes } from '../app.routes';
import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type { Membership, UserProfile } from '../core/api/types';
import { sessionStore } from '../core/auth/session-store';
import { activeCompanyStore } from '../core/company/active-company-store';
import { makeMembership, makeUser } from '../core/test/factories';

export const BASE = '/api/v1';

/**
 * Moldura dos testes de fluxo (RNF-012 — UI-087) e de isolamento (UI-088).
 *
 * A diferença para os testes de tela já existentes é deliberada: aqui **nada é
 * dublê**. `AuthService`, `CompanyService`, `SessionService`, as guardas, os
 * interceptors e o mapa de rotas completo são os de produção; só a rede é
 * substituída pelo `HttpTestingController`.
 *
 * É o mais perto de ponta a ponta que se chega sem navegador de verdade, e é
 * onde os defeitos que nenhum teste de unidade pega aparecem: guarda que decide
 * antes da sessão restaurar, cabeçalho que falta na segunda requisição, token
 * que não acompanha a repetição, empresa que sobrevive à troca. Um Playwright
 * cobriria também o desenho da tela — e exigiria backend, banco e um navegador
 * no CI; o custo não se justifica para o que este arquivo precisa provar.
 */

/** Access token com `exp` real — o aviso de expiração e a renovação leem dele. */
export function tokenComExpiracao(segundos = 900): string {
  const payload = { sub: 'usr-1', exp: Math.floor(Date.now() / 1000) + segundos };
  const b64 = (valor: object) => btoa(JSON.stringify(valor)).replace(/=+$/, '');
  return `cabecalho.${b64(payload)}.assinatura`;
}

export interface Cenario {
  mock: HttpTestingController;
  router: Router;
  usuario: UserProfile;
  empresas: Membership[];
}

/**
 * Sobe a aplicação **sem sessão**: é assim que o usuário chega, e é o que faz o
 * fluxo de login ser o fluxo de login, e não uma chamada a `AuthService.login`.
 */
export function iniciarAplicacao(permissoes: string[], quantasEmpresas = 1): Cenario {
  localStorage.clear();
  sessionStorage.clear();
  activeCompanyStore.set(null);
  sessionStore.clear();

  const empresas = Array.from({ length: quantasEmpresas }, (_, i) =>
    makeMembership({
      companyId: `1111111${i}-1111-4111-8111-11111111111${i}`,
      isDefault: i === 0,
      permissions: permissoes,
      company: {
        legalName: `Empresa ${i + 1} LTDA`,
        tradeName: `Empresa ${i + 1}`,
        taxId: `1234567800019${i}`,
        isActive: true,
      },
    }),
  );
  const usuario = makeUser({ memberships: empresas });

  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
      provideHttpClientTesting(),
    ],
  });

  return {
    mock: TestBed.inject(HttpTestingController),
    router: TestBed.inject(Router),
    usuario,
    empresas,
  };
}

/** Página vazia no formato das listagens — serve para qualquer tela de lista. */
export const PAGINA_VAZIA = { data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

/**
 * Responde tudo que a navegação disparou.
 *
 * As telas de módulo pedem mais do que o fluxo em teste: categorias, filiais,
 * condições de pagamento. Exigir que o teste conheça cada uma delas o tornaria
 * refém de qualquer tela que ganhe um select novo. O que interessa é o que o
 * fluxo prova; o resto recebe lista vazia.
 */
export function responderPendentes(
  mock: HttpTestingController,
  respostas: Record<string, object> = {},
): TestRequest[] {
  const pendentes = mock.match(() => true);
  for (const req of pendentes) {
    const caminho = req.request.url.replace(`${BASE}/`, '');
    const chave = Object.keys(respostas).find((k) => caminho === k || caminho.startsWith(`${k}?`));
    req.flush(chave ? respostas[chave] : PAGINA_VAZIA);
  }
  return pendentes;
}

/**
 * Componente da tela dentro da moldura.
 *
 * `harness.routeDebugElement` devolve o componente da rota raiz — que na área
 * autenticada é sempre o `AppLayout`. A tela em teste está algumas rotas filhas
 * abaixo, atrás do `loadChildren` do módulo, e só se alcança pela árvore.
 */
export function telaAtiva<T>(harness: RouterTestingHarness, tipo: Type<T>): T {
  const elemento = harness.fixture.debugElement.query(By.directive(tipo));
  expect(elemento, `a tela ${tipo.name} não está na árvore`).toBeTruthy();
  return elemento.componentInstance as T;
}

/** Faz o login pela tela e devolve a requisição que saiu, já respondida. */
export async function entrarPelaTela(
  cenario: Cenario,
  harness: RouterTestingHarness,
  opcoes: { expiraEmSegundos?: number } = {},
): Promise<void> {
  const pagina = harness.routeDebugElement?.componentInstance as {
    email: { set(v: string): void };
    senha: { set(v: string): void };
    entrar(): Promise<void>;
  };

  pagina.email.set('jamile@empresa.com.br');
  pagina.senha.set('senha-correta');
  const login = pagina.entrar();

  const requisicao = cenario.mock.expectOne(`${BASE}/auth/login`);
  expect(requisicao.request.method).toBe('POST');
  // Credencial não pode viajar em query string nem sobrar em cabeçalho.
  expect(requisicao.request.urlWithParams).toBe(`${BASE}/auth/login`);
  expect(requisicao.request.headers.has('Authorization')).toBe(false);
  requisicao.flush({
    accessToken: tokenComExpiracao(opcoes.expiraEmSegundos),
    refreshToken: 'refresh-1',
    user: cenario.usuario,
  });

  await login;
  await harness.fixture.whenStable();
  harness.detectChanges();
}
