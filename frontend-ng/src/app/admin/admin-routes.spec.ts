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
const PERMISSOES = ['company:READ', 'branches:READ', 'roles:READ', 'memberships:READ'];

/**
 * As rotas do módulo entram por `loadChildren` sob a moldura de abas. Sem este
 * teste, um erro de fiação (filha fora do outlet, guarda no lugar errado) só
 * apareceria clicando na aba com o backend no ar.
 */
describe('rotas de Administração (UI-007)', () => {
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
            // A moldura autenticada desenha o aviso de expiração de sessão.
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
            precisaSelecionar: () => false,
          },
        },
      ],
    });

    mock = TestBed.inject(HttpTestingController);
  });

  it('abre a tela de filiais dentro da moldura de abas', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/administracao/filiais');

    mock
      .expectOne((r) => r.url === `${BASE}/branches`)
      .flush({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
    harness.detectChanges();

    const texto = harness.routeNativeElement?.textContent ?? '';
    expect(texto).toContain('Filiais');
    // A moldura desenha as abas do módulo à volta da tela filha.
    expect(texto).toContain('Perfis e permissões');
  });

  it('manda para "sem permissão" a seção que o perfil não abre', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/administracao/alcadas');

    expect(TestBed.inject(Router).url).toContain('/sem-permissao');
  });
});
