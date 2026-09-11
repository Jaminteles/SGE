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
const PERMISSOES = ['fiscal-documents:READ'];

const VAZIO = { data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

/**
 * O Fiscal deixa o espaço reservado e entra por `loadChildren` sob a moldura de
 * abas. Sem este teste, um erro de fiação só apareceria com o backend no ar.
 */
describe('rotas do Fiscal (UI-036 a UI-041)', () => {
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

  it('abre os documentos dentro da moldura, só com as abas que o perfil alcança', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/fiscal');

    mock.match((r) => r.url === `${BASE}/fiscal-documents`).forEach((r) => r.flush(VAZIO));
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/fiscal/documentos');
    const texto = harness.routeNativeElement?.textContent ?? '';
    expect(texto).toContain('Documentos fiscais');
    expect(texto).toContain('Coleta automática');
    // Sem `fiscal-documents:CREATE`: nem a aba nem o botão de importação.
    expect(texto).not.toContain('Importar XML');
  });

  it('manda para "sem permissão" a importação sem `fiscal-documents:CREATE`', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/fiscal/importar');
    expect(TestBed.inject(Router).url).toContain('/sem-permissao');
  });
});
