import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { PartnerFormPage } from './partner-form-page';
import { PartnersPage } from './partners-page';
import { PaymentConditionsPage } from './payment-conditions-page';
import { ProductFormPage } from './product-form-page';
import { ProductsPage } from './products-page';
import { consultaParceiro, consultaProduto, descricaoPrazo, rotuloPapel } from './rotulos';

const BASE = '/api/v1';

function paginado<T>(data: T[], total = data.length) {
  return { data, total, page: 1, pageSize: 20, totalPages: 1 };
}

const PARCEIRO = {
  id: 'parc-1',
  companyId: 'empresa-1',
  personType: 'PJ',
  code: null,
  legalName: 'Ferragens Bahia Distribuidora LTDA',
  tradeName: 'Ferragens Bahia',
  cnpj: '33444555000166',
  cpf: null,
  foreignDocument: null,
  stateRegistration: null,
  municipalRegistration: null,
  icmsTaxpayer: true,
  taxRegime: null,
  email: null,
  phone: null,
  website: null,
  isCustomer: false,
  isSupplier: true,
  note: null,
  isActive: true,
  customer: null,
  supplier: {
    partnerId: 'parc-1',
    paymentTermId: null,
    paymentMethodId: null,
    deliveryDays: 5,
    defaultCategoryId: null,
    isApproved: true,
    isBlocked: false,
    blockReason: null,
  },
};

const PRODUTO = {
  id: 'prod-1',
  type: 'PRODUTO',
  code: 'PRD-0101',
  barcode: null,
  description: 'Cimento CP-II 50kg',
  extraDescription: null,
  categoryId: null,
  category: null,
  unitId: 'un-1',
  unit: { id: 'un-1', symbol: 'SC', description: 'Saco' },
  ncm: '25232910',
  cest: null,
  defaultInboundCfop: null,
  defaultOutboundCfop: null,
  goodsOrigin: 0,
  serviceCodeLc116: null,
  averageCost: '41.20',
  lastPurchaseCost: null,
  lastPurchaseDate: null,
  salePrice: '42.90',
  defaultMargin: null,
  tracksStock: true,
  minStock: '200',
  maxStock: null,
  netWeight: null,
  grossWeight: null,
  isActive: true,
};

/** Sessão com as permissões pedidas, como o `AuthService` exporia. */
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

describe('rótulos e filtros dos cadastros', () => {
  it('descreve o papel a partir das flags — a tabela de parceiro é única', () => {
    expect(rotuloPapel({ isCustomer: true, isSupplier: true })).toBe('Cliente e fornecedor');
    expect(rotuloPapel({ isCustomer: true, isSupplier: false })).toBe('Cliente');
    expect(rotuloPapel({ isCustomer: false, isSupplier: true })).toBe('Fornecedor');
  });

  it('não envia papel nem situação em branco', () => {
    expect(consultaParceiro({ q: 'bahia', role: '', situacao: '' })).toEqual({
      q: 'bahia',
      role: undefined,
      isActive: undefined,
    });
    expect(consultaParceiro({ q: '', role: 'FORNECEDOR', situacao: 'true' })).toMatchObject({
      role: 'FORNECEDOR',
      isActive: true,
    });
  });

  it('traduz tipo e categoria do catálogo para os filtros da API', () => {
    expect(consultaProduto({ q: '', type: 'SERVICO', categoryId: '', situacao: '' })).toEqual({
      q: '',
      type: 'SERVICO',
      categoryId: undefined,
      isActive: undefined,
    });
  });

  it('descreve o prazo da condição em uma linha', () => {
    expect(descricaoPrazo({ installments: 1, intervalDays: 30, firstDueDays: 0 })).toBe(
      'Data da emissão',
    );
    expect(descricaoPrazo({ installments: 3, intervalDays: 30, firstDueDays: 30 })).toBe(
      '30 dias após emissão · 3x a cada 30 dias',
    );
  });
});

describe('PartnersPage (UI-018)', () => {
  let mock: HttpTestingController;

  beforeEach(() => {
    prepararSessao(['partners:READ']);
    mock = TestBed.inject(HttpTestingController);
  });

  it('mostra CNPJ formatado e o papel exercido numa listagem só', async () => {
    const fixture = TestBed.createComponent(PartnersPage);
    fixture.detectChanges();

    mock.expectOne((r) => r.url === `${BASE}/partners`).flush(paginado([PARCEIRO]));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Ferragens Bahia Distribuidora LTDA');
    expect(texto).toContain('33.444.555/0001-66');
    expect(texto).toContain('Fornecedor');
  });

  it('manda o papel escolhido como `role`, não como duas rotas diferentes', async () => {
    const fixture = TestBed.createComponent(PartnersPage);
    fixture.detectChanges();
    mock.expectOne((r) => r.url === `${BASE}/partners`).flush(paginado([]));
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      lista: { aplicarFiltros: (v: Record<string, string>) => void };
    };
    pagina.lista.aplicarFiltros({ q: '', role: 'CLIENTE', situacao: '' });

    const consulta = mock.expectOne((r) => r.url === `${BASE}/partners`);
    expect(consulta.request.params.get('role')).toBe('CLIENTE');
    expect(consulta.request.params.has('situacao')).toBe(false);
    consulta.flush(paginado([]));
  });
});

describe('PartnerFormPage (UI-018)', () => {
  it('só envia o perfil do papel que está marcado', async () => {
    prepararSessao(['partners:READ', 'partners:UPDATE']);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: { get: () => 'parc-1' } } },
    });
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(PartnerFormPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/partners/parc-1`).flush(PARCEIRO);
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      mudar: (campo: string, valor: unknown) => void;
      salvar: () => void;
    };
    pagina.mudar('supplierPaymentTermId', 'cond-1');
    pagina.mudar('creditLimit', '80000.00');
    pagina.salvar();

    const patch = mock.expectOne(`${BASE}/partners/parc-1`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body.supplier.paymentTermId).toBe('cond-1');
    // O papel de cliente está desligado: o perfil não pode viajar junto.
    expect(patch.request.body.customer).toBeUndefined();
    expect(patch.request.body.isSupplier).toBe(true);
    patch.flush(PARCEIRO);
  });

  it('busca cada aba só quando o usuário a abre', async () => {
    prepararSessao(['partners:READ', 'partner-contacts:READ']);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: { get: () => 'parc-1' } } },
    });
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(PartnerFormPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/partners/parc-1`).flush(PARCEIRO);
    await fixture.whenStable();

    // Nada de endereços ainda: a aba não foi aberta.
    mock.verify();

    const pagina = fixture.componentInstance as unknown as { trocar: (s: string) => void };
    pagina.trocar('enderecos');
    mock.expectOne(`${BASE}/partners/parc-1/addresses`).flush([]);
  });
});

describe('PaymentConditionsPage (UI-019)', () => {
  it('envia `firstDueDays` zero — à vista não pode virar campo ausente', async () => {
    prepararSessao(['payment-terms:READ', 'payment-terms:CREATE']);
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(PaymentConditionsPage);
    fixture.detectChanges();
    mock.expectOne((r) => r.url === `${BASE}/payment-terms`).flush(paginado([]));
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      mudarCondicao: (campo: string, valor: string) => void;
      salvarCondicao: () => void;
    };
    pagina.mudarCondicao('code', 'CP-001');
    pagina.mudarCondicao('name', 'À vista');
    pagina.mudarCondicao('firstDueDays', '0');
    pagina.salvarCondicao();

    const criacao = mock.expectOne((r) => r.url === `${BASE}/payment-terms`);
    expect(criacao.request.method).toBe('POST');
    expect(criacao.request.body.firstDueDays).toBe(0);
    criacao.flush({ id: 'cond-1' });
  });

  it('só consulta a seção visível', async () => {
    prepararSessao(['payment-terms:READ', 'payment-methods:READ']);
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(PaymentConditionsPage);
    fixture.detectChanges();
    mock.expectOne((r) => r.url === `${BASE}/payment-terms`).flush(paginado([]));
    // A aba de formas ainda não foi aberta.
    mock.verify();

    const pagina = fixture.componentInstance as unknown as { trocar: (s: string) => void };
    pagina.trocar('formas');
    mock.expectOne((r) => r.url === `${BASE}/payment-methods`).flush(paginado([]));
  });
});

describe('ProductsPage e ProductFormPage (UI-020)', () => {
  it('mostra NCM e preço formatados na listagem', async () => {
    prepararSessao(['products:READ']);
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(ProductsPage);
    fixture.detectChanges();
    mock.expectOne((r) => r.url === `${BASE}/products`).flush(paginado([PRODUTO]));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('PRD-0101');
    expect(texto).toContain('25232910');
    expect(texto).toContain('R$ 42,90');
    expect(texto).toContain('SC');
  });

  it('não manda NCM em serviço — a tributação sai do código da LC 116', async () => {
    prepararSessao(['products:CREATE']);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: { get: () => 'novo' } } },
    });
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(ProductFormPage);
    fixture.detectChanges();
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      mudar: (campo: string, valor: unknown) => void;
      salvar: () => void;
    };
    pagina.mudar('code', 'SRV-0012');
    pagina.mudar('description', 'Levantamento topográfico');
    pagina.mudar('ncm', '25232910');
    pagina.mudar('serviceCodeLc116', '7.01');
    pagina.mudar('type', 'SERVICO');
    pagina.mudar('salePrice', '380.00');
    pagina.salvar();

    const criacao = mock.expectOne((r) => r.url === `${BASE}/products`);
    expect(criacao.request.method).toBe('POST');
    expect(criacao.request.body.ncm).toBeUndefined();
    expect(criacao.request.body.serviceCodeLc116).toBe('7.01');
    // Preço é string decimal do campo até a API (RN-012).
    expect(criacao.request.body.salePrice).toBe('380.00');
  });
});

describe('pendências de UI-018 e UI-020', () => {
  it('não envia bloqueio sem motivo e manda o motivo quando informado', async () => {
    prepararSessao(['partners:READ', 'partners:UPDATE']);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: { get: () => 'parc-1' } } },
    });
    const mock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(PartnerFormPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/partners/parc-1`).flush(PARCEIRO);
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      mudar: (campo: string, valor: unknown) => void;
      salvar: () => void;
    };
    pagina.mudar('supplierIsBlocked', true);
    pagina.salvar();
    // O backend exige o motivo: sem ele, nada sai da tela.
    mock.verify();

    pagina.mudar('supplierBlockReason', 'Atrasos recorrentes na entrega');
    pagina.salvar();

    const patch = mock.expectOne(`${BASE}/partners/parc-1`);
    expect(patch.request.body.supplier.isBlocked).toBe(true);
    expect(patch.request.body.supplier.blockReason).toBe('Atrasos recorrentes na entrega');
    patch.flush(PARCEIRO);
  });

  it('edita a homologação sem mandar o fornecedor', async () => {
    prepararSessao([
      'products:READ',
      'products:UPDATE',
      'product-suppliers:READ',
      'product-suppliers:UPDATE',
    ]);
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { paramMap: { get: () => 'prod-1' } } },
    });
    const mock = TestBed.inject(HttpTestingController);
    const HOMOLOGACAO = {
      id: 'sup-1',
      productId: 'prod-1',
      partnerId: 'parc-1',
      partner: { id: 'parc-1', legalName: 'Ferragens Bahia Distribuidora LTDA', tradeName: null },
      supplierCode: 'FB-778',
      referencePrice: '39.900000',
      deliveryDays: 5,
      isPreferred: true,
    };

    const fixture = TestBed.createComponent(ProductFormPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/products/prod-1`).flush(PRODUTO);
    mock.expectOne(`${BASE}/products/prod-1/suppliers`).flush([HOMOLOGACAO]);
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as {
      abrirEdicaoFornecedor: (f: unknown) => void;
      mudarFornecedor: (campo: string, valor: string) => void;
      salvarFornecedor: () => void;
    };
    pagina.abrirEdicaoFornecedor(HOMOLOGACAO);
    pagina.mudarFornecedor('referencePrice', '40.50');
    pagina.salvarFornecedor();

    const patch = mock.expectOne(`${BASE}/products/prod-1/suppliers/sup-1`);
    expect(patch.request.method).toBe('PATCH');
    // A homologação é do par item × fornecedor: trocar o fornecedor é outra.
    expect(patch.request.body.partnerId).toBeUndefined();
    expect(patch.request.body.referencePrice).toBe('40.50');
    patch.flush(HOMOLOGACAO);
    mock.expectOne(`${BASE}/products/prod-1/suppliers`).flush([HOMOLOGACAO]);
  });
});
