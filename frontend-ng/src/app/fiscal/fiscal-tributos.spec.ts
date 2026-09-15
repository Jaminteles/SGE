import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type {
  DocumentTaxSummary,
  FiscalAssessmentReport,
  FiscalEvent,
  TaxClassification,
  TaxParameter,
  TaxRule,
} from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { FiscalEventsPanel } from './fiscal-events-panel';
import { FiscalMonitorPage } from './fiscal-monitor-page';
import { FiscalReportsPage } from './fiscal-reports-page';
import { FiscalTaxesPanel } from './fiscal-taxes-panel';
import { TaxClassificationsPage } from './tax-classifications-page';
import { TaxParametersPage } from './tax-parameters-page';
import { TaxRulesPage } from './tax-rules-page';
import {
  formClassificacaoVazia,
  formParametroVazio,
  formRegraVazia,
  formatarPercentual,
  lerPercentual,
  montarClassificacao,
  montarEdicaoClassificacao,
  montarEdicaoParametro,
  montarParametro,
  montarRegra,
  problemaClassificacao,
  problemaEvento,
  problemaParametro,
  problemaRecorteFiscal,
  problemaRegra,
  resumoCriterios,
  transmissivel,
  vigente,
} from './tributos';

const BASE = '/api/v1';
const VAZIO = { data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

function prepararSessao(permissoes: string[]): {
  mock: HttpTestingController;
  companyId: string;
} {
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

  return { mock: TestBed.inject(HttpTestingController), companyId: membership.companyId };
}

function parametro(sobrescrever: Partial<TaxParameter> = {}): TaxParameter {
  return {
    id: 'par-1',
    branchId: null,
    taxRegime: 'SIMPLES_NACIONAL',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    simplesRate: '6.000000',
    issRate: null,
    ipiTaxpayer: false,
    taxSubstitute: false,
    additionalParameters: null,
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    ...sobrescrever,
  };
}

function classificacao(sobrescrever: Partial<TaxClassification> = {}): TaxClassification {
  return {
    id: 'cls-1',
    type: 'NCM',
    code: '84713012',
    description: 'Computadores portáteis',
    icmsRate: '18.000000',
    ipiRate: null,
    pisRate: null,
    cofinsRate: null,
    isActive: true,
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    ...sobrescrever,
  };
}

function regra(sobrescrever: Partial<TaxRule> = {}): TaxRule {
  return {
    id: 'reg-1',
    name: 'Compra interestadual SP→MG',
    priority: 100,
    originState: 'SP',
    destinationState: 'MG',
    operationType: 'COMPRA',
    classificationId: null,
    productId: null,
    productCategoryId: null,
    cfop: '2102',
    icmsCst: '000',
    icmsRate: '12.000000',
    icmsBaseReduction: null,
    conditions: null,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isActive: true,
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    ...sobrescrever,
  };
}

function evento(sobrescrever: Partial<FiscalEvent> = {}): FiscalEvent {
  return {
    id: 'evt-1',
    documentId: 'doc-1',
    type: 'CANCELAMENTO',
    protocol: null,
    sequence: 1,
    occurredAt: '2026-02-10T12:00:00.000Z',
    justification: 'Nota emitida em duplicidade para o mesmo pedido',
    status: 'REGISTRADO',
    response: null,
    createdAt: '2026-02-10T12:00:00.000Z',
    ...sobrescrever,
  };
}

function tributacao(sobrescrever: Partial<DocumentTaxSummary> = {}): DocumentTaxSummary {
  return {
    documentId: 'doc-1',
    number: '123',
    series: '1',
    accessKey: null,
    issuedAt: '2026-02-01T12:00:00.000Z',
    status: 'PROCESSADO',
    declared: {
      productsAmount: '1000.00',
      totalAmount: '1180.00',
      icmsAmount: '180.00',
      icmsStAmount: '0.00',
      ipiAmount: '0.00',
      pisAmount: '0.00',
      cofinsAmount: '0.00',
      issAmount: '0.00',
    },
    itemTotals: {
      lineAmount: '1000.00',
      icmsAmount: '180.00',
      icmsStAmount: '0.00',
      ipiAmount: '0.00',
      pisAmount: '0.00',
      cofinsAmount: '0.00',
    },
    items: [
      {
        id: 'item-1',
        sequence: 1,
        description: 'Notebook',
        ncm: '84713012',
        cest: null,
        cfop: '2102',
        quantity: '1.000000',
        unitPrice: '1000.00',
        lineAmount: '1000.00',
        icmsCst: '000',
        icmsBase: '1000.00',
        icmsRate: '18.000000',
        icmsAmount: '180.00',
        icmsStAmount: '0.00',
        ipiAmount: '0.00',
        pisAmount: '0.00',
        cofinsAmount: '0.00',
        classificationId: null,
        classification: null,
      },
    ],
    divergences: [
      {
        sequence: 1,
        field: 'icmsRate',
        declared: '18.000000',
        expected: '12.000000',
        note: 'Alíquota declarada difere da esperada para o NCM',
      },
    ],
    unclassifiedItems: 1,
    ...sobrescrever,
  };
}

// ---------------------------------------------------------------------------

describe('tributação — regras espelhadas do backend (UI-061/UI-062)', () => {
  it('lê o percentual em pt-BR e recusa o que não cabe em numeric(9,6)', () => {
    expect(lerPercentual('18,5')).toEqual({ valor: '18.5', erro: null });
    expect(lerPercentual('  ')).toEqual({ valor: null, erro: null });
    expect(lerPercentual('101').erro).toBeTruthy();
    expect(lerPercentual('18.1234567').erro).toBeTruthy();
    expect(formatarPercentual('18.500000')).toBe('18,5%');
    expect(formatarPercentual(null)).toBe('—');
  });

  it('recusa alíquota do Simples fora do Simples e vigência invertida (RF-088)', () => {
    const base = { ...formParametroVazio('2026-01-01'), simplesRate: '6' };
    expect(problemaParametro(base)).toBeNull();
    expect(problemaParametro({ ...base, taxRegime: 'LUCRO_REAL' })).toContain('Simples Nacional');
    expect(problemaParametro({ ...base, effectiveTo: '2025-12-31' })).toContain('anterior');
    expect(montarParametro(base)).toMatchObject({
      taxRegime: 'SIMPLES_NACIONAL',
      effectiveFrom: '2026-01-01',
      simplesRate: '6',
    });
  });

  it('a edição do parâmetro manda só o que mudou, e nunca a filial', () => {
    const atual = parametro();
    const form = {
      ...formParametroVazio('2026-01-01'),
      branchId: 'outra-filial',
      simplesRate: '6.000000',
      issRate: '2',
    };
    expect(montarEdicaoParametro(form, atual)).toEqual({ issRate: '2' });
    expect(vigente(atual, '2026-06-01')).toBe(true);
    expect(vigente(parametro({ effectiveTo: '2026-03-31' }), '2026-06-01')).toBe(false);
  });

  it('confere o formato do código por tipo de classificação (RF-089)', () => {
    const base = { ...formClassificacaoVazia(), code: '84713012', description: 'Notebook' };
    expect(problemaClassificacao(base)).toBeNull();
    expect(problemaClassificacao({ ...base, code: '8471' })).toContain('Código inválido');
    expect(problemaClassificacao({ ...base, type: 'CFOP', code: '9102' })).toContain('inválido');
    expect(problemaClassificacao({ ...base, icmsRate: '200' })).toContain('ICMS');
    expect(montarClassificacao(base)).toEqual({
      type: 'NCM',
      code: '84713012',
      description: 'Notebook',
    });
    // Tipo e código não entram na alteração: são a identidade da linha. Alíquota
    // apagada vai como `null` explícito — é assim que a API a remove.
    expect(
      montarEdicaoClassificacao(
        { ...base, type: 'CEST', code: '9999999', description: 'Outro' },
        classificacao(),
      ),
    ).toEqual({ description: 'Outro', icmsRate: null });
  });

  it('recusa regra sem critério — ela decidiria toda operação da empresa (RF-091)', () => {
    const vazia = { ...formRegraVazia('2026-01-01'), name: 'Geral' };
    expect(problemaRegra(vazia)).toContain('critério');

    const comCriterio = { ...vazia, operationType: 'COMPRA' as const, originState: 'sp' };
    expect(problemaRegra(comCriterio)).toBeNull();
    expect(montarRegra(comCriterio)).toMatchObject({ operationType: 'COMPRA', originState: 'SP' });

    expect(problemaRegra({ ...comCriterio, priority: '0' })).toContain('prioridade');
    expect(problemaRegra({ ...comCriterio, originState: 'SPP' })).toContain('UF');
    expect(problemaRegra({ ...comCriterio, cfop: '9102' })).toContain('CFOP');
    expect(resumoCriterios(regra())).toBe('Compra · SP → MG');
    expect(resumoCriterios(regra({ operationType: null, originState: null, destinationState: null }))).toBe(
      'Todas as operações',
    );
  });

  it('cancelamento e carta de correção exigem justificativa; resposta do fisco é terminal', () => {
    expect(problemaEvento({ type: 'CANCELAMENTO', justification: 'curta' }, true)).toContain(
      'justificativa',
    );
    expect(
      problemaEvento({ type: 'CANCELAMENTO', justification: 'Emitida em duplicidade' }, true),
    ).toBeNull();
    expect(problemaEvento({ type: 'MANIFESTACAO', justification: '' }, false)).toContain(
      'inutilização',
    );
    expect(transmissivel('REGISTRADO')).toBe(true);
    expect(transmissivel('TRANSMITIDO')).toBe(true);
    expect(transmissivel('AUTORIZADO')).toBe(false);
    expect(transmissivel('REJEITADO')).toBe(false);
  });

  it('o relatório fiscal exige período, e o fim não antecede o início (RF-093)', () => {
    expect(problemaRecorteFiscal('', '2026-01-31')).toContain('período');
    expect(problemaRecorteFiscal('2026-02-01', '2026-01-31')).toContain('anterior');
    expect(problemaRecorteFiscal('2026-01-01', '2026-01-31')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('parâmetros fiscais (UI-061)', () => {
  it('carrega os parâmetros da empresa ativa e esconde as ações sem permissão', () => {
    const { mock, companyId } = prepararSessao(['tax-parameters:READ']);
    const fixture = TestBed.createComponent(TaxParametersPage);
    fixture.detectChanges();

    const requisicao = mock.expectOne((r) => r.url === `${BASE}/fiscal/parameters`);
    expect(requisicao.request.headers.get('x-company-id')).toBe(companyId);
    requisicao.flush({ ...VAZIO, data: [parametro()], total: 1 });
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Simples Nacional');
    expect(texto).toContain('Toda a empresa');
    expect(texto).not.toContain('Novo parâmetro');
    expect(texto).not.toContain('Encerrar');
    mock.verify();
  });

  it('avisa quando nenhum parâmetro está vigente hoje', () => {
    const { mock } = prepararSessao(['tax-parameters:READ']);
    const fixture = TestBed.createComponent(TaxParametersPage);
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/fiscal/parameters`)
      .flush({ ...VAZIO, data: [parametro({ effectiveTo: '2020-12-31' })], total: 1 });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Nenhum parâmetro vigente hoje');
    mock.verify();
  });
});

describe('classificações fiscais (UI-061)', () => {
  it('lista e oferece inativação a quem tem a permissão', () => {
    const { mock } = prepararSessao(['tax-classifications:READ', 'tax-classifications:DELETE']);
    const fixture = TestBed.createComponent(TaxClassificationsPage);
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/fiscal/classifications`)
      .flush({ ...VAZIO, data: [classificacao()], total: 1 });
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('84713012');
    expect(texto).toContain('Inativar');
    expect(texto).not.toContain('Nova classificação');
    mock.verify();
  });
});

describe('regras fiscais (UI-062)', () => {
  it('simula a resolução sem gravar nada e mostra a regra que decide', () => {
    const { mock } = prepararSessao(['tax-rules:READ']);
    const fixture = TestBed.createComponent(TaxRulesPage);
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/fiscal/rules`)
      .flush({ ...VAZIO, data: [regra()], total: 1 });
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as {
      abrirSimulacao(): void;
      mudarSimulacao(campo: string, valor: string): void;
      simular(): void;
    };
    pagina.abrirSimulacao();
    pagina.mudarSimulacao('operationType', 'COMPRA');
    pagina.simular();

    const simulacao = mock.expectOne((r) => r.url === `${BASE}/fiscal/rules/resolve`);
    expect(simulacao.request.method).toBe('GET');
    expect(simulacao.request.params.get('operationType')).toBe('COMPRA');
    simulacao.flush({ matched: regra(), alternatives: [] });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Decide: Compra interestadual');
    mock.verify();
  });
});

describe('tributação do documento (UI-063)', () => {
  it('mostra a divergência sem oferecer correção do que a nota declarou', () => {
    const { mock } = prepararSessao(['document-taxes:READ']);
    const fixture = TestBed.createComponent(FiscalTaxesPanel);
    fixture.componentRef.setInput('documentoId', 'doc-1');
    fixture.detectChanges();

    mock.expectOne(`${BASE}/fiscal/documents/doc-1/taxes`).flush(tributacao());
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('1 divergência(s)');
    expect(texto).toContain('1 item(ns) sem classificação fiscal');
    // Sem `document-taxes:UPDATE` não há coluna de classificação.
    expect(texto).not.toContain('Classificar pelo NCM');
    mock.verify();
  });

  it('classifica a linha pelo NCM cadastrado quando há permissão', () => {
    const { mock } = prepararSessao([
      'document-taxes:READ',
      'document-taxes:UPDATE',
      'tax-classifications:READ',
    ]);
    const fixture = TestBed.createComponent(FiscalTaxesPanel);
    fixture.componentRef.setInput('documentoId', 'doc-1');
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/fiscal/classifications`)
      .flush({ ...VAZIO, data: [classificacao()], total: 1 });
    mock.expectOne(`${BASE}/fiscal/documents/doc-1/taxes`).flush(tributacao());
    fixture.detectChanges();

    const painel = fixture.componentInstance as unknown as {
      escolher(sequence: number, id: string | null): void;
      salvar(item: { sequence: number; classificationId: string | null }): void;
    };
    painel.escolher(1, 'cls-1');
    painel.salvar({ sequence: 1, classificationId: null });

    const requisicao = mock.expectOne(`${BASE}/fiscal/documents/doc-1/taxes/classify`);
    expect(requisicao.request.method).toBe('PATCH');
    expect(requisicao.request.body).toEqual({ sequence: 1, classificationId: 'cls-1' });
    requisicao.flush(tributacao({ unclassifiedItems: 0, divergences: [] }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Item 1 classificado');
    mock.verify();
  });
});

describe('eventos fiscais do documento (UI-063)', () => {
  it('não oferece transmissão ao que o fisco já respondeu', () => {
    const { mock } = prepararSessao(['fiscal-events:READ', 'fiscal-events:APPROVE']);
    const fixture = TestBed.createComponent(FiscalEventsPanel);
    fixture.componentRef.setInput('documentoId', 'doc-1');
    fixture.detectChanges();

    mock.expectOne((r) => r.url === `${BASE}/fiscal/events`).flush({
      ...VAZIO,
      data: [evento({ id: 'evt-2', status: 'AUTORIZADO', protocol: '135260000123456' })],
      total: 1,
    });
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Autorizado');
    expect(texto).toContain('135260000123456');
    expect(texto).not.toContain('Transmitir');
    mock.verify();
  });

  it('transmite o que ainda não teve resposta', () => {
    const { mock } = prepararSessao(['fiscal-events:READ', 'fiscal-events:APPROVE']);
    const fixture = TestBed.createComponent(FiscalEventsPanel);
    fixture.componentRef.setInput('documentoId', 'doc-1');
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/fiscal/events`)
      .flush({ ...VAZIO, data: [evento()], total: 1 });
    fixture.detectChanges();

    (fixture.componentInstance as unknown as { transmitir(e: FiscalEvent): void }).transmitir(
      evento(),
    );

    const transmissao = mock.expectOne(`${BASE}/fiscal/events/evt-1/transmit`);
    expect(transmissao.request.method).toBe('POST');
    transmissao.flush(evento({ status: 'TRANSMITIDO' }));

    mock
      .expectOne((r) => r.url === `${BASE}/fiscal/events`)
      .flush({ ...VAZIO, data: [evento({ status: 'TRANSMITIDO' })], total: 1 });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Transmissão enfileirada');
    mock.verify();
  });
});

describe('relatórios fiscais (UI-064)', () => {
  it('consulta a apuração do mês corrente e separa os totais por sentido', () => {
    const { mock, companyId } = prepararSessao(['fiscal-reports:READ']);
    const fixture = TestBed.createComponent(FiscalReportsPage);
    fixture.detectChanges();

    const requisicao = mock.expectOne((r) => r.url === `${BASE}/fiscal/reports/assessment`);
    expect(requisicao.request.headers.get('x-company-id')).toBe(companyId);
    expect(requisicao.request.params.get('from')).toBeTruthy();
    expect(requisicao.request.params.get('to')).toBeTruthy();

    const resposta: FiscalAssessmentReport = {
      period: { from: '2026-02-01', to: '2026-02-28' },
      rows: [
        {
          competence: '2026-02-01',
          direction: 'ENTRADA',
          model: 'NFE',
          documents: 2,
          totalAmount: '2000.00',
          productsAmount: '1800.00',
          icmsAmount: '360.00',
          icmsStAmount: '0.00',
          ipiAmount: '0.00',
          pisAmount: '0.00',
          cofinsAmount: '0.00',
          issAmount: '0.00',
        },
      ],
      totals: {
        ENTRADA: {
          documents: 2,
          totalAmount: '2000.00',
          icmsAmount: '360.00',
          icmsStAmount: '0.00',
          ipiAmount: '0.00',
          pisAmount: '0.00',
          cofinsAmount: '0.00',
          issAmount: '0.00',
        },
        SAIDA: {
          documents: 0,
          totalAmount: '0.00',
          icmsAmount: '0.00',
          icmsStAmount: '0.00',
          ipiAmount: '0.00',
          pisAmount: '0.00',
          cofinsAmount: '0.00',
          issAmount: '0.00',
        },
        INDEFINIDO: {
          documents: 0,
          totalAmount: '0.00',
          icmsAmount: '0.00',
          icmsStAmount: '0.00',
          ipiAmount: '0.00',
          pisAmount: '0.00',
          cofinsAmount: '0.00',
          issAmount: '0.00',
        },
      },
    };
    requisicao.flush(resposta);
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Entrada — ICMS');
    // Sentido sem documento não vira cartão: zero não é apuração de nada.
    expect(texto).not.toContain('Saída — ICMS');
    mock.verify();
  });
});

describe('transmissões fiscais (UI-064)', () => {
  it('conta o que ainda não teve resposta e dispensa o painel de fila sem permissão', () => {
    const { mock } = prepararSessao(['fiscal-events:READ']);
    const fixture = TestBed.createComponent(FiscalMonitorPage);
    fixture.detectChanges();

    mock.expectOne((r) => r.url === `${BASE}/fiscal/events`).flush({
      ...VAZIO,
      data: [evento(), evento({ id: 'evt-3', status: 'AUTORIZADO', protocol: '999' })],
      total: 2,
    });
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('1 evento(s) sem resposta do fisco');
    expect(texto).not.toContain('Fila de trabalho');
    // Sem `fiscal-events:APPROVE` a lista é só leitura.
    expect(texto).not.toContain('Transmitir');
    mock.verify();
  });
});
