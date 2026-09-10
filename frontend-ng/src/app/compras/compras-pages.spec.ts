import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type { PurchaseOrderItem } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { subtrairQuantidade, valorBruto, valorLinha, variacaoPercentual } from './calculo';
import { GoodsReceiptFormPage, analisarLinha } from './goods-receipt-form-page';
import { PurchaseHistoryPage } from './purchase-history-page';
import { PurchaseOrderDetailPage } from './purchase-order-detail-page';
import { PurchaseOrderFormPage } from './purchase-order-form-page';
import { consultaRecebimento } from './rotulos';

const BASE = '/api/v1';
const USUARIO_ID = '99999999-9999-4999-8999-999999999999';

function paginado<T>(data: T[], total = data.length) {
  return { data, total, page: 1, pageSize: 20, totalPages: 1 };
}

function item(sobrescrever: Partial<PurchaseOrderItem> = {}): PurchaseOrderItem {
  return {
    id: 'item-1',
    orderId: 'ped-1',
    sequence: 1,
    productId: null,
    product: null,
    description: 'Cimento CP-II 50kg',
    quantity: '10.000000',
    receivedQuantity: '4.000000',
    unitPrice: '12.500000',
    discountAmount: '0.00',
    apportionedFreight: '0.00',
    lineAmount: '125.00',
    costCenterId: null,
    costCenter: null,
    locationId: null,
    location: null,
    note: null,
    ...sobrescrever,
  };
}

function pedido(sobrescrever: Record<string, unknown> = {}) {
  return {
    id: 'ped-1',
    number: 'PC-2026-000012',
    partnerId: 'par-1',
    partner: { id: 'par-1', legalName: 'Votorantim Cimentos SA', tradeName: 'Votorantim' },
    branchId: null,
    branch: null,
    requesterId: 'outro-usuario',
    requester: { id: 'outro-usuario', name: 'Carla Compras' },
    buyerId: null,
    buyer: null,
    orderDate: '2026-09-01T00:00:00.000Z',
    expectedDate: null,
    paymentTermId: null,
    paymentTerm: null,
    paymentMethodId: null,
    paymentMethod: null,
    costCenterId: null,
    costCenter: null,
    categoryId: null,
    category: null,
    productsAmount: '125.00',
    discountAmount: '0.00',
    freightAmount: '0.00',
    insuranceAmount: '0.00',
    otherExpenseAmount: '0.00',
    totalAmount: '125.00',
    status: 'RASCUNHO',
    approvalStatus: 'NAO_REQUERIDA',
    approvedById: null,
    approvedBy: null,
    approvedAt: null,
    note: null,
    canceledAt: null,
    cancelReason: null,
    createdById: 'outro-usuario',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    items: [item()],
    receipts: [],
    ...sobrescrever,
  };
}

function prepararSessao(
  permissoes: string[],
  extras: Provider[] = [],
): { mock: HttpTestingController; companyId: string } {
  const membership = makeMembership({ permissions: permissoes });
  const usuario = makeUser({ id: USUARIO_ID, memberships: [membership] });

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
      ...extras,
    ],
  });

  return { mock: TestBed.inject(HttpTestingController), companyId: membership.companyId };
}

function rota(id: string | null): Provider {
  return {
    provide: ActivatedRoute,
    useValue: {
      snapshot: {
        paramMap: convertToParamMap(id ? { id } : {}),
        queryParamMap: convertToParamMap({}),
      },
    },
  };
}

// ---------------------------------------------------------------------------

describe('aritmética de compras (RN-012)', () => {
  it('arredonda quantidade × preço no centavo, como o backend (ROUND_HALF_UP)', () => {
    expect(valorBruto('3', '0.333333')).toBe('1.00');
    expect(valorBruto('0.5', '0.01')).toBe('0.01');
    expect(valorLinha('10', '12.5', '5.00')).toBe('120.00');
  });

  it('subtrai quantidades com 6 casas e mede a variação de preço', () => {
    expect(subtrairQuantidade('10', '2.5')).toBe('7.500000');
    expect(variacaoPercentual('11', '10')).toBe('10.00');
    expect(variacaoPercentual('9.5', '10')).toBe('-5.00');
    expect(variacaoPercentual('1', '0')).toBeNull();
  });

  it('manda o fim do período de recebimentos como o dia seguinte (to exclusivo)', () => {
    expect(consultaRecebimento({ q: '', divergentOnly: 'true', to: '2026-09-30' })).toMatchObject({
      divergentOnly: true,
      to: '2026-10-01',
    });
  });
});

describe('conferência da linha (UI-032/UI-033)', () => {
  const base = {
    itemId: 'item-1',
    incluir: true,
    receivedQuantity: '6',
    documentPrice: null,
    accepted: true,
    locationId: '',
    batch: '',
    note: '',
  };

  it('saldo inteiro, preço do pedido: conferido e sem justificativa', () => {
    const analise = analisarLinha(item(), base);
    expect(analise.situacao).toBe('Conferido');
    expect(analise.exigeJustificativa).toBe(false);
  });

  it('entrega parcial, preço divergente e recusa exigem justificativa', () => {
    expect(analisarLinha(item(), { ...base, receivedQuantity: '2' }).exigeJustificativa).toBe(true);
    expect(analisarLinha(item(), { ...base, documentPrice: '13' }).divergePreco).toBe(true);
    expect(analisarLinha(item(), { ...base, accepted: false }).exigeJustificativa).toBe(true);
  });

  it('acima do saldo só é problema para a linha aceita', () => {
    expect(analisarLinha(item(), { ...base, receivedQuantity: '7' }).acimaDoSaldo).toBe(true);
    expect(
      analisarLinha(item(), { ...base, receivedQuantity: '7', accepted: false }).acimaDoSaldo,
    ).toBe(false);
  });
});

describe('PurchaseOrderFormPage (UI-030)', () => {
  type Formulario = {
    mudar: (campo: string, valor: unknown) => void;
    mudarLinha: (indice: number, campo: string, valor: unknown) => void;
    adicionarLinha: () => void;
    salvar: () => void;
    problemas: () => string[];
    total: () => string;
    bloqueado: () => boolean;
  };

  it('recusa desconto acima da linha e envia só strings decimais, sem total', async () => {
    const { mock, companyId } = prepararSessao(['purchase-orders:CREATE'], [rota(null)]);
    const fixture = TestBed.createComponent(PurchaseOrderFormPage);
    fixture.detectChanges();
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as Formulario;
    pagina.mudar('partnerId', 'par-1');
    pagina.mudarLinha(0, 'description', 'Cimento CP-II 50kg');
    pagina.mudarLinha(0, 'quantity', '10');
    pagina.mudarLinha(0, 'unitPrice', '12.5');
    pagina.mudarLinha(0, 'discountAmount', '200.00');

    expect(pagina.problemas()).toContain('O desconto do item 1 supera o valor da linha.');
    pagina.salvar();
    mock.verify();

    pagina.mudarLinha(0, 'discountAmount', '5.00');
    pagina.mudar('freightAmount', '30.00');
    expect(pagina.problemas()).toEqual([]);
    // 10 × 12,50 − 5,00 + 30,00 de frete.
    expect(pagina.total()).toBe('150.00');
    pagina.salvar();

    const criacao = mock.expectOne(`${BASE}/purchase-orders`);
    expect(criacao.request.method).toBe('POST');
    // Isolamento por empresa: a requisição sai com a empresa ativa (RLS).
    expect(criacao.request.headers.get('x-company-id')).toBe(companyId);
    const corpo = criacao.request.body;
    expect(corpo.items).toEqual([
      {
        description: 'Cimento CP-II 50kg',
        quantity: '10',
        unitPrice: '12.5',
        discountAmount: '5.00',
      },
    ]);
    expect(corpo.freightAmount).toBe('30.00');
    expect(corpo.totalAmount).toBeUndefined();
    expect(corpo.productsAmount).toBeUndefined();
  });

  it('exige produto ou descrição e previsão depois da data do pedido', async () => {
    prepararSessao(['purchase-orders:CREATE'], [rota(null)]);
    const fixture = TestBed.createComponent(PurchaseOrderFormPage);
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as Formulario;
    pagina.mudar('orderDate', '2026-09-10');
    pagina.mudar('expectedDate', '2026-09-01');
    const problemas = pagina.problemas();
    expect(problemas).toContain('Escolha o fornecedor.');
    expect(problemas).toContain('Informe o produto ou a descrição do item 1.');
    expect(problemas).toContain('A previsão de entrega não pode ser anterior ao pedido.');
  });

  it('na edição do rascunho substitui os itens e limpa só o que foi esvaziado', async () => {
    const { mock } = prepararSessao(
      ['purchase-orders:READ', 'purchase-orders:UPDATE'],
      [rota('ped-1')],
    );
    const fixture = TestBed.createComponent(PurchaseOrderFormPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/purchase-orders/ped-1`).flush(
      pedido({
        paymentTermId: 'cond-1',
        paymentTerm: { id: 'cond-1', code: '30', name: '30 dias' },
      }),
    );
    await fixture.whenStable();
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as Formulario;
    pagina.mudar('paymentTermId', '');
    pagina.adicionarLinha();
    pagina.mudarLinha(1, 'description', 'Areia média');
    pagina.mudarLinha(1, 'quantity', '2');
    pagina.mudarLinha(1, 'unitPrice', '90');
    pagina.salvar();

    const edicao = mock.expectOne(`${BASE}/purchase-orders/ped-1`);
    expect(edicao.request.method).toBe('PATCH');
    expect(edicao.request.body.paymentTermId).toBeNull();
    // Nulo antes e vazio agora: não vira `null` no corpo.
    expect('expectedDate' in edicao.request.body).toBe(false);
    expect(edicao.request.body.items).toHaveLength(2);
    expect(edicao.request.body.items[0].quantity).toBe('10.000000');
  });

  it('não salva pedido que já saiu do rascunho', async () => {
    const { mock } = prepararSessao(
      ['purchase-orders:READ', 'purchase-orders:UPDATE'],
      [rota('ped-1')],
    );
    const fixture = TestBed.createComponent(PurchaseOrderFormPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/purchase-orders/ped-1`).flush(pedido({ status: 'APROVADO' }));
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as Formulario;
    expect(pagina.bloqueado()).toBe(true);
    pagina.salvar();
    mock.verify();
  });
});

describe('PurchaseOrderDetailPage (UI-031)', () => {
  type Detalhe = {
    abrirEnvio: () => void;
    enviar: () => void;
    abrirDecisao: (tipo: string) => void;
    decidir: () => void;
    motivo: { set: (v: string) => void };
    proprioPedido: () => boolean;
    podeDecidir: () => boolean;
    podeCancelar: () => boolean;
    aviso: () => string | null;
  };

  it('mostra a alçada antes de enviar e segue o que o servidor decidiu', async () => {
    const { mock } = prepararSessao(
      ['purchase-orders:READ', 'purchase-orders:UPDATE', 'approval-thresholds:READ'],
      [rota('ped-1')],
    );
    const fixture = TestBed.createComponent(PurchaseOrderDetailPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/purchase-orders/ped-1`).flush(pedido());
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as Detalhe;
    pagina.abrirEnvio();
    const alcada = mock.expectOne((r) => r.url === `${BASE}/approval-thresholds/evaluate`);
    expect(alcada.request.params.get('operation')).toBe('PEDIDO_COMPRA');
    expect(alcada.request.params.get('amount')).toBe('125.00');
    alcada.flush({
      operation: 'PEDIDO_COMPRA',
      amount: '125.00',
      requiresApproval: true,
      authorizedRoles: [{ id: 'role-dir', name: 'Diretoria' }],
      matchedThresholds: [],
    });
    fixture.detectChanges();
    expect(document.body.textContent).toContain('Diretoria');

    pagina.enviar();
    mock
      .expectOne(`${BASE}/purchase-orders/ped-1/submit`)
      .flush(pedido({ status: 'AGUARDANDO_APROVACAO', approvalStatus: 'PENDENTE' }));
    expect(pagina.aviso()).toBe('Pedido enviado para aprovação.');
  });

  it('não oferece a decisão a quem pediu a compra (RN-003)', async () => {
    const { mock } = prepararSessao(
      ['purchase-orders:READ', 'purchase-orders:APPROVE'],
      [rota('ped-1')],
    );
    const fixture = TestBed.createComponent(PurchaseOrderDetailPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/purchase-orders/ped-1`).flush(
      pedido({
        status: 'AGUARDANDO_APROVACAO',
        approvalStatus: 'PENDENTE',
        requesterId: USUARIO_ID,
      }),
    );
    await fixture.whenStable();
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as Detalhe;
    expect(pagina.podeDecidir()).toBe(true);
    expect(pagina.proprioPedido()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Aguardando aprovação de outra pessoa',
    );
  });

  it('exige motivo para reprovar e não cancela pedido com entrega', async () => {
    const { mock } = prepararSessao(
      ['purchase-orders:READ', 'purchase-orders:APPROVE', 'purchase-orders:DELETE'],
      [rota('ped-1')],
    );
    const fixture = TestBed.createComponent(PurchaseOrderDetailPage);
    fixture.detectChanges();
    mock
      .expectOne(`${BASE}/purchase-orders/ped-1`)
      .flush(pedido({ status: 'AGUARDANDO_APROVACAO', approvalStatus: 'PENDENTE' }));
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as Detalhe;
    pagina.abrirDecisao('reprovar');
    pagina.decidir();
    mock.verify();

    pagina.motivo.set('Fora do orçamento do mês');
    pagina.decidir();
    const reprovacao = mock.expectOne(`${BASE}/purchase-orders/ped-1/reject`);
    expect(reprovacao.request.body).toEqual({ reason: 'Fora do orçamento do mês' });
    reprovacao.flush(
      pedido({
        status: 'PARCIALMENTE_RECEBIDO',
        approvalStatus: 'APROVADO',
        receipts: [
          {
            id: 'rec-1',
            number: 'RC-1',
            receivedAt: '2026-09-05T10:00:00.000Z',
            hasDivergence: false,
            generatedStock: true,
            generatedPayable: false,
          },
        ],
      }),
    );
    expect(pagina.podeCancelar()).toBe(false);
  });
});

describe('PurchaseOrderDetailPage — vínculos (UI-034)', () => {
  it('liga fornecedor, notas, entregas e só os títulos deste pedido', async () => {
    const { mock } = prepararSessao(
      [
        'purchase-orders:READ',
        'goods-receipts:READ',
        'fiscal-documents:READ',
        'financial-entries:READ',
      ],
      [rota('ped-1')],
    );
    const fixture = TestBed.createComponent(PurchaseOrderDetailPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/purchase-orders/ped-1`).flush(
      pedido({
        status: 'PARCIALMENTE_RECEBIDO',
        approvalStatus: 'NAO_REQUERIDA',
        receipts: [
          {
            id: 'rec-1',
            number: 'RC-2026-000003',
            receivedAt: '2026-09-05T10:00:00.000Z',
            hasDivergence: true,
            generatedStock: true,
            generatedPayable: true,
          },
        ],
      }),
    );

    const entregas = mock.expectOne((r) => r.url === `${BASE}/purchase-orders/ped-1/receipts`);
    entregas.flush(
      paginado([
        {
          id: 'rec-1',
          number: 'RC-2026-000003',
          fiscalDocument: { id: 'nf-2', number: '4512', series: '1', accessKey: null },
          items: [],
        },
      ]),
    );
    const notas = mock.expectOne((r) => r.url === `${BASE}/fiscal-documents`);
    expect(notas.request.params.get('purchaseOrderId')).toBe('ped-1');
    notas.flush(
      paginado([
        {
          id: 'nf-1',
          number: '4400',
          series: '1',
          issuerPartner: {
            id: 'par-1',
            legalName: 'Votorantim Cimentos SA',
            tradeName: 'Votorantim',
          },
          issuerName: null,
          totalAmount: '125.00',
          status: 'PROCESSADO',
          purchaseOrderId: 'ped-1',
          receipts: [],
          financialEntries: [],
        },
      ]),
    );
    const titulos = mock.expectOne((r) => r.url === `${BASE}/financial-entries`);
    expect(titulos.request.params.get('q')).toBe('PC-2026-000012');
    expect(titulos.request.params.get('type')).toBe('PAGAR');
    titulos.flush(
      paginado([
        {
          id: 'tit-1',
          number: 'CP-000901',
          purchaseOrderId: 'ped-1',
          netAmount: '75.00',
          balance: '75.00',
          status: 'ABERTO',
        },
        {
          id: 'tit-2',
          number: 'CP-000777',
          purchaseOrderId: 'outro-pedido',
          netAmount: '10.00',
          balance: '10.00',
          status: 'ABERTO',
        },
      ]),
    );
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Votorantim');
    expect(texto).toContain('NF 4400/1');
    expect(texto).toContain('NF 4512/1');
    expect(texto).toContain('Entrou no estoque');
    expect(texto).toContain('CP-000901');
    // A busca por número pode trazer título de outro pedido: ele não é vínculo.
    expect(texto).not.toContain('CP-000777');
  });

  it('não consulta vínculo sem a permissão que a API exige', async () => {
    const { mock } = prepararSessao(['purchase-orders:READ'], [rota('ped-1')]);
    const fixture = TestBed.createComponent(PurchaseOrderDetailPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/purchase-orders/ped-1`).flush(pedido({ status: 'APROVADO' }));
    mock.verify();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Sem permissão para consultar títulos.',
    );
  });
});

describe('GoodsReceiptFormPage (UI-032/UI-033)', () => {
  type Recebimento = {
    mudarLinha: (indice: number, campo: string, valor: unknown) => void;
    mudar: (campo: string, valor: unknown) => void;
    registrar: () => void;
    problemas: () => string[];
    linhas: () => { itemId: string; receivedQuantity: string | null }[];
    bloqueado: () => boolean;
  };

  const PERMISSOES = ['purchase-orders:READ', 'goods-receipts:CREATE', 'goods-receipts:READ'];

  async function abrir(pedidoFlush: Record<string, unknown>) {
    const sessao = prepararSessao(PERMISSOES, [rota('ped-1')]);
    const fixture = TestBed.createComponent(GoodsReceiptFormPage);
    fixture.detectChanges();
    sessao.mock.expectOne(`${BASE}/purchase-orders/ped-1`).flush(pedidoFlush);
    await fixture.whenStable();
    fixture.detectChanges();
    return { ...sessao, pagina: fixture.componentInstance as unknown as Recebimento };
  }

  it('sugere só o saldo pendente e exige justificativa da entrega parcial', async () => {
    const { mock, pagina } = await abrir(
      pedido({
        status: 'APROVADO',
        items: [
          item(),
          item({ id: 'item-2', sequence: 2, quantity: '5.000000', receivedQuantity: '5.000000' }),
        ],
      }),
    );

    // O item 2 já chegou inteiro: não entra na conferência.
    expect(pagina.linhas().map((l) => l.itemId)).toEqual(['item-1']);
    expect(pagina.linhas()[0].receivedQuantity).toBe('6.000000');

    pagina.mudarLinha(0, 'receivedQuantity', '7');
    expect(pagina.problemas()[0]).toContain('pendente(s): aceitar mais que isso é recusado');

    pagina.mudarLinha(0, 'receivedQuantity', '4');
    pagina.mudarLinha(0, 'documentPrice', '13');
    expect(pagina.problemas()).toEqual(['Justifique a divergência do item 1 (RF-040).']);
    pagina.registrar();
    mock.verify();

    pagina.mudarLinha(
      0,
      'note',
      'Fornecedor entrega o resto na semana que vem; reajuste de tabela',
    );
    pagina.registrar();
    // Segundo clique com a requisição no ar: nada de segunda entrega.
    pagina.registrar();

    const envio = mock.expectOne(`${BASE}/purchase-orders/ped-1/receipts`);
    expect(envio.request.method).toBe('POST');
    expect(envio.request.body.items).toEqual([
      {
        orderItemId: 'item-1',
        receivedQuantity: '4',
        documentPrice: '13',
        note: 'Fornecedor entrega o resto na semana que vem; reajuste de tabela',
      },
    ]);
    expect(envio.request.body.generatePayable).toBeUndefined();
  });

  it('manda a recusa como accepted=false e pede o título sem valor digitado', async () => {
    const { mock, pagina } = await abrir(pedido({ status: 'PARCIALMENTE_RECEBIDO' }));

    pagina.mudarLinha(0, 'accepted', false);
    pagina.mudarLinha(0, 'note', 'Sacos rasgados');
    pagina.mudar('generatePayable', true);
    expect(pagina.problemas()).toEqual(['Nenhuma linha aceita: não há valor a pagar (RF-041).']);

    pagina.mudar('generatePayable', false);
    pagina.registrar();
    const envio = mock.expectOne(`${BASE}/purchase-orders/ped-1/receipts`);
    expect(envio.request.body.items[0].accepted).toBe(false);
    expect(envio.request.body.payable).toBeUndefined();
  });

  it('exige local de estoque para item controlado', async () => {
    const { pagina } = await abrir(
      pedido({
        status: 'APROVADO',
        items: [
          item({
            productId: 'prod-1',
            product: { id: 'prod-1', code: 'CIM-50', description: 'Cimento', tracksStock: true },
          }),
        ],
      }),
    );
    expect(pagina.problemas()).toContain(
      'Informe o local de estoque que recebeu o item 1 (RF-031).',
    );
  });

  it('não recebe pedido que não está aprovado', async () => {
    const { mock, pagina } = await abrir(pedido({ status: 'AGUARDANDO_APROVACAO' }));
    expect(pagina.bloqueado()).toBe(true);
    pagina.registrar();
    mock.verify();
  });
});

describe('PurchaseHistoryPage (UI-035)', () => {
  it('mostra o resumo do servidor e a evolução contra a compra anterior do item', async () => {
    const { mock } = prepararSessao(['purchase-history:READ']);
    const fixture = TestBed.createComponent(PurchaseHistoryPage);
    fixture.detectChanges();

    const linha = (id: string, data: string, preco: string) => ({
      orderItemId: id,
      orderId: `ped-${id}`,
      number: `PC-${id}`,
      orderDate: data,
      status: 'RECEBIDO',
      partner: { id: 'par-1', legalName: 'Votorantim Cimentos SA' },
      product: { id: 'prod-1', code: 'CIM-50' },
      description: 'Cimento CP-II 50kg',
      quantity: '10.000000',
      receivedQuantity: '10.000000',
      pendingQuantity: '0.000000',
      unitPrice: preco,
      lineAmount: '110.00',
      landedUnitCost: null,
    });

    mock
      .expectOne((r) => r.url === `${BASE}/purchase-history`)
      .flush({
        ...paginado([linha('2', '2026-09-01', '11.000000'), linha('1', '2026-08-01', '10.000000')]),
        summary: {
          lines: 2,
          quantity: '20.000000',
          amount: '210.00',
          averagePrice: '10.500000',
          minPrice: '10.000000',
          maxPrice: '11.000000',
          lastOrderDate: '2026-09-01',
        },
      });
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('R$ 210,00');
    expect(texto).toContain('R$ 10,500000');
    expect(texto).toContain('▲ +10,00%');
    expect(texto).toContain('primeira na página');
  });
});
