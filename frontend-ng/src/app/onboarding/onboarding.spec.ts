import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type { UserProfile } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { CompanyService } from '../core/company/company.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { makeMembership, makeUser } from '../core/test/factories';
import { OnboardingPage } from './onboarding-page';
import { OnboardingStatusService } from './onboarding-status.service';
import { CATEGORIAS_SUGERIDAS, CENTROS_SUGERIDOS } from './sugestoes';

const BASE = '/api/v1';
const EMPRESA = 'aaaaaaaa-1111-4111-8111-111111111111';

function usuarioCom(permissions: string[]): UserProfile {
  return makeUser({ memberships: [makeMembership({ companyId: EMPRESA, permissions })] });
}

function paginaVazia(total = 0) {
  return { data: [], total, page: 1, pageSize: 1, totalPages: total };
}

describe('Onboarding (RF-006 — UI-079)', () => {
  let mock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    activeCompanyStore.set(null);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
      ],
    });
    mock = TestBed.inject(HttpTestingController);
  });

  async function autenticar(usuario: UserProfile): Promise<void> {
    const auth = TestBed.inject(AuthService);
    TestBed.inject(CompanyService);
    const entrando = auth.login('jamile@empresa.com.br', 'senha');
    mock
      .expectOne(`${BASE}/auth/login`)
      .flush({ accessToken: 'tok', refreshToken: 'ref', tokenType: 'Bearer', user: usuario });
    await entrando;
    TestBed.tick();
  }

  it('não consulta coleção que o perfil não pode ler e a conta como zero', async () => {
    await autenticar(usuarioCom(['categories:READ']));
    const status = TestBed.inject(OnboardingStatusService);

    status.carregar();

    mock.expectNone(`${BASE}/branches?pageSize=1`);
    mock.expectNone(`${BASE}/settings`);
    mock.expectNone(`${BASE}/cost-centers?pageSize=1`);
    mock.expectOne(`${BASE}/categories?pageSize=1`).flush(paginaVazia(4));
    TestBed.tick();

    expect(status.situacao()).toEqual({ filiais: 0, categorias: 4, centros: 0, parametros: 0 });
    // Falta centro de custo: o convite da tela inicial continua de pé.
    expect(status.pendente()).toBe(true);
  });

  it('empresa completa não mostra pendência', async () => {
    await autenticar(usuarioCom(['branches:READ', 'categories:READ', 'cost-centers:READ']));
    const status = TestBed.inject(OnboardingStatusService);

    status.carregar();
    mock.expectOne(`${BASE}/branches?pageSize=1`).flush(paginaVazia(1));
    mock.expectOne(`${BASE}/categories?pageSize=1`).flush(paginaVazia(10));
    mock.expectOne(`${BASE}/cost-centers?pageSize=1`).flush(paginaVazia(3));
    TestBed.tick();

    expect(status.pendente()).toBe(false);
  });

  it('cria a estrutura sugerida em série, na ordem das sugestões', async () => {
    await autenticar(
      usuarioCom([
        'branches:READ',
        'categories:READ',
        'categories:CREATE',
        'cost-centers:READ',
        'cost-centers:CREATE',
      ]),
    );

    const fixture = TestBed.createComponent(OnboardingPage);
    fixture.detectChanges();

    mock.expectOne(`${BASE}/branches?pageSize=1`).flush(paginaVazia(1));
    mock.expectOne(`${BASE}/categories?pageSize=1`).flush(paginaVazia(0));
    mock.expectOne(`${BASE}/cost-centers?pageSize=1`).flush(paginaVazia(0));
    TestBed.tick();
    fixture.detectChanges();

    const botao = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      (b as HTMLElement).textContent?.includes('Criar estrutura sugerida'),
    ) as HTMLButtonElement;
    botao.click();

    // Em série: a próxima só sai depois da resposta da anterior — a categoria
    // filha depende do código da mãe já existir.
    for (const categoria of CATEGORIAS_SUGERIDAS) {
      const req = mock.expectOne(`${BASE}/categories`);
      expect(req.request.body).toMatchObject({ code: categoria.code, type: categoria.type });
      req.flush({ id: categoria.code });
    }
    for (const centro of CENTROS_SUGERIDOS) {
      const req = mock.expectOne(`${BASE}/cost-centers`);
      expect(req.request.body).toMatchObject({ code: centro.code });
      req.flush({ id: centro.code });
    }

    // Terminou: a contagem é refeita para o passo sair de "pendente".
    mock.expectOne(`${BASE}/branches?pageSize=1`).flush(paginaVazia(1));
    mock.expectOne(`${BASE}/categories?pageSize=1`).flush(paginaVazia(CATEGORIAS_SUGERIDAS.length));
    mock.expectOne(`${BASE}/cost-centers?pageSize=1`).flush(paginaVazia(CENTROS_SUGERIDOS.length));
    TestBed.tick();
    mock.verify();
  });
});
