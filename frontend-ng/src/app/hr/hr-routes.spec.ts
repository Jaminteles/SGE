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
const PERMISSOES = ['employees:READ', 'departments:READ', 'positions:READ', 'reimbursements:READ'];

/**
 * As telas do RH entram por `loadChildren` sob a moldura de abas. Sem este
 * teste, um erro de fiação (filha fora do outlet, guarda no lugar errado) só
 * apareceria clicando na aba com o backend no ar.
 */
describe('rotas do RH (UI-013 a UI-017)', () => {
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

  it('abre a listagem de funcionários dentro da moldura de abas', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/rh/funcionarios');

    mock
      .match((r) => r.url === `${BASE}/employees`)
      .forEach((r) => r.flush({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }));
    mock
      .match((r) => r.url === `${BASE}/departments`)
      .forEach((r) => r.flush({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }));
    harness.detectChanges();

    const texto = harness.routeNativeElement?.textContent ?? '';
    expect(texto).toContain('Funcionários');
    // A moldura desenha as abas do módulo à volta da tela filha.
    expect(texto).toContain('Reembolsos');
  });

  it('manda para "sem permissão" a seção que o perfil não abre', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/rh/verbas');

    expect(TestBed.inject(Router).url).toContain('/sem-permissao');
  });
});
