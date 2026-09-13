import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type {
  BankStatementImport,
  MatchCandidate,
  PendingBankTransaction,
  ReconciliationDivergences,
  ReconciliationListItem,
  ReconciliationRule,
  ReconciliationSuggestions,
} from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { DivergencesPage, consultaDivergencias } from './divergences-page';
import { HistoryPage } from './history-page';
import { MatchingPage } from './matching-page';
import { PendingPage } from './pending-page';
import {
  consultaHistorico,
  consultaPendentes,
  formRegraVazio,
  montarRegra,
  problemaExecucao,
  problemaMotivo,
  problemaRegra,
  problemaVinculo,
  restanteMovimento,
  resumoIdentificacao,
  rotuloScore,
  severidadeScore,
  valorProposto,
} from './rotulos';
import { RulesPage, consultaRegra } from './rules-page';

const BASE = '/api/v1';
const MOV = '22222222-2222-4222-8222-222222222222';

function paginado<T>(data: T[], total = data.length) {
  return { data, total, page: 1, pageSize: 20, totalPages: 1 };
}

function erroHttp(status: number, message: string) {
  return [{ statusCode: status, message }, { status, statusText: 'Erro' }] as const;
}

function prepararSessao(
  permissoes: string[],
  extras: Provider[] = [],
): { mock: HttpTestingController; companyId: string } {
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

function pendente(sobrescrever: Partial<PendingBankTransaction> = {}): PendingBankTransaction {
  return {
    id: MOV,
    bankAccountId: 'cta-1',
    movementDate: '2026-09-10',
    direction: 'CREDITO',
    amount: '1500.00',
    description: 'PIX RECEBIDO CLIENTE ALFA',
    document: null,
    counterpartName: 'ALFA LTDA',
    reconciliationStatus: 'NAO_CONCILIADO',
    metadata: null,
    ...sobrescrever,
  };
}

function candidata(sobrescrever: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    installmentId: 'par-1',
    entryId: 'tit-1',
    entryNumber: 'REC-0042',
    entryType: 'RECEBER',
    partnerId: 'prc-1',
    partnerName: 'Alfa',
    description: 'Venda 42',
    installmentNumber: 1,
    totalInstallments: 2,
    dueDate: '2026-09-10',
    balance: '1450.00',
    dayGap: 0,
    difference: '50.00',
    score: '72.5',
    reasons: ['pago na data do vencimento', 'contraparte identificada é o parceiro do título'],
    ...sobrescrever,
  };
}

function sugestoes(sobrescrever: Partial<ReconciliationSuggestions> = {}): ReconciliationSuggestions {
  return {
    bankTransactionId: MOV,
    movementDate: '2026-09-10',
    direction: 'CREDITO',
    amount: '1500.00',
    reconciliationStatus: 'NAO_CONCILIADO',
    identification: { kind: 'PIX', counterpartName: 'ALFA LTDA', partnerName: 'Alfa', partnerId: 'prc-1' },
    candidates: [candidata()],
    ...sobrescrever,
  };
}

function vinculo(sobrescrever: Partial<ReconciliationListItem> = {}): ReconciliationListItem {
  return {
    id: 'con-1',
    bankTransactionId: MOV,
    installmentId: 'par-1',
    settlementId: null,
    paymentTransactionId: null,
    ruleId: null,
    origin: 'MANUAL',
    score: null,
    reconciledAmount: '1000.00',
    difference: '0.00',
    hasDivergence: false,
    justification: null,
    confirmed: true,
    confirmedById: 'usr-1',
    confirmedAt: '2026-09-11T10:00:00.000Z',
    undoneAt: null,
    undoneById: null,
    undoReason: null,
    createdAt: '2026-09-11T10:00:00.000Z',
    bankTransaction: {
      bankAccountId: 'cta-1',
      movementDate: '2026-09-10',
      direction: 'CREDITO',
      amount: '1500.00',
      description: 'PIX RECEBIDO CLIENTE ALFA',
      reconciliationStatus: 'DIVERGENTE',
    },
    ...sobrescrever,
  };
}

function regra(sobrescrever: Partial<ReconciliationRule> = {}): ReconciliationRule {
  return {
    id: 'reg-1',
    name: 'Tarifas',
    priority: 10,
    conditions: { direction: 'DEBITO', descriptionContains: 'TARIFA' },
    actions: { markIgnored: true },
    valueTolerance: '0.00',
    dayTolerance: 3,
    isActive: true,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...sobrescrever,
  };
}

// ---------------------------------------------------------------------------

describe('regras da conciliação espelhadas do backend', () => {
  it('confere o vínculo como `ReconciliationsService.create` (RF-074/RF-076)', () => {
    const base = { valor: '1450.00', restante: '1500.00', esperado: '1450.00', justificativa: '' };
    expect(problemaVinculo(base)).toBeNull();
    expect(problemaVinculo({ ...base, valor: '0.00' })).toBe('O valor conciliado precisa ser maior que zero.');
    expect(problemaVinculo({ ...base, valor: null })).toBe('O valor conciliado precisa ser maior que zero.');
    expect(problemaVinculo({ ...base, valor: '1500.01' })).toContain('R$ 1.500,00 a conciliar');
    expect(problemaVinculo({ ...base, valor: '1500.00' })).toContain('difere do lançamento em R$ 50,00');
    expect(problemaVinculo({ ...base, valor: '1500.00', justificativa: 'Juros pagos pelo cliente' })).toBeNull();
    expect(problemaMotivo('ok')).toContain('mínimo de 3');
    expect(problemaMotivo('Lançado na parcela errada')).toBeNull();
  });

  it('calcula restante em centavos, só com vínculos vivos', () => {
    const vivos = [
      { reconciledAmount: '0.10', undoneAt: null },
      { reconciledAmount: '0.20', undoneAt: null },
      { reconciledAmount: '999.00', undoneAt: '2026-09-11T00:00:00Z' },
    ];
    // 0.1 + 0.2 em ponto flutuante não fecha; em centavos fecha.
    expect(restanteMovimento('1.00', vivos)).toBe('0.70');
    expect(valorProposto('1500.00', '1450.00')).toBe('1450.00');
    expect(valorProposto('100.00', '1450.00')).toBe('100.00');
  });

  it('mostra o score como porcentagem e colore pela confiança', () => {
    expect(rotuloScore('95')).toBe('95%');
    expect(rotuloScore('72.50')).toBe('72,5%');
    expect(rotuloScore(null)).toBe('—');
    expect(severidadeScore('95.00')).toBe('success');
    expect(severidadeScore('72.5')).toBe('info');
    expect(severidadeScore('40')).toBe('warn');
  });

  it('recusa regra sem condição e conciliação sem confiança mínima (RF-075)', () => {
    const vazia = { ...formRegraVazio(), name: 'Regra' };
    expect(problemaRegra(vazia)).toContain('ao menos uma condição');

    const conciliar = { ...vazia, descriptionContains: 'PIX', acao: 'CONCILIAR' as const };
    expect(problemaRegra(conciliar)).toBe('Conciliar sem revisão exige a confiança mínima.');
    expect(problemaRegra({ ...conciliar, minScore: '100.01' })).toBe('A confiança mínima vai de 0 a 100.');
    expect(problemaRegra({ ...vazia, minAmount: '10.00', maxAmount: '5.00' })).toContain('mínimo não pode');
    expect(problemaRegra({ ...vazia, counterpartDocument: '123' })).toContain('CPF');
    expect(problemaRegra({ ...vazia, priority: '0', direction: 'DEBITO' })).toContain('prioridade');

    const corpo = montarRegra({
      ...conciliar,
      minScore: '90.00',
      counterpartDocument: '12.345.678/0001-90',
      priority: '5',
    });
    expect(corpo).toEqual({
      name: 'Regra',
      priority: 5,
      conditions: { descriptionContains: 'PIX', counterpartDocument: '12345678000190' },
      actions: { autoReconcile: true, minScore: '90.00' },
      valueTolerance: '0.00',
      dayTolerance: 3,
      isActive: true,
    });
  });

  it('traduz os filtros sem mandar parâmetro vazio', () => {
    expect(consultaPendentes({ q: '', status: 'IGNORADO', from: '2026-09-01' })).toEqual({
      q: '',
      status: 'IGNORADO',
      direction: undefined,
      bankAccountId: undefined,
      from: '2026-09-01',
      to: undefined,
    });
    // O histórico entra com as desfeitas: é a trilha de desfazimento (RF-077).
    expect(consultaHistorico({ q: '' })).toMatchObject({ includeUndone: true, hasDivergence: undefined });
    expect(consultaHistorico({ q: '', vigencia: 'vigentes', hasDivergence: 'false' })).toMatchObject({
      includeUndone: false,
      hasDivergence: false,
    });
    expect(consultaRegra({ q: 'tar', situacao: 'false' })).toEqual({ q: 'tar', isActive: false });
    expect(consultaDivergencias({ conta: '', de: '2026-09-01', ate: '' })).toEqual({
      bankAccountId: undefined,
      from: '2026-09-01',
      to: undefined,
    });
    expect(problemaExecucao({ conta: 'cta-1', de: '', ate: '' })).toContain('período');
    expect(problemaExecucao({ conta: 'cta-1', de: '2026-09-30', ate: '2026-09-01' })).toContain('posterior');
    expect(
      resumoIdentificacao({ metadata: { identification: { kind: 'TARIFA', identifiedAt: 'x' } } }),
    ).toBe('Tarifa');
  });
});

// ---------------------------------------------------------------------------

interface Pendentes {
  identificar(movimento: PendingBankTransaction): void;
  selecionar(arquivo: File | null): void;
  importar(): void;
  problemaArquivo(): string | null;
  podeIdentificar(): boolean;
  podeImportar(): boolean;
  lista: { linhas(): PendingBankTransaction[] };
}

describe('importação e movimentos identificados (UI-048)', () => {
  it('lista as pendências da empresa ativa e grava a identificação na linha', () => {
    const { mock, companyId } = prepararSessao(['reconciliation:READ', 'reconciliation:CREATE']);
    const fixture = TestBed.createComponent(PendingPage);
    fixture.detectChanges();

    const lista = mock.expectOne((r) => r.url === `${BASE}/reconciliation/pending`);
    expect(lista.request.headers.get('x-company-id')).toBe(companyId);
    lista.flush(paginado([pendente()]));
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as Pendentes;
    expect(pagina.podeImportar()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Não identificado');

    pagina.identificar(pagina.lista.linhas()[0]);
    const identificar = mock.expectOne(`${BASE}/reconciliation/bank-transactions/${MOV}/identify`);
    expect(identificar.request.method).toBe('POST');
    identificar.flush({ bankTransactionId: MOV, kind: 'PIX', partnerName: 'Alfa', identifiedAt: '2026-09-11' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('PIX · Alfa');
    mock.verify();
  });

  it('importa OFX e recorta a lista na conta e no período do extrato (RF-071)', () => {
    const { mock } = prepararSessao([
      'reconciliation:READ',
      'bank-statements:CREATE',
      'company-bank-accounts:READ',
    ]);
    const fixture = TestBed.createComponent(PendingPage);
    fixture.detectChanges();
    mock.expectOne((r) => r.url === `${BASE}/reconciliation/pending`).flush(paginado([]));
    mock
      .expectOne((r) => r.url === `${BASE}/banking/accounts`)
      .flush(paginado([{ id: 'cta-1', description: 'Itaú', isDefault: true, isActive: true }]));

    const pagina = fixture.componentInstance as unknown as Pendentes;
    expect(pagina.podeIdentificar()).toBe(false);

    pagina.selecionar(new File(['x'], 'retorno.ret'));
    expect(pagina.problemaArquivo()).toContain('OFX ou CSV');

    pagina.selecionar(new File(['OFXHEADER'], 'extrato.ofx'));
    pagina.importar();
    const envio = mock.expectOne(`${BASE}/banking/statements/import`);
    expect((envio.request.body as FormData).get('bankAccountId')).toBe('cta-1');
    envio.flush({
      id: 'ext-1',
      bankAccountId: 'cta-1',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-10',
      importedCount: 12,
      totalCount: 12,
      duplicateCount: 0,
    } as Partial<BankStatementImport>);

    const recortada = mock.expectOne((r) => r.url === `${BASE}/reconciliation/pending`);
    expect(recortada.request.params.get('bankAccountId')).toBe('cta-1');
    expect(recortada.request.params.get('from')).toBe('2026-09-01');
    expect(recortada.request.params.get('to')).toBe('2026-09-10');
  });
});

// ---------------------------------------------------------------------------

interface Conciliar {
  escolherParcela(c: MatchCandidate): void;
  valorVinculo: { (): string | null; set(v: string | null): void };
  justificativa: { set(v: string): void };
  problemaDoVinculo(): string | null;
  vincular(): void;
  abrirDesfazer(v: ReconciliationListItem): void;
  motivo: { set(v: string): void };
  desfazer(): void;
  restante(): string;
  podeVincular(): boolean;
  podeIgnorar(): boolean;
  podeReabrir(): boolean;
  reabrir(): void;
  dias: { set(v: string): void };
  buscar(): void;
  problemaBusca(): string | null;
}

function abrirConciliacao(
  permissoes: string[],
  resposta = sugestoes(),
  vinculos: ReconciliationListItem[] = [],
) {
  const sessao = prepararSessao(permissoes, [rota(MOV)]);
  const fixture = TestBed.createComponent(MatchingPage);
  fixture.detectChanges();

  const busca = sessao.mock.expectOne((r) => r.url === `${BASE}/reconciliation/bank-transactions/${MOV}/suggestions`);
  expect(busca.request.params.get('dayTolerance')).toBe('5');
  busca.flush(resposta);
  const lista = sessao.mock.expectOne((r) => r.url === `${BASE}/reconciliation`);
  expect(lista.request.params.get('bankTransactionId')).toBe(MOV);
  expect(lista.request.params.get('includeUndone')).toBe('true');
  lista.flush(paginado(vinculos));
  fixture.detectChanges();

  return { ...sessao, fixture, pagina: fixture.componentInstance as unknown as Conciliar };
}

const CONCILIADOR = ['reconciliation:READ', 'reconciliation:CREATE', 'reconciliation:DELETE'];

describe('sugestões com score e conciliação manual (UI-049/UI-050)', () => {
  it('mostra score e critérios aplicados, e só busca com tolerância válida', () => {
    const { fixture, pagina, mock } = abrirConciliacao(['reconciliation:READ']);
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('72,5%');
    expect(texto).toContain('contraparte identificada é o parceiro do título');
    expect(texto).toContain('REC-0042');
    // Sem `reconciliation:CREATE`, nada de vincular nem ignorar.
    expect(pagina.podeVincular()).toBe(false);
    expect(pagina.podeIgnorar()).toBe(false);

    pagina.dias.set('61');
    pagina.buscar();
    expect(pagina.problemaBusca()).toContain('0 a 60');
    mock.verify();
  });

  it('exige justificativa quando o valor difere e envia o vínculo da parcela (RF-076)', () => {
    const { mock, pagina, companyId } = abrirConciliacao(CONCILIADOR, sugestoes(), [
      vinculo({ reconciledAmount: '50.00', installmentId: 'par-9' }),
    ]);
    expect(pagina.restante()).toBe('1450.00');
    expect(pagina.podeVincular()).toBe(true);
    // Com vínculo vivo, marcar como sem par seria recusado (409).
    expect(pagina.podeIgnorar()).toBe(false);

    pagina.escolherParcela(candidata());
    expect(pagina.valorVinculo()).toBe('1450.00');
    expect(pagina.problemaDoVinculo()).toBeNull();

    pagina.valorVinculo.set('1400.00');
    expect(pagina.problemaDoVinculo()).toContain('justifique');
    pagina.vincular();
    mock.verify();

    pagina.justificativa.set('Desconto concedido na negociação');
    pagina.vincular();
    const envio = mock.expectOne(`${BASE}/reconciliation`);
    expect(envio.request.method).toBe('POST');
    expect(envio.request.headers.get('x-company-id')).toBe(companyId);
    expect(envio.request.body).toEqual({
      bankTransactionId: MOV,
      installmentId: 'par-1',
      amount: '1400.00',
      justification: 'Desconto concedido na negociação',
    });
    envio.flush(vinculo({ id: 'con-2' }));

    // A situação é recalculada pelo trigger: a tela recarrega as duas fontes.
    mock.expectOne((r) => r.url.endsWith('/suggestions')).flush(sugestoes({ reconciliationStatus: 'CONCILIADO' }));
    mock.expectOne((r) => r.url === `${BASE}/reconciliation`).flush(paginado([]));
  });

  it('desfaz com motivo, pelo id do vínculo, e mostra o erro do servidor', () => {
    const vivo = vinculo();
    const { mock, pagina, fixture } = abrirConciliacao(CONCILIADOR, sugestoes(), [
      vivo,
      vinculo({ id: 'con-0', undoneAt: '2026-09-10T09:00:00Z', undoReason: 'Parcela errada' }),
    ]);
    expect(fixture.nativeElement.textContent).toContain('Parcela errada');

    pagina.abrirDesfazer(vivo);
    pagina.motivo.set('ab');
    pagina.desfazer();
    mock.verify();

    pagina.motivo.set('Cliente pagou outra parcela');
    pagina.desfazer();
    const envio = mock.expectOne(`${BASE}/reconciliation/con-1`);
    expect(envio.request.method).toBe('DELETE');
    expect(envio.request.body).toEqual({ reason: 'Cliente pagou outra parcela' });
    envio.flush(...erroHttp(409, 'Esta conciliação já foi desfeita.'));
    fixture.detectChanges();

    expect(fixture.nativeElement.ownerDocument.body.textContent).toContain('Esta conciliação já foi desfeita.');
  });

  it('reabre o movimento ignorado e não oferece vínculo antes disso', () => {
    const { mock, pagina } = abrirConciliacao(CONCILIADOR, sugestoes({ reconciliationStatus: 'IGNORADO' }));
    expect(pagina.podeVincular()).toBe(false);
    expect(pagina.podeReabrir()).toBe(true);

    pagina.reabrir();
    const envio = mock.expectOne(`${BASE}/reconciliation/bank-transactions/${MOV}/reopen`);
    expect(envio.request.method).toBe('POST');
  });
});

// ---------------------------------------------------------------------------

interface Regras {
  abrirNova(): void;
  abrirEdicao(r: ReconciliationRule): void;
  mudar(campo: string, valor: unknown): void;
  salvar(): void;
  problema(): string | null;
  desativar(r: ReconciliationRule): void;
  podeCriar(): boolean;
  podeExecutar(): boolean;
  abrirExecucao(): void;
  mudarExecucao(campo: string, valor: string): void;
  executar(): void;
}

function abrirRegras(permissoes: string[]) {
  const sessao = prepararSessao(permissoes);
  const fixture = TestBed.createComponent(RulesPage);
  fixture.detectChanges();
  sessao.mock.expectOne((r) => r.url === `${BASE}/reconciliation-rules`).flush(paginado([regra()]));
  if (permissoes.includes('company-bank-accounts:READ')) {
    sessao.mock
      .expectOne((r) => r.url === `${BASE}/banking/accounts`)
      .flush(paginado([{ id: 'cta-1', description: 'Itaú', isDefault: true, isActive: true }]));
  }
  fixture.detectChanges();
  return { ...sessao, fixture, pagina: fixture.componentInstance as unknown as Regras };
}

const GESTOR_REGRAS = [
  'reconciliation-rules:READ',
  'reconciliation-rules:CREATE',
  'reconciliation-rules:UPDATE',
  'reconciliation-rules:DELETE',
];

describe('regras de conciliação automática (UI-051)', () => {
  it('lista na ordem de avaliação e só oferece o que o perfil alcança', () => {
    const { fixture, pagina } = abrirRegras(['reconciliation-rules:READ']);
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Tarifas');
    expect(texto).toContain('histórico contém "TARIFA"');
    expect(texto).toContain('Marcar como ignorado');
    expect(pagina.podeCriar()).toBe(false);
    expect(pagina.podeExecutar()).toBe(false);
  });

  it('cadastra só com as condições preenchidas e recusa conciliar sem confiança', () => {
    const { mock, pagina } = abrirRegras(GESTOR_REGRAS);

    pagina.abrirNova();
    pagina.mudar('name', 'PIX de clientes');
    pagina.mudar('direction', 'CREDITO');
    pagina.mudar('acao', 'CONCILIAR');
    pagina.salvar();
    expect(pagina.problema()).toBe('Conciliar sem revisão exige a confiança mínima.');
    mock.verify();

    pagina.mudar('minScore', '90.00');
    pagina.mudar('dayTolerance', '2');
    pagina.salvar();
    const envio = mock.expectOne(`${BASE}/reconciliation-rules`);
    expect(envio.request.method).toBe('POST');
    expect(envio.request.body).toEqual({
      name: 'PIX de clientes',
      priority: 100,
      conditions: { direction: 'CREDITO' },
      actions: { autoReconcile: true, minScore: '90.00' },
      valueTolerance: '0.00',
      dayTolerance: 2,
      isActive: true,
    });
    envio.flush(regra({ id: 'reg-2', name: 'PIX de clientes' }));
    mock.expectOne((r) => r.url === `${BASE}/reconciliation-rules`).flush(paginado([]));
  });

  it('altera pelo id da regra e desativa em vez de apagar', () => {
    const { mock, pagina } = abrirRegras(GESTOR_REGRAS);

    pagina.abrirEdicao(regra());
    pagina.mudar('priority', '20');
    pagina.salvar();
    const edicao = mock.expectOne(`${BASE}/reconciliation-rules/reg-1`);
    expect(edicao.request.method).toBe('PATCH');
    expect(edicao.request.body).toMatchObject({
      priority: 20,
      conditions: { direction: 'DEBITO', descriptionContains: 'TARIFA' },
      actions: { markIgnored: true },
    });
    edicao.flush(regra({ priority: 20 }));
    mock.expectOne((r) => r.url === `${BASE}/reconciliation-rules`).flush(paginado([]));

    pagina.desativar(regra());
    const desativar = mock.expectOne(`${BASE}/reconciliation-rules/reg-1`);
    expect(desativar.request.method).toBe('DELETE');
  });

  it('enfileira a execução automática por conta e período (RF-075)', () => {
    const { mock, pagina } = abrirRegras([
      'reconciliation-rules:READ',
      'reconciliation:APPROVE',
      'company-bank-accounts:READ',
    ]);
    expect(pagina.podeExecutar()).toBe(true);

    pagina.abrirExecucao();
    pagina.executar();
    mock.verify();

    pagina.mudarExecucao('de', '2026-09-01');
    pagina.mudarExecucao('ate', '2026-09-30');
    pagina.executar();
    const envio = mock.expectOne(`${BASE}/reconciliation/run`);
    expect(envio.request.body).toEqual({ bankAccountId: 'cta-1', from: '2026-09-01', to: '2026-09-30' });
  });
});

// ---------------------------------------------------------------------------

describe('painel de divergências (UI-052)', () => {
  it('mostra as quatro divergências e refaz a consulta com o filtro', () => {
    const { mock } = prepararSessao(['reconciliation:READ']);
    const fixture = TestBed.createComponent(DivergencesPage);
    fixture.detectChanges();

    const painel: ReconciliationDivergences = {
      period: { from: null, to: null },
      bankAccountId: null,
      unreconciled: {
        count: 3,
        debitTotal: '80.00',
        creditTotal: '1500.00',
        sample: [
          {
            id: MOV,
            bankAccountId: 'cta-1',
            movementDate: '2026-09-10',
            direction: 'DEBITO',
            amount: '39.90',
            description: 'TARIFA PACOTE',
            reconciliationStatus: 'NAO_CONCILIADO',
          },
        ],
      },
      partiallyReconciled: { count: 0, debitTotal: '0', creditTotal: '0', sample: [] },
      divergentLinks: { count: 1, sample: [vinculo({ hasDivergence: true, difference: '-50.00', justification: 'Desconto' })] },
      settlementsWithoutMovement: {
        count: 2,
        sample: [
          { id: 'bx-1', settlementDate: '2026-09-05', totalAmount: '700.00', bankAccountId: 'cta-1', installmentId: 'par-3', transactionId: null },
        ],
      },
      accounts: [],
    };
    mock.expectOne(`${BASE}/reconciliation/divergences`).flush(painel);
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Baixa sem movimento');
    expect(texto).toContain('TARIFA PACOTE');
    expect(texto).toContain('− R$ 39,90');
    expect(texto).toContain('Desconto');
    expect(texto).toContain('R$ 700,00');

    (fixture.componentInstance as unknown as { filtrar(c: string, v: string): void }).filtrar('de', '2026-09-01');
    const refeita = mock.expectOne((r) => r.url === `${BASE}/reconciliation/divergences`);
    expect(refeita.request.params.get('from')).toBe('2026-09-01');
    expect(refeita.request.params.has('bankAccountId')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('histórico e trilha de desfazimento (UI-053)', () => {
  it('entra com as desfeitas, recortado no movimento, e mostra o motivo', () => {
    const { mock } = prepararSessao(['reconciliation:READ'], [rota(null, { bankTransactionId: MOV })]);
    const fixture = TestBed.createComponent(HistoryPage);
    fixture.detectChanges();

    const lista = mock.expectOne((r) => r.url === `${BASE}/reconciliation`);
    expect(lista.request.params.get('includeUndone')).toBe('true');
    expect(lista.request.params.get('bankTransactionId')).toBe(MOV);
    lista.flush(
      paginado([
        vinculo({ undoneAt: '2026-09-12T08:00:00Z', undoReason: 'Vinculado ao título errado' }),
        vinculo({ id: 'con-2', origin: 'AUTOMATICA_REGRA', score: '96.00' }),
      ]),
    );
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Mostrando a trilha de um movimento');
    expect(texto).toContain('Desfeita');
    expect(texto).toContain('Vinculado ao título errado');
    expect(texto).toContain('Automática por regra · confiança 96%');
  });
});
