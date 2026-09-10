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
const PERMISSOES = ['purchase-orders:READ', 'goods-receipts:READ'];

const VAZIO = { data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

/**
 * Compras entra por `loadChildren` sob a moldura de abas. Sem este teste, um
 * erro de fiação (filha fora do outlet, guarda no lugar errado) só apareceria
 * clicando na aba com o backend no ar.
 */
describe('rotas de Compras (UI-030 a UI-035)', () => {
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

  it('abre os pedidos dentro da moldura, só com as abas que o perfil alcança', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/compras');

    mock.match((r) => r.url === `${BASE}/purchase-orders`).forEach((r) => r.flush(VAZIO));
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/compras/pedidos');
    const texto = harness.routeNativeElement?.textContent ?? '';
    expect(texto).toContain('Pedidos de compra');
    expect(texto).toContain('Recebimentos');
    // Sem `purchase-history:READ`, a aba do histórico não aparece.
    expect(texto).not.toContain('Histórico de preços');
    // Sem `purchase-orders:CREATE`, não há botão de novo pedido.
    expect(texto).not.toContain('Novo pedido');
  });

  it('manda para "sem permissão" o histórico e o recebimento sem as permissões', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/compras/historico');
    expect(TestBed.inject(Router).url).toContain('/sem-permissao');

    await harness.navigateByUrl('/compras/pedidos/ped-1/receber');
    expect(TestBed.inject(Router).url).toContain('/sem-permissao');
  });
});
