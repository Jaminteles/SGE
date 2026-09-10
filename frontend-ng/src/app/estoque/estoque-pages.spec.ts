import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { InventoryDetailPage } from './inventory-detail-page';
import { StockBalancesPage } from './stock-balances-page';
import { StockMovementsPage } from './stock-movements-page';
import { OPCOES_LANCAMENTO, exigeJustificativa, reduzSaldo } from './rotulos';

const BASE = '/api/v1';

function paginado<T>(data: T[], total = data.length) {
  return { data, total, page: 1, pageSize: 20, totalPages: 1 };
}

const SALDO = {
  id: 'sal-1',
  productId: 'prod-1',
  product: {
    id: 'prod-1',
    code: 'PRD-0101',
    description: 'Cimento CP-II 50kg',
    minStock: '200',
    maxStock: null,
  },
  locationId: 'loc-1',
  location: { id: 'loc-1', code: 'ALM', name: 'Almox. Matriz', branch: null },
  quantity: '480.5',
  reserved: '0',
  averageCost: '41.20',
  totalValue: '19796.60',
};

const INVENTARIO = {
  id: 'inv-1',
  locationId: 'loc-1',
  location: { id: 'loc-1', code: 'ALM', name: 'Almox. Matriz', branch: null },
  number: 'INV-2026-03',
  description: null,
  startedAt: '2026-08-28',
  finishedAt: null,
  status: 'EM_CONTAGEM',
  responsibleId: null,
  responsible: null,
  items: [
    {
      id: 'item-1',
      productId: 'prod-1',
      product: { id: 'prod-1', code: 'PRD-0148', description: 'Vergalhão CA-50 10mm' },
      systemQuantity: '1240',
      countedQuantity: null,
      difference: '0',
      unitCost: '64.80',
      isAdjusted: false,
      note: null,
    },
  ],
};

function prepararSessao(permissoes: string[]): void {
  const membership = makeMembership({ permissions: permissoes });
  const usuario = makeUser({ memberships: [membership] });

  localStorage.clear();
  activeCompanyStore.set(membership.companyId);

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
      provideHttpClientTesting(),
      {
        provide: AuthService,
        useValue: {
          usuario: () => usuario,
          superAdmin: () => false,
          autenticado: () => true,
          prontidao: () => Promise.resolve(),
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
        },
      },
    ],
  });
}

describe('rótulos do estoque', () => {
  it('não oferece transferência nem inventário como lançamento manual', () => {
    const valores = OPCOES_LANCAMENTO.map((o) => o.value);
    expect(valores).toEqual(['ENTRADA', 'SAIDA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO']);
  });

  it('sabe quais tipos reduzem o saldo e quais exigem justificativa', () => {
    expect(reduzSaldo('SAIDA')).toBe(true);
    expect(reduzSaldo('TRANSFERENCIA_SAIDA')).toBe(true);
    expect(reduzSaldo('ENTRADA')).toBe(false);
    expect(exigeJustificativa('AJUSTE_NEGATIVO')).toBe(true);
    expect(exigeJustificativa('ENTRADA')).toBe(false);
  });
});

describe('StockBalancesPage (UI-021)', () => {
  it('mostra saldo com as casas da quantidade e custo médio como moeda', async () => {
    prepararSessao(['stock:READ']);
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(StockBalancesPage);
    fixture.detectChanges();

    mock.expectOne((r) => r.url === `${BASE}/stock/balances`).flush(paginado([SALDO]));
    mock.expectOne((r) => r.url === `${BASE}/stock/alerts`).flush([]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('480,50');
    expect(texto).toContain('R$ 41,20');
    expect(texto).toContain('R$ 19.796,60');
  });

  it('não pede a valorização sem a permissão própria dela', async () => {
    prepararSessao(['stock:READ']);
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(StockBalancesPage);
    fixture.detectChanges();
    mock.expectOne((r) => r.url === `${BASE}/stock/balances`).flush(paginado([]));
    mock.expectOne((r) => r.url === `${BASE}/stock/alerts`).flush([]);
    await fixture.whenStable();

    // `stock/valuation` exige `stock-valuation:READ`: sem ela, nem é chamada.
    mock.verify();
  });
});

describe('StockMovementsPage (UI-022)', () => {
  it('barra ajuste sem justificativa antes de chamar a API', async () => {
    prepararSessao(['stock-movements:READ', 'stock-movements:CREATE']);
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(StockMovementsPage);
    fixture.detectChanges();
    mock.expectOne((r) => r.url === `${BASE}/stock/movements`).flush(paginado([]));
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      mudarMovimento: (campo: string, valor: string) => void;
      salvarMovimento: () => void;
      movimentoValido: () => boolean;
    };
    pagina.mudarMovimento('type', 'AJUSTE_NEGATIVO');
    pagina.mudarMovimento('productId', 'prod-1');
    pagina.mudarMovimento('locationId', 'loc-1');
    pagina.mudarMovimento('quantity', '3');

    expect(pagina.movimentoValido()).toBe(false);
    pagina.salvarMovimento();
    // Nada enviado: o razão é append-only e o ajuste precisa de motivo.
    mock.verify();

    pagina.mudarMovimento('note', 'Quebra em obra');
    expect(pagina.movimentoValido()).toBe(true);
    pagina.salvarMovimento();

    const criacao = mock.expectOne(`${BASE}/stock/movements`);
    expect(criacao.request.method).toBe('POST');
    expect(criacao.request.body.note).toBe('Quebra em obra');
    expect(criacao.request.body.quantity).toBe('3');
    criacao.flush({ id: 'mov-1' });
  });

  it('usa a rota de transferência e recusa origem igual ao destino', async () => {
    prepararSessao(['stock-movements:READ', 'stock-movements:CREATE']);
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(StockMovementsPage);
    fixture.detectChanges();
    mock.expectOne((r) => r.url === `${BASE}/stock/movements`).flush(paginado([]));
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      mudarTransferencia: (campo: string, valor: string) => void;
      salvarTransferencia: () => void;
      transferenciaValida: () => boolean;
    };
    pagina.mudarTransferencia('productId', 'prod-1');
    pagina.mudarTransferencia('fromLocationId', 'loc-1');
    pagina.mudarTransferencia('toLocationId', 'loc-1');
    pagina.mudarTransferencia('quantity', '40');

    expect(pagina.transferenciaValida()).toBe(false);
    pagina.salvarTransferencia();
    mock.verify();

    pagina.mudarTransferencia('toLocationId', 'loc-2');
    pagina.salvarTransferencia();

    // Uma operação, duas pernas: rota própria, não dois movimentos soltos.
    const transferencia = mock.expectOne(`${BASE}/stock/transfers`);
    expect(transferencia.request.method).toBe('POST');
    expect(transferencia.request.body.fromLocationId).toBe('loc-1');
    expect(transferencia.request.body.toLocationId).toBe('loc-2');
    transferencia.flush([]);
  });
});

describe('InventoryDetailPage (UI-023)', () => {
  it('projeta diferença e impacto em decimal, sem ponto flutuante', async () => {
    prepararSessao(['inventories:READ', 'inventories:UPDATE']);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: { get: () => 'inv-1' } } },
    });
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(InventoryDetailPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/inventories/inv-1`).flush(INVENTARIO);
    fixture.detectChanges();
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      registrarContagem: (item: { id: string }, valor: string) => void;
      ajusteProjetado: () => string;
      divergentes: () => number;
      salvarContagem: () => void;
    };
    // 1232 contados contra 1240 no sistema, a R$ 64,80: −8 × 64,80 = −518,40.
    pagina.registrarContagem({ id: 'item-1' }, '1232');
    expect(pagina.divergentes()).toBe(1);
    expect(pagina.ajusteProjetado()).toBe('-518.40');

    pagina.salvarContagem();
    const contagem = mock.expectOne(`${BASE}/inventories/inv-1/counts`);
    expect(contagem.request.method).toBe('PATCH');
    // A contagem viaja pelo `productId`, como o backend espera.
    expect(contagem.request.body.counts).toEqual([
      { productId: 'prod-1', countedQuantity: '1232.00' },
    ]);
    contagem.flush(INVENTARIO);
  });

  it('não oferece concluir sem a permissão de aprovação', async () => {
    prepararSessao(['inventories:READ', 'inventories:UPDATE']);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: { get: () => 'inv-1' } } },
    });
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(InventoryDetailPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/inventories/inv-1`).flush(INVENTARIO);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Salvar contagem');
    // Quem conta não homologa o ajuste de patrimônio.
    expect(texto).not.toContain('Concluir inventário');
  });
});
