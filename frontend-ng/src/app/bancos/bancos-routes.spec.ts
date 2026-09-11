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
 * Bancos entra por `loadChildren` sob a moldura de abas. Sem este teste, um
 * erro de fiação (filha fora do outlet, guarda no lugar errado) só apareceria
 * clicando na aba com o backend no ar.
 */
describe('rotas de Bancos (UI-042 a UI-047)', () => {
  it('abre as contas dentro da moldura, só com as abas que o perfil alcança', async () => {
    const mock = preparar(['company-bank-accounts:READ', 'payments:READ']);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/bancos');

    mock.match((r) => r.url === `${BASE}/banking/accounts`).forEach((r) => r.flush(VAZIO));
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/bancos/contas');
    const texto = harness.routeNativeElement?.textContent ?? '';
    expect(texto).toContain('Contas bancárias');
    expect(texto).toContain('Ordens de pagamento');
    expect(texto).toContain('Operações assíncronas');
    // Sem `bank-statements:READ`, extratos e movimentos não aparecem.
    expect(texto).not.toContain('Extratos');
    // Sem `company-bank-accounts:CREATE`, não há botão de nova conta.
    expect(texto).not.toContain('Nova conta');
  });

  it('manda para "sem permissão" a emissão de ordem e os extratos sem as permissões', async () => {
    preparar(['payments:READ']);
    const harness = await RouterTestingHarness.create();

    // Emitir exige `payments:CREATE` e ler as contas de origem.
    await harness.navigateByUrl('/bancos/ordens/nova');
    expect(TestBed.inject(Router).url).toContain('/sem-permissao');

    await harness.navigateByUrl('/bancos/extratos');
    expect(TestBed.inject(Router).url).toContain('/sem-permissao');
  });
});
