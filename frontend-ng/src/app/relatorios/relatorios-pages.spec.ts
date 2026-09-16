import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';

import { routes } from '../app.routes';
import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type {
  CashFlowDashboard,
  FinancialDashboard,
  PortfolioDashboard,
  PurchasingDashboard,
  WorkforceDashboard,
} from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { CashFlowReportPage } from './cash-flow-report-page';
import { FinancialDashboardPage } from './financial-dashboard-page';
import {
  ReportFilterStore,
  competenciaLegivel,
  dimensoesEmUso,
  filtroPadrao,
  paraConsulta,
  problemaFiltro,
  rotuloFaixa,
  rotuloSituacaoCaixa,
} from './filtros';
import { PortfolioPage } from './portfolio-page';
import { PurchasingPage } from './purchasing-page';
import { StatementsPage } from './statements-page';
import { WorkforcePage } from './workforce-page';

const BASE = '/api/v1';

function prepararSessao(
  permissoes: string[],
  comRotas = false,
): { mock: HttpTestingController; companyId: string } {
  const membership = makeMembership({ permissions: permissoes });
  const usuario = makeUser({ memberships: [membership] });

  localStorage.clear();
  activeCompanyStore.set(membership.companyId);

  TestBed.configureTestingModule({
    providers: [
      provideRouter(comRotas ? routes : []),
      provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
      provideHttpClientTesting(),
      ReportFilterStore,
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

  return { mock: TestBed.inject(HttpTestingController), companyId: membership.companyId };
}

function financeiro(): FinancialDashboard {
  return {
    period: { from: '2026-03-01', to: '2026-03-31' },
    openPortfolio: {
      receivable: '15000.00',
      payable: '9000.00',
      overdueReceivable: '2500.00',
      overduePayable: '0.00',
      installments: 12,
    },
    realized: {
      inflow: '8000.00',
      outflow: '5000.00',
      net: '3000.00',
      settlements: 7,
      interest: '120.00',
      discount: '30.00',
    },
    byMonth: [{ competence: '2026-03-01', inflow: '8000.00', outflow: '5000.00', net: '3000.00' }],
  };
}

function carteira(): PortfolioDashboard {
  return {
    period: { from: '2026-03-01', to: '2026-03-31' },
    dueInPeriod: [
      {
        type: 'RECEBER',
        agingBand: 'A_VENCER',
        competence: '2026-03-01',
        installments: 3,
        balance: '5000.00',
        charges: '0.00',
        updatedAmount: '5000.00',
      },
    ],
    aging: [
      { band: 'A_VENCER', installments: 3, receivable: '5000.00', payable: '1000.00' },
      { band: 'ATE_30', installments: 1, receivable: '1200.00', payable: '300.00' },
      { band: 'DE_31_A_60', installments: 0, receivable: '0.00', payable: '0.00' },
      { band: 'DE_61_A_90', installments: 0, receivable: '0.00', payable: '0.00' },
      { band: 'ACIMA_DE_90', installments: 2, receivable: '800.00', payable: '0.00' },
    ],
    totals: { receivable: '5000.00', payable: '1000.00' },
  };
}

function caixa(): CashFlowDashboard {
  return {
    period: { from: '2026-03-01', to: '2026-03-31' },
    cash: {
      days: [
        {
          date: '2026-03-10',
          status: 'REALIZADO',
          inflow: '1000.00',
          outflow: '400.00',
          movements: 3,
        },
      ],
      totals: { REALIZADO: { inflow: '1000.00', outflow: '400.00' } },
    },
    result: {
      lines: [
        {
          competence: '2026-03-01',
          type: 'RECEITA',
          accountCode: '3.1',
          accountName: 'Receita de serviços',
          amount: '1000.00',
        },
      ],
      revenue: '1000.00',
      expense: '400.00',
      net: '600.00',
    },
  };
}

function compras(): PurchasingDashboard {
  return {
    period: { from: '2026-03-01', to: '2026-03-31' },
    orders: [
      {
        competence: '2026-03-01',
        status: 'APROVADO',
        orders: 4,
        productsAmount: '10000.00',
        freightAmount: '500.00',
        totalAmount: '10500.00',
      },
    ],
    suppliers: [
      {
        partnerId: 'par-1',
        partnerName: 'ACME Distribuidora',
        orders: 4,
        totalAmount: '10500.00',
        receipts: 3,
        divergentReceipts: 1,
        averageLeadTimeDays: '7.500000',
        worstDeliveryDelayDays: 12,
      },
    ],
    stock: [
      {
        locationId: 'loc-1',
        locationName: 'Depósito central',
        productCategoryId: null,
        items: 40,
        quantity: '250.000000',
        totalAmount: '32000.00',
        itemsBelowMinimum: 2,
      },
    ],
    totals: { purchased: '10500.00', stockValue: '32000.00', itemsBelowMinimum: 2 },
  };
}

function pessoal(): WorkforceDashboard {
  return {
    period: { from: '2026-03-01', to: '2026-03-31' },
    headcount: [
      {
        departmentId: 'dep-1',
        departmentName: 'Operações',
        positionId: null,
        costCenterId: 'cc-1',
        status: 'ATIVO',
        employees: 10,
        employeesWithSalary: 10,
        baseSalaryTotal: '45000.00',
      },
    ],
    movement: [{ competence: '2026-03-01', departmentId: 'dep-1', hires: 2, terminations: 1 }],
    costCenters: [
      {
        competence: '2026-03-01',
        costCenterId: 'cc-1',
        costCenterName: 'Operações',
        type: 'DESPESA',
        budgetedAmount: '50000.00',
        realizedAmount: '46000.00',
      },
    ],
    totals: { activeEmployees: 10, activeBaseSalary: '45000.00', hires: 2, terminations: 1 },
  };
}

// ---------------------------------------------------------------------------

describe('recorte dos relatórios (UI-072)', () => {
  it('abre no mês corrente e recusa período invertido ou incompleto', () => {
    const padrao = filtroPadrao('2026-03-17');
    expect(padrao.from).toBe('2026-03-01');
    expect(padrao.to).toBe('2026-03-31');
    expect(problemaFiltro(padrao)).toBeNull();
    expect(problemaFiltro({ ...padrao, from: '' })).toContain('período');
    expect(problemaFiltro({ ...padrao, to: '2026-02-01' })).toContain('anterior');
  });

  it('dimensão vazia não vira parâmetro em branco na consulta', () => {
    const filtro = { ...filtroPadrao('2026-03-17'), branchId: 'fil-1', partnerId: '' };
    expect(paraConsulta(filtro)).toEqual({
      from: '2026-03-01',
      to: '2026-03-31',
      branchId: 'fil-1',
    });
    expect(dimensoesEmUso(filtro)).toBe(1);
    expect(dimensoesEmUso(filtroPadrao('2026-03-17'))).toBe(0);
  });

  it('traduz o vocabulário dos painéis', () => {
    expect(rotuloFaixa('ACIMA_DE_90')).toBe('Acima de 90 dias');
    expect(rotuloFaixa('OUTRA')).toBe('OUTRA');
    expect(rotuloSituacaoCaixa('REALIZADO')).toBe('Realizado');
    expect(competenciaLegivel('2026-03-01')).toBe('03/2026');
  });
});

describe('dashboard financeiro (UI-068)', () => {
  it('consulta o período da empresa ativa e separa carteira de realizado', () => {
    const { mock, companyId } = prepararSessao(['dashboards:READ']);
    const fixture = TestBed.createComponent(FinancialDashboardPage);
    fixture.detectChanges();

    const requisicao = mock.expectOne((r) => r.url === `${BASE}/reports/dashboard/financial`);
    expect(requisicao.request.headers.get('x-company-id')).toBe(companyId);
    expect(requisicao.request.params.get('from')).toBeTruthy();
    expect(requisicao.request.params.get('to')).toBeTruthy();
    // A empresa nunca vai no filtro: ela vem do cabeçalho.
    expect(requisicao.request.params.get('companyId')).toBeNull();
    requisicao.flush(financeiro());
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('A receber em aberto');
    expect(texto).toContain('Recebido no período');
    expect(texto).toContain('03/2026');
    mock.verify();
  });

  it('recarrega quando o recorte muda, e só então', () => {
    const { mock } = prepararSessao(['dashboards:READ']);
    const fixture = TestBed.createComponent(FinancialDashboardPage);
    fixture.detectChanges();
    mock.expectOne((r) => r.url === `${BASE}/reports/dashboard/financial`).flush(financeiro());

    const store = TestBed.inject(ReportFilterStore);
    store.aplicar({ ...store.filtro(), branchId: 'fil-1' });
    fixture.detectChanges();

    const recarga = mock.expectOne((r) => r.url === `${BASE}/reports/dashboard/financial`);
    expect(recarga.request.params.get('branchId')).toBe('fil-1');
    recarga.flush(financeiro());
    mock.verify();
  });
});

describe('carteira (UI-069)', () => {
  it('soma o vencido fora do recorte e avisa que o aging é da carteira inteira', () => {
    const { mock } = prepararSessao(['dashboards:READ']);
    const fixture = TestBed.createComponent(PortfolioPage);
    fixture.detectChanges();

    mock.expectOne((r) => r.url === `${BASE}/reports/dashboard/portfolio`).flush(carteira());
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as {
      vencido(): { receivable: string; payable: string };
    };
    // 1200 + 800 a receber; "a vencer" fica de fora.
    expect(pagina.vencido()).toEqual({ receivable: '2000.00', payable: '300.00' });
    expect(fixture.nativeElement.textContent).toContain('O aging é da carteira inteira');
    mock.verify();
  });
});

describe('caixa e resultado (UI-069)', () => {
  it('mostra um cartão por situação e não soma realizado com previsto', () => {
    const { mock } = prepararSessao(['dashboards:READ']);
    const fixture = TestBed.createComponent(CashFlowReportPage);
    fixture.detectChanges();

    mock.expectOne((r) => r.url === `${BASE}/reports/dashboard/cash-flow`).flush(caixa());
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as {
      totaisCaixa(): { situacao: string; liquido: string }[];
    };
    expect(pagina.totaisCaixa()).toEqual([
      expect.objectContaining({ situacao: 'REALIZADO', liquido: '600.00' }),
    ]);
    expect(fixture.nativeElement.textContent).toContain('Caixa — Realizado');
    mock.verify();
  });
});

describe('compras e estoque (UI-070)', () => {
  it('separa a posição de estoque do período das compras', () => {
    const { mock } = prepararSessao(['dashboards:READ']);
    const fixture = TestBed.createComponent(PurchasingPage);
    fixture.detectChanges();

    mock.expectOne((r) => r.url === `${BASE}/reports/dashboard/purchasing`).flush(compras());
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('ACME Distribuidora');
    expect(texto).toContain('Posição de agora');
    expect(texto).toContain('Depósito central');
    mock.verify();
  });
});

describe('pessoal (UI-071)', () => {
  it('mostra o quadro como posição e a movimentação como período', () => {
    const { mock } = prepararSessao(['dashboards:READ']);
    const fixture = TestBed.createComponent(WorkforcePage);
    fixture.detectChanges();

    mock.expectOne((r) => r.url === `${BASE}/reports/dashboard/workforce`).flush(pessoal());
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('O quadro é posição de hoje');
    expect(texto).toContain('Operações');

    const pagina = fixture.componentInstance as unknown as {
      diferenca(a: string, b: string): string;
    };
    expect(pagina.diferenca('50000.00', '46000.00')).toBe('4000.00');
    mock.verify();
  });
});

describe('relatórios contábeis e fiscais (UI-073)', () => {
  it('não consulta a peça cuja permissão de origem falta', () => {
    const { mock } = prepararSessao(['reports:READ', 'accounting-reports:READ']);
    const fixture = TestBed.createComponent(StatementsPage);
    fixture.detectChanges();

    mock.expectOne((r) => r.url === `${BASE}/reports/accounting`).flush({
      period: { from: '2026-03-01', to: '2026-03-31' },
      trialBalance: {
        range: { from: '2026-03-01', to: '2026-03-31' },
        costCenterId: null,
        totalDebit: '1000.00',
        totalCredit: '1000.00',
        balanced: true,
        rows: [],
      },
      incomeStatement: {
        range: { from: '2026-03-01', to: '2026-03-31' },
        revenue: { total: '1000.00', lines: [] },
        cost: { total: '0.00', lines: [] },
        expense: { total: '400.00', lines: [] },
        grossResult: '1000.00',
        netResult: '600.00',
      },
    });
    fixture.detectChanges();

    // Sem `fiscal-reports:READ` a peça fiscal nem é pedida.
    mock.expectNone((r) => r.url === `${BASE}/reports/fiscal`);
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Balancete de verificação');
    expect(texto).toContain('Débito = crédito');
    // Sem `reports:EXPORT` não há barra de exportação.
    expect(texto).not.toContain('Exportar');
    mock.verify();
  });

  it('bloqueia exportar o relatório fiscal sem a permissão do módulo de origem', () => {
    const { mock } = prepararSessao(['reports:READ', 'reports:EXPORT']);
    const fixture = TestBed.createComponent(StatementsPage);
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as {
      relatorio: { set(valor: string): void };
      bloqueioExportacao(): string | null;
      exportar(): void;
    };
    expect(pagina.bloqueioExportacao()).toBeNull();

    pagina.relatorio.set('fiscal');
    fixture.detectChanges();
    expect(pagina.bloqueioExportacao()).toContain('fiscal-reports:READ');

    pagina.exportar();
    mock.expectNone((r) => r.url === `${BASE}/reports/export`);
    mock.verify();
  });

  it('exporta no formato pedido quando a permissão está completa', () => {
    const { mock } = prepararSessao(['reports:READ', 'reports:EXPORT']);
    const fixture = TestBed.createComponent(StatementsPage);
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as {
      formato: { set(valor: string): void };
      exportar(): void;
    };
    pagina.formato.set('csv');
    pagina.exportar();

    const requisicao = mock.expectOne(`${BASE}/reports/export`);
    expect(requisicao.request.method).toBe('POST');
    expect(requisicao.request.body).toMatchObject({ report: 'financeiro', format: 'csv' });
    expect(requisicao.request.body.companyId).toBeUndefined();
    requisicao.flush(new Blob(['a;b']), {
      headers: { 'Content-Disposition': 'attachment; filename="financeiro.csv"' },
    });
    mock.verify();
  });
});

describe('rotas dos Relatórios (UI-068 a UI-073)', () => {
  it('abre o painel financeiro dentro da moldura, com as abas que o perfil alcança', async () => {
    const { mock } = prepararSessao(['dashboards:READ'], true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/relatorios');

    mock
      .match((r) => r.url === `${BASE}/reports/dashboard/financial`)
      .forEach((r) => r.flush(financeiro()));
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/relatorios/financeiro');
    const texto = harness.routeNativeElement?.textContent ?? '';
    expect(texto).toContain('Dashboard financeiro');
    // Sem `reports:READ`: a aba contábil e fiscal não é desenhada.
    expect(texto).not.toContain('Contábil e fiscal');
  });

  it('manda para "sem permissão" a aba contábil e fiscal sem `reports:READ`', async () => {
    prepararSessao(['dashboards:READ'], true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/relatorios/contabil-fiscal');
    expect(TestBed.inject(Router).url).toContain('/sem-permissao');
  });
});
