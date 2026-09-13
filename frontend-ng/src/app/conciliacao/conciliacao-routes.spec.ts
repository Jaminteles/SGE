import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';

import { routes } from '../app.routes';
import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';

const BASE = '/api/v1';
const VAZIO = { data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

function preparar(permissoes: string[]): HttpTestingController {
  const membership = makeMembership({ permissions: permissoes });
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
          permissoes: () => new Set(permissoes),
          prontidao: () => Promise.resolve(),
          recarregarPlataforma: () => {},
          precisaSelecionar: () => false,
        },
      },
    ],
  });

  return TestBed.inject(HttpTestingController);
}

/**
 * Conciliação entra por `loadChildren` sob a moldura de abas. Sem este teste,
 * um erro de fiação só apareceria clicando no menu com o backend no ar.
 */
describe('rotas de Conciliação (UI-048 a UI-053)', () => {
  it('abre os movimentos dentro da moldura, só com as abas que o perfil alcança', async () => {
    const mock = preparar(['reconciliation:READ']);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/conciliacao');

    mock.match((r) => r.url === `${BASE}/reconciliation/pending`).forEach((r) => r.flush(VAZIO));
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/conciliacao/movimentos');
    const texto = harness.routeNativeElement?.textContent ?? '';
    expect(texto).toContain('Movimentos a conciliar');
    expect(texto).toContain('Divergências');
    expect(texto).toContain('Histórico');
    // Sem `reconciliation-rules:READ`, a aba de regras não aparece.
    expect(texto).not.toContain('Regras');
    // Sem `bank-statements:CREATE`, não há importação.
    expect(texto).not.toContain('Importar extrato');
  });

  it('manda para "sem permissão" as regras e a conciliação sem as permissões', async () => {
    preparar(['reconciliation:READ']);
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/conciliacao/regras');
    expect(TestBed.inject(Router).url).toContain('/sem-permissao');
    TestBed.resetTestingModule();

    preparar(['reconciliation-rules:READ']);
    const outro = await RouterTestingHarness.create();
    await outro.navigateByUrl('/conciliacao/movimentos/22222222-2222-4222-8222-222222222222');
    expect(TestBed.inject(Router).url).toContain('/sem-permissao');
  });
});
