import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type { ApprovalThreshold } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { ApprovalsPage, faixaDaAlcada } from './approvals-page';
import { CashFlowPage } from './cash-flow-page';
import { DelinquencyPage } from './delinquency-page';
import { paraCentavos, planejarParcelas, somar, subtrair } from './dinheiro';
import { EntryDetailPage } from './entry-detail-page';
import { EntryFormPage } from './entry-form-page';
import { aceitaBaixa } from './rotulos';

const BASE = '/api/v1';
const USUARIO_ID = '99999999-9999-4999-8999-999999999999';

function paginado<T>(data: T[], total = data.length) {
  return { data, total, page: 1, pageSize: 20, totalPages: 1 };
}

function parcela(sobrescrever: Record<string, unknown> = {}) {
  return {
    id: 'parc-1',
    entryId: 'tit-1',
    number: 1,
    totalInstallments: 1,
    dueDate: '2020-01-10',
    originalDueDate: null,
    amount: '400.00',
    interestAmount: '0',
    penaltyAmount: '0',
    discountAmount: '0',
    settledAmount: '0',
    balance: '400.00',
    dailyInterestRate: '0.033',
    penaltyRate: '2',
    settledAt: null,
    status: 'ABERTA',
    barcode: null,
    digitableLine: null,
    bankIdentifier: null,
    note: null,
    settlements: [],
    ...sobrescrever,
  };
}

function titulo(sobrescrever: Record<string, unknown> = {}) {
  return {
    id: 'tit-1',
    type: 'PAGAR',
    number: 'CP-000123',
    documentReference: 'NF 4512',
    description: 'Cimento lote 12',
    partnerId: 'par-1',
    partner: { id: 'par-1', legalName: 'Votorantim Cimentos SA', tradeName: 'Votorantim' },
    employeeId: null,
    employee: null,
    branchId: null,
    branch: null,
    issueDate: '2020-01-01',
    competenceDate: '2020-01-01',
    grossAmount: '400.00',
    discountAmount: '0',
    netAmount: '400.00',
    settledAmount: '0',
    balance: '400.00',
    categoryId: null,
    category: null,
    costCenterId: null,
    costCenter: null,
    ledgerAccountId: null,
    paymentMethodId: null,
    paymentMethod: null,
    paymentTermId: null,
    paymentTerm: null,
    origin: null,
    status: 'ABERTO',
    approvalStatus: 'NAO_REQUERIDA',
    canceledAt: null,
    cancelReason: null,
    note: null,
    createdById: 'outro-usuario',
    createdAt: '2020-01-01T12:00:00.000Z',
    installments: [parcela()],
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

function rota(id: string | null, query: Record<string, string> = {}): Provider {
  return {
    provide: ActivatedRoute,
    useValue: {
      snapshot: {
        paramMap: convertToParamMap(id ? { id } : {}),
        queryParamMap: convertToParamMap(query),
      },
    },
  };
}

// ---------------------------------------------------------------------------

describe('dinheiro da tela financeira (RN-012)', () => {
  it('fecha a soma em centavos, sem ponto flutuante', () => {
    expect(somar('0.10', '0.20')).toBe('0.30');
    expect(subtrair('100.00', '100.01')).toBe('-0.01');
    expect(paraCentavos('-1234.5')).toBe(-123450n);
  });

  it('prevê o parcelamento com o resto na última parcela, como o backend (RF-053)', () => {
    const parcelas = planejarParcelas('1000.00', 3, '2026-09-10', 30);
    expect(parcelas.map((p) => p.valor)).toEqual(['333.33', '333.33', '333.34']);
    expect(parcelas.map((p) => p.vencimento)).toEqual(['2026-09-10', '2026-10-10', '2026-11-09']);
    expect(somar(...parcelas.map((p) => p.valor))).toBe('1000.00');
  });

  it('não oferece baixa para título pendente ou reprovado (RF-056)', () => {
    expect(aceitaBaixa({ status: 'ABERTO', approvalStatus: 'NAO_REQUERIDA' })).toBe(true);
    expect(aceitaBaixa({ status: 'ABERTO', approvalStatus: 'APROVADO' })).toBe(true);
    expect(aceitaBaixa({ status: 'ABERTO', approvalStatus: 'PENDENTE' })).toBe(false);
    expect(aceitaBaixa({ status: 'ABERTO', approvalStatus: 'REPROVADO' })).toBe(false);
    expect(aceitaBaixa({ status: 'LIQUIDADO', approvalStatus: 'APROVADO' })).toBe(false);
  });

  it('acha a faixa de alçada pelo valor e pela carteira', () => {
    const faixa = (id: string, min: string, max: string | null): ApprovalThreshold => ({
      id,
      name: id,
      operation: 'TITULO_PAGAR',
      minAmount: min,
      maxAmount: max,
      level: 1,
      minApprovers: 1,
      isActive: true,
      requiredRoles: [],
    });
    const faixas = [faixa('ate-mil', '0.00', '1000.00'), faixa('acima', '1000.01', null)];
    expect(faixaDaAlcada(faixas, 'PAGAR', '1000.00')?.id).toBe('ate-mil');
    expect(faixaDaAlcada(faixas, 'PAGAR', '1500.00')?.id).toBe('acima');
    expect(faixaDaAlcada(faixas, 'RECEBER', '1500.00')).toBeNull();
  });
});

describe('EntryFormPage (UI-024/UI-025)', () => {
  type Formulario = {
    mudar: (campo: string, valor: unknown) => void;
    mudarLinha: (indice: number, campo: string, valor: string | null) => void;
    adicionarLinha: () => void;
    salvar: () => void;
    problemas: () => string[];
    previa: () => { valor: string }[];
  };

  function preencher(pagina: Formulario): void {
    pagina.mudar('partnerId', 'par-1');
    pagina.mudar('description', 'Cimento lote 12');
    pagina.mudar('grossAmount', '1000.00');
  }

  it('bloqueia parcelas informadas que não somam o líquido e envia strings decimais', async () => {
    const { mock, companyId } = prepararSessao(['financial-entries:CREATE'], [rota(null)]);
    const fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as Formulario;
    preencher(pagina);
    pagina.mudar('modo', 'MANUAL');
    pagina.mudarLinha(0, 'amount', '500.00');

    expect(pagina.problemas()).toContain(
      'A soma das parcelas precisa ser igual ao valor líquido (RF-053).',
    );
    pagina.salvar();
    mock.verify();

    pagina.adicionarLinha();
    pagina.mudarLinha(1, 'amount', '500.00');
    expect(pagina.problemas()).toEqual([]);
    pagina.salvar();

    const criacao = mock.expectOne(`${BASE}/financial-entries`);
    expect(criacao.request.method).toBe('POST');
    // Isolamento por empresa: a requisição sai com a empresa ativa (RLS).
    expect(criacao.request.headers.get('x-company-id')).toBe(companyId);
    expect(criacao.request.body.grossAmount).toBe('1000.00');
    expect(criacao.request.body.installments.map((p: { amount: string }) => p.amount)).toEqual([
      '500.00',
      '500.00',
    ]);
    expect(criacao.request.body.installmentCount).toBeUndefined();
  });

  it('manda só a regra do parcelamento simples — as parcelas são do servidor', async () => {
    const { mock } = prepararSessao(['financial-entries:CREATE'], [rota(null)]);
    const fixture = TestBed.createComponent(EntryFormPage);
    fixture.detectChanges();
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as Formulario;
    preencher(pagina);
    pagina.mudar('modo', 'SIMPLES');
    pagina.mudar('installmentCount', '3');

    expect(pagina.previa().map((p) => p.valor)).toEqual(['333.33', '333.33', '333.34']);
    pagina.salvar();

    const corpo = mock.expectOne(`${BASE}/financial-entries`).request.body;
    expect(corpo.installmentCount).toBe(3);
    expect(corpo.intervalDays).toBe(30);
    expect(corpo.installments).toBeUndefined();
    expect(typeof corpo.grossAmount).toBe('string');
  });
});

describe('EntryDetailPage (UI-026)', () => {
  type Detalhe = {
    abrirBaixa: (p: unknown) => void;
    mudarBaixa: (campo: string, valor: unknown) => void;
    registrarBaixa: () => void;
    problemaBaixa: () => string | null;
    abrirEstorno: (p: unknown, b: unknown) => void;
    estornar: () => void;
    motivo: { set: (v: string) => void };
    proprioLancamento: () => boolean;
    baixaLiberada: () => boolean;
  };

  it('recusa principal acima do saldo e deixa os encargos do atraso para o servidor', async () => {
    const { mock } = prepararSessao(
      ['financial-entries:READ', 'settlements:CREATE'],
      [rota('tit-1')],
    );
    const fixture = TestBed.createComponent(EntryDetailPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/financial-entries/tit-1`).flush(titulo());
    await fixture.whenStable();
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as Detalhe;
    pagina.abrirBaixa(parcela());
    pagina.mudarBaixa('principalAmount', '500.00');
    expect(pagina.problemaBaixa()).toBe('O principal não pode superar o saldo da parcela.');
    pagina.registrarBaixa();
    mock.verify();

    pagina.mudarBaixa('principalAmount', '400.00');
    pagina.registrarBaixa();

    const baixa = mock.expectOne(`${BASE}/financial-entries/tit-1/installments/parc-1/settlements`);
    expect(baixa.request.body.principalAmount).toBe('400.00');
    expect(baixa.request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    // Parcela vencida: a tela pede o cálculo ao servidor, não inventa juros.
    expect(baixa.request.body.applyLateCharges).toBe(true);
    expect(baixa.request.body.interestAmount).toBeUndefined();
    baixa.flush({ id: 'bx-1' });

    // Saldo e situação voltam do servidor, não de conta local.
    mock.expectOne(`${BASE}/financial-entries/tit-1`).flush(titulo({ status: 'LIQUIDADO' }));
  });

  it('reusa a mesma chave de idempotência no retry da mesma baixa (RN-004)', async () => {
    const { mock } = prepararSessao(
      ['financial-entries:READ', 'settlements:CREATE'],
      [rota('tit-1')],
    );
    const fixture = TestBed.createComponent(EntryDetailPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/financial-entries/tit-1`).flush(titulo());
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as Detalhe;
    const url = `${BASE}/financial-entries/tit-1/installments/parc-1/settlements`;

    pagina.abrirBaixa(parcela());
    pagina.registrarBaixa();
    const primeira = mock.expectOne(url);
    const chave = primeira.request.headers.get('Idempotency-Key');
    expect(chave).toBeTruthy();
    // Queda de rede: o servidor pode ou não ter gravado — só a chave resolve.
    primeira.error(new ProgressEvent('error'));

    pagina.registrarBaixa();
    const segunda = mock.expectOne(url);
    expect(segunda.request.headers.get('Idempotency-Key')).toBe(chave);
    segunda.flush({ id: 'bx-1' });
    mock.expectOne(`${BASE}/financial-entries/tit-1`).flush(titulo());

    // Outra baixa, outra chave.
    pagina.abrirBaixa(parcela());
    pagina.registrarBaixa();
    expect(mock.expectOne(url).request.headers.get('Idempotency-Key')).not.toBe(chave);
  });

  it('exige motivo para estornar a baixa', async () => {
    const baixa = {
      id: 'bx-1',
      installmentId: 'parc-1',
      settlementDate: '2020-02-01',
      principalAmount: '400.00',
      interestAmount: '0',
      penaltyAmount: '0',
      discountAmount: '0',
      totalAmount: '400.00',
      paymentMethodId: null,
      paymentMethod: null,
      method: 'PIX',
      isReversed: false,
      reversalOfId: null,
      reversedAt: null,
      reversalReason: null,
      note: null,
      createdAt: '2020-02-01T10:00:00.000Z',
    };
    const { mock } = prepararSessao(
      ['financial-entries:READ', 'settlements:DELETE'],
      [rota('tit-1')],
    );
    const fixture = TestBed.createComponent(EntryDetailPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/financial-entries/tit-1`).flush(titulo());
    await fixture.whenStable();

    const pagina = fixture.componentInstance as unknown as Detalhe;
    pagina.abrirEstorno(parcela(), baixa);
    pagina.estornar();
    mock.verify();

    pagina.motivo.set('Pagamento em duplicidade');
    pagina.estornar();
    const estorno = mock.expectOne(
      `${BASE}/financial-entries/tit-1/installments/parc-1/settlements/bx-1/reverse`,
    );
    expect(estorno.request.body).toEqual({ reason: 'Pagamento em duplicidade' });
  });

  it('não oferece aprovação a quem lançou nem baixa enquanto pendente', async () => {
    const { mock } = prepararSessao(
      ['financial-entries:READ', 'financial-entries:APPROVE', 'settlements:CREATE'],
      [rota('tit-1')],
    );
    const fixture = TestBed.createComponent(EntryDetailPage);
    fixture.detectChanges();
    mock
      .expectOne(`${BASE}/financial-entries/tit-1`)
      .flush(titulo({ approvalStatus: 'PENDENTE', createdById: USUARIO_ID }));
    await fixture.whenStable();
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as Detalhe;
    expect(pagina.proprioLancamento()).toBe(true);
    expect(pagina.baixaLiberada()).toBe(false);

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Aguardando aprovação');
    expect(texto).not.toContain('Pagar');
  });
});

describe('ApprovalsPage (UI-027)', () => {
  it('lista só os pendentes e exige motivo para reprovar', async () => {
    const { mock } = prepararSessao(['financial-entries:READ', 'financial-entries:APPROVE']);
    const fixture = TestBed.createComponent(ApprovalsPage);
    fixture.detectChanges();

    const lista = mock.expectOne((r) => r.url === `${BASE}/financial-entries`);
    expect(lista.request.params.get('approvalStatus')).toBe('PENDENTE');
    lista.flush(paginado([titulo({ approvalStatus: 'PENDENTE' })]));
    // Sem `approval-thresholds:READ`, a faixa não é pedida.
    mock.verify();
    await fixture.whenStable();
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as {
      abrir: (tipo: string, t: unknown) => void;
      podeDecidir: () => boolean;
      motivo: { set: (v: string) => void };
      decidir: () => void;
    };
    pagina.abrir('reprovar', titulo({ approvalStatus: 'PENDENTE' }));
    expect(pagina.podeDecidir()).toBe(false);
    pagina.decidir();
    mock.verify();

    pagina.motivo.set('Sem contrato assinado');
    pagina.decidir();
    const reprovacao = mock.expectOne(`${BASE}/financial-entries/tit-1/reject`);
    expect(reprovacao.request.body).toEqual({ reason: 'Sem contrato assinado' });
  });
});

describe('DelinquencyPage (UI-028)', () => {
  it('mostra o aging e não pede parcelas sem permissão de títulos', async () => {
    const { mock } = prepararSessao(['delinquency:READ']);
    const fixture = TestBed.createComponent(DelinquencyPage);
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/delinquency`)
      .flush({
        aging: [
          { bucket: 'ATE_30', installments: 1, balance: '500.00', updatedBalance: '510.00' },
          { bucket: 'DE_31_A_60', installments: 0, balance: '0', updatedBalance: '0' },
          { bucket: 'DE_61_A_90', installments: 0, balance: '0', updatedBalance: '0' },
          { bucket: 'ACIMA_DE_90', installments: 2, balance: '1000.00', updatedBalance: '1500.00' },
        ],
        totals: { installments: 3, balance: '1500.00', updatedBalance: '2010.00' },
        partners: [
          {
            partner: { id: 'par-1', legalName: 'Construtora Horizonte' },
            installments: 3,
            balance: '1500.00',
            updatedBalance: '2010.00',
            maxDaysOverdue: 120,
          },
        ],
      });
    mock.verify();
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Acima de 90 dias');
    expect(texto).toContain('R$ 1.500,00');
    expect(texto).toContain('R$ 2.010,00');
    expect(texto).toContain('Construtora Horizonte');
  });
});

describe('CashFlowPage (UI-029)', () => {
  const projecao = {
    period: { from: '2026-09-10', to: '2026-12-09' },
    granularity: 'MES',
    scenario: null,
    openingBalance: '100.00',
    closingBalance: '-250.00',
    periods: [
      {
        periodStart: '2026-09-01',
        inflow: { realized: '0', expected: '50.00', overdue: '0', total: '50.00' },
        outflow: { realized: '0', expected: '400.00', overdue: '0', total: '400.00' },
        net: '-350.00',
        closingBalance: '-250.00',
      },
    ],
  };
  const resumo = {
    period: { from: '2026-09-10', to: '2026-12-09' },
    bySituation: [
      { situation: 'REALIZADO', inflow: '0', outflow: '0', net: '0', movements: 0 },
      { situation: 'VENCIDO', inflow: '0', outflow: '0', net: '0', movements: 0 },
      { situation: 'PREVISTO', inflow: '50.00', outflow: '400.00', net: '-350.00', movements: 2 },
    ],
    totals: { inflow: '50.00', outflow: '400.00', net: '-350.00' },
    byCategory: [],
  };

  it('mostra previsto/realizado/vencido e o saldo acumulado negativo', async () => {
    const { mock } = prepararSessao(['cash-flow:READ'], [rota(null)]);
    const fixture = TestBed.createComponent(CashFlowPage);
    fixture.detectChanges();

    const consolidado = mock.expectOne((r) => r.url === `${BASE}/cash-flow/summary`);
    expect(consolidado.request.params.get('from')).not.toBeNull();
    consolidado.flush(resumo);
    const serie = mock.expectOne((r) => r.url === `${BASE}/cash-flow/projection`);
    expect(serie.request.params.get('granularity')).toBe('MES');
    serie.flush(projecao);
    mock.expectOne(`${BASE}/cash-flow/balance`).flush({ balance: '100.00' });
    // Sem `cash-alerts:READ` a avaliação não é pedida.
    mock.verify();
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Previsto');
    expect(texto).toContain('Vencido');
    expect(texto).toContain('R$ -250,00');
  });

  it('projeta sob o cenário da URL usando a janela dele', async () => {
    const { mock } = prepararSessao(['cash-flow:READ'], [rota(null, { cenario: 'cen-1' })]);
    const fixture = TestBed.createComponent(CashFlowPage);
    fixture.detectChanges();

    mock.expectOne((r) => r.url === `${BASE}/cash-flow/summary`).flush(resumo);
    const serie = mock.expectOne((r) => r.url === `${BASE}/cash-flow/projection`);
    expect(serie.request.params.get('scenarioId')).toBe('cen-1');
    expect(serie.request.params.get('from')).toBeNull();
    serie.flush(projecao);
    mock.expectOne(`${BASE}/cash-flow/balance`).flush({ balance: '100.00' });
  });
});
