import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { routes } from '../app.routes';
import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';

const BASE = '/api/v1';
const PERMISSOES = ['partners:READ', 'products:READ', 'stock:READ', 'stock-movements:READ'];

const VAZIO = { data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

/**
 * As telas de Cadastros e Estoque entram por `loadChildren` sob a moldura de
 * abas. Sem este teste, um erro de fiação (filha fora do outlet, guarda no
 * lugar errado) só apareceria clicando na aba com o backend no ar.
 */
describe('rotas de Cadastros e Estoque (UI-018 a UI-023)', () => {
  let mock: HttpTestingController;

  beforeEach(() => {
    const membership = makeMembership({ permissions: PERMISSOES });
    const usuario = makeUser({ memberships: [membership] });

    localStorage.clear();
    activeCompanyStore.set(membership.companyId);

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            usuario: () => usuario,
            superAdmin: () => false,
            autenticado: () => true,
            prontidao: () => Promise.resolve(),
            expiraEm: () => null,
            logout: () => Promise.resolve(),
          },
        },
        {
          provide: CompanyService,
          useValue: {
            ativaId: () => membership.companyId,
            ativa: () => membership,
            permissoes: () => new Set(PERMISSOES),
            prontidao: () => Promise.resolve(),
            recarregarPlataforma: () => {},
            precisaSelecionar: () => false,
          },
        },
      ],
    });

    mock = TestBed.inject(HttpTestingController);
  });

  it('abre a listagem de parceiros dentro da moldura de abas', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/cadastros/parceiros');

    mock.match((r) => r.url === `${BASE}/partners`).forEach((r) => r.flush(VAZIO));
    harness.detectChanges();

    const texto = harness.routeNativeElement?.textContent ?? '';
    expect(texto).toContain('Clientes e fornecedores');
    // A moldura desenha as abas do módulo à volta da tela filha.
    expect(texto).toContain('Catálogo');
  });

  it('abre os saldos de estoque dentro da moldura de abas', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/estoque/saldos');

    mock.match((r) => r.url === `${BASE}/stock/balances`).forEach((r) => r.flush(VAZIO));
    mock.match((r) => r.url === `${BASE}/stock/alerts`).forEach((r) => r.flush([]));
    harness.detectChanges();

    const texto = harness.routeNativeElement?.textContent ?? '';
    expect(texto).toContain('Saldos por local');
    expect(texto).toContain('Movimentações');
  });

  it('manda para "sem permissão" a seção que o perfil não abre', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/estoque/inventarios');

    expect(TestBed.inject(Router).url).toContain('/sem-permissao');
  });
});
