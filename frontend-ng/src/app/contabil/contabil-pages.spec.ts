import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { nomeDoAnexo } from '../core/api/accounting-api.service';
import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type {
  AccountClassification,
  AccountingPeriod,
  IncomeStatement,
  JournalEntry,
  LedgerAccount,
  LedgerAccountNode,
  LedgerReport,
  TrialBalance,
} from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { ConfirmService } from '../ui/confirm.service';
import { ChartOfAccountsPage } from './chart-of-accounts-page';
import { ClassificationsPage } from './classifications-page';
import { ExportPage } from './export-page';
import { IncomeStatementPage } from './income-statement-page';
import { JournalEntriesPage } from './journal-entries-page';
import { JournalEntryFormPage } from './journal-entry-form-page';
import { LedgerPage } from './ledger-page';
import { PeriodsPage } from './periods-page';
import {
  acoesDoPeriodo,
  achatarArvore,
  anoAnterior,
  anteriorAberto,
  bloqueioDaCompetencia,
  consultaLancamentos,
  contasAnaliticas,
  filtrarOpcoes,
  formContaVazio,
  formLancamentoVazio,
  linhasComparativas,
  mesDaData,
  montarConta,
  montarEdicaoConta,
  montarLancamento,
  opcaoContaContabil,
  problemaConta,
  problemaEstorno,
  problemaLancamento,
  problemaRecorte,
  problemaReabertura,
  totaisPartidas,
  variacaoPercentual,
} from './rotulos';
import { TrialBalancePage } from './trial-balance-page';

const BASE = '/api/v1';

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

function rota(query: Record<string, string> = {}): Provider {
  return {
    provide: ActivatedRoute,
    useValue: {
      snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap(query) },
    },
  };
}

function conta(sobrescrever: Partial<LedgerAccountNode> = {}): LedgerAccountNode {
  return {
    id: 'cta-1',
    parentId: null,
    code: '1',
    shortCode: null,
    name: 'Ativo',
    type: 'ATIVO',
    nature: 'DEVEDORA',
    level: 1,
    acceptsEntry: false,
    spedReferenceCode: null,
    isActive: true,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    children: [],
    ...sobrescrever,
  };
}

/** 1 Ativo › 1.1 Circulante › 1.1.01 Caixa (analítica) · 3 Receita › 3.1 Serviços (analítica). */
function planoExemplo(): LedgerAccountNode[] {
  const caixa = conta({
    id: 'caixa',
    parentId: 'circ',
    code: '1.1.01',
    name: 'Caixa geral',
    acceptsEntry: true,
    level: 3,
  });
  const banco = conta({
    id: 'banco',
    parentId: 'circ',
    code: '1.1.02',
    name: 'Bancos (inativa)',
    acceptsEntry: true,
    isActive: false,
    level: 3,
  });
  const circulante = conta({
    id: 'circ',
    parentId: 'ativo',
    code: '1.1',
    name: 'Circulante',
    level: 2,
    children: [caixa, banco],
  });
  const ativo = conta({ id: 'ativo', code: '1', name: 'Ativo', children: [circulante] });
  const servicos = conta({
    id: 'serv',
    parentId: 'rec',
    code: '3.1',
    name: 'Receita de serviços',
    type: 'RECEITA',
    nature: 'CREDORA',
    acceptsEntry: true,
    level: 2,
  });
  const receita = conta({
    id: 'rec',
    code: '3',
    name: 'Receita',
    type: 'RECEITA',
    nature: 'CREDORA',
    children: [servicos],
  });
  return [ativo, receita];
}

// ---------------------------------------------------------------------------

describe('plano de contas — regras espelhadas do backend (UI-054)', () => {
  it('achata a árvore respeitando o recolhido e mostra ancestrais do que casa na busca', () => {
    const plano = planoExemplo();
    const tudo = achatarArvore(plano, new Set(), { q: '' });
    expect(tudo.map((l) => `${l.profundidade}:${l.conta.code}`)).toEqual([
      '0:1',
      '1:1.1',
      '2:1.1.01',
      '2:1.1.02',
      '0:3',
      '1:3.1',
    ]);

    const recolhido = achatarArvore(plano, new Set(['ativo']), { q: '' });
    expect(recolhido.map((l) => l.conta.code)).toEqual(['1', '3', '3.1']);
    expect(recolhido[0].recolhida).toBe(true);

    // Busca sem acento acha "Serviços" e traz o grupo junto, mesmo recolhido.
    const busca = achatarArvore(plano, new Set(['rec']), { q: 'servicos' });
    expect(busca.map((l) => l.conta.code)).toEqual(['3', '3.1']);

    const resultado = achatarArvore(plano, new Set(), { q: '', grupo: 'RESULTADO' });
    expect(resultado.map((l) => l.conta.code)).toEqual(['3', '3.1']);

    const inativas = achatarArvore(plano, new Set(), { q: '', situacao: 'inativas' });
    expect(inativas.map((l) => l.conta.code)).toEqual(['1', '1.1', '1.1.02']);
  });

  it('só contas analíticas e ativas recebem partida', () => {
    expect(contasAnaliticas(planoExemplo()).map((c) => c.code)).toEqual(['1.1.01', '3.1']);
    const opcoes = contasAnaliticas(planoExemplo()).map(opcaoContaContabil);
    expect(filtrarOpcoes(opcoes, 'caixa')).toEqual([
      { value: 'caixa', label: '1.1.01 — Caixa geral' },
    ]);
    expect(filtrarOpcoes(opcoes, '3.1')).toHaveLength(1);
  });

  it('recusa filha de tipo diferente, pai analítico e compensação sem natureza (RF-079)', () => {
    const pai = { code: '1.1', type: 'ATIVO' as const, acceptsEntry: false };
    const base = {
      ...formContaVazio({ id: 'circ', code: '1.1', type: 'ATIVO' }),
      code: '1.1.03',
      name: 'Aplicações',
    };
    expect(problemaConta(base, pai)).toBeNull();
    expect(problemaConta({ ...base, code: '1.1.a' }, pai)).toContain('estruturado');
    expect(problemaConta({ ...base, type: 'PASSIVO' }, pai)).toContain('mesmo tipo');
    expect(problemaConta(base, { ...pai, acceptsEntry: true })).toContain('não pode ter filhas');
    expect(problemaConta({ ...base, parentId: '', type: 'COMPENSACAO' }, null)).toContain(
      'natureza',
    );

    // Natureza só vai no corpo em compensação: nos demais decorre do tipo.
    expect(montarConta({ ...base, nature: 'CREDORA' })).toEqual({
      code: '1.1.03',
      name: 'Aplicações',
      type: 'ATIVO',
      acceptsEntry: true,
      parentId: 'circ',
    });
    expect(
      montarConta({ ...base, parentId: '', type: 'COMPENSACAO', nature: 'CREDORA' }),
    ).toMatchObject({
      nature: 'CREDORA',
    });
  });

  it('a edição manda só o que mudou, nunca código nem tipo', () => {
    const atual = conta({
      id: 'caixa',
      code: '1.1.01',
      name: 'Caixa',
      acceptsEntry: true,
    }) as LedgerAccount;
    const form = {
      ...formContaVazio(),
      code: '9.9',
      type: 'RECEITA' as const,
      name: 'Caixa geral',
      acceptsEntry: true,
    };
    expect(montarEdicaoConta(form, atual)).toEqual({ name: 'Caixa geral' });
  });
});

interface Plano {
  abrirNova(pai: LedgerAccount | null): void;
  abrirEdicao(conta: LedgerAccount): void;
  mudar(campo: string, valor: unknown): void;
  salvar(): void;
  inativar(conta: LedgerAccount): Promise<void>;
  alternar(id: string): void;
  problema(): string | null;
  linhas(): { conta: LedgerAccountNode }[];
  podeCriar(): boolean;
  podeInativar(): boolean;
}

describe('plano de contas em árvore (UI-054)', () => {
  it('carrega a árvore da empresa ativa e recolhe grupos', () => {
    const { mock, companyId } = prepararSessao(['ledger-accounts:READ']);
    const fixture = TestBed.createComponent(ChartOfAccountsPage);
    fixture.detectChanges();

    const arvore = mock.expectOne(`${BASE}/ledger-accounts/tree`);
    expect(arvore.request.headers.get('x-company-id')).toBe(companyId);
    arvore.flush(planoExemplo());
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Caixa geral');
    expect(texto).toContain('Patrimoniais');
    expect(texto).toContain('De resultado');
    expect(texto).toContain('Sintética');
    expect(texto).not.toContain('Subconta');

    const pagina = fixture.componentInstance as unknown as Plano;
    expect(pagina.podeCriar()).toBe(false);
    pagina.alternar('ativo');
    expect(pagina.linhas().map((l) => l.conta.code)).toEqual(['1', '3', '3.1']);
    mock.verify();
  });

  it('cadastra subconta com o tipo do pai e recarrega o plano', () => {
    const { mock } = prepararSessao(['ledger-accounts:READ', 'ledger-accounts:CREATE']);
    const fixture = TestBed.createComponent(ChartOfAccountsPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/ledger-accounts/tree`).flush(planoExemplo());

    const pagina = fixture.componentInstance as unknown as Plano;
    const circulante = pagina.linhas()[1].conta;
    pagina.abrirNova(circulante);
    pagina.mudar('code', '1.1.03');
    pagina.salvar();
    expect(pagina.problema()).toContain('nome');
    mock.expectNone(`${BASE}/ledger-accounts`);

    pagina.mudar('name', 'Aplicações financeiras');
    pagina.salvar();
    const criar = mock.expectOne(`${BASE}/ledger-accounts`);
    expect(criar.request.method).toBe('POST');
    expect(criar.request.body).toEqual({
      code: '1.1.03',
      name: 'Aplicações financeiras',
      type: 'ATIVO',
      acceptsEntry: true,
      parentId: 'circ',
    });
    criar.flush(conta({ id: 'nova', code: '1.1.03' }));
    mock.expectOne(`${BASE}/ledger-accounts/tree`).flush(planoExemplo());
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Conta 1.1.03 cadastrada.');
    mock.verify();
  });

  it('inativa a conta sem apagar e mostra o erro do servidor', async () => {
    const { mock } = prepararSessao(['ledger-accounts:READ', 'ledger-accounts:DELETE']);
    const fixture = TestBed.createComponent(ChartOfAccountsPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/ledger-accounts/tree`).flush(planoExemplo());

    const pagina = fixture.componentInstance as unknown as Plano;
    const inativando = pagina.inativar(pagina.linhas()[2].conta);
    // Inativar passa pela confirmação padrão (UI-081) antes de chegar à API.
    TestBed.inject(ConfirmService).responder(true);
    await inativando;
    const inativar = mock.expectOne(`${BASE}/ledger-accounts/caixa`);
    expect(inativar.request.method).toBe('DELETE');
    inativar.flush(
      { statusCode: 409, message: 'A conta tem saldo.' },
      { status: 409, statusText: 'Conflito' },
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('A conta tem saldo.');
    mock.verify();
  });
});

// ---------------------------------------------------------------------------

function periodo(sobrescrever: Partial<AccountingPeriod> = {}): AccountingPeriod {
  return {
    id: 'per-03',
    year: 2026,
    month: 3,
    startDate: '2026-03-01T00:00:00.000Z',
    endDate: '2026-03-31T00:00:00.000Z',
    status: 'ABERTO',
    closedAt: null,
    closedById: null,
    reopenedAt: null,
    reopenedById: null,
    reopenReason: null,
    ...sobrescrever,
  };
}

function lancamento(sobrescrever: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'lan-1',
    number: 42,
    branchId: null,
    periodId: 'per-03',
    entryDate: '2026-03-05T00:00:00.000Z',
    competenceDate: '2026-03-05T00:00:00.000Z',
    history: 'Recebimento do cliente Alfa',
    totalAmount: '1500',
    origin: 'TITULO_BAIXA',
    originId: 'bx-1',
    settlementId: 'bx-1',
    fiscalDocumentId: null,
    batch: null,
    reversalOfId: null,
    isReversed: false,
    exported: false,
    exportedAt: null,
    createdAt: '2026-03-05T12:00:00.000Z',
    lines: [
      {
        id: 'p1',
        sequence: 1,
        accountId: 'caixa',
        accountCode: '1.1.01',
        accountName: 'Caixa geral',
        accountType: 'ATIVO',
        type: 'DEBITO',
        amount: '1500',
        costCenterId: null,
        extraHistory: null,
      },
      {
        id: 'p2',
        sequence: 2,
        accountId: 'serv',
        accountCode: '3.1',
        accountName: 'Receita de serviços',
        accountType: 'RECEITA',
        type: 'CREDITO',
        amount: '1500',
        costCenterId: null,
        extraHistory: null,
      },
    ],
    ...sobrescrever,
  };
}

function dre(
  receita: string,
  custo: string,
  despesa: string,
  extra: Partial<IncomeStatement> = {},
): IncomeStatement {
  const bruto = (BigInt(receita) - BigInt(custo)).toString();
  return {
    range: { from: '2026-01-01', to: '2026-03-31' },
    revenue: {
      total: receita,
      lines: [
        {
          accountId: 'serv',
          code: '3.1',
          name: 'Receita de serviços',
          type: 'RECEITA',
          amount: receita,
        },
      ],
    },
    cost: { total: custo, lines: [] },
    expense: {
      total: despesa,
      lines: [
        {
          accountId: 'adm',
          code: '4.1',
          name: 'Despesas administrativas',
          type: 'DESPESA',
          amount: despesa,
        },
      ],
    },
    grossResult: bruto,
    netResult: (BigInt(bruto) - BigInt(despesa)).toString(),
    ...extra,
  };
}

describe('lançamentos, relatórios e períodos — regras espelhadas do backend', () => {
  it('soma partidas em centavos e exige débito = crédito (RF-081)', () => {
    const linhas = [
      { type: 'DEBITO' as const, amount: '0.10' },
      { type: 'DEBITO' as const, amount: '0.20' },
      { type: 'CREDITO' as const, amount: '0.30' },
    ];
    // 0.1 + 0.2 em ponto flutuante não fecha com 0.3; em centavos fecha.
    expect(totaisPartidas(linhas)).toEqual({ debito: '0.30', credito: '0.30', diferenca: '0.00' });

    const form = {
      ...formLancamentoVazio('2026-03-05'),
      history: 'Aporte de capital',
      lines: [
        {
          accountId: 'caixa',
          type: 'DEBITO' as const,
          amount: '100.00',
          costCenterId: '',
          extraHistory: '',
        },
        {
          accountId: 'serv',
          type: 'CREDITO' as const,
          amount: '99.99',
          costCenterId: 'cc-1',
          extraHistory: ' ref ',
        },
      ],
    };
    expect(problemaLancamento(form)).toContain('desbalanceado');
    expect(problemaLancamento({ ...form, history: 'ab' })).toContain('histórico');
    expect(
      problemaLancamento({ ...form, lines: [form.lines[0], { ...form.lines[1], accountId: '' }] }),
    ).toContain('Partida 2: escolha a conta');
    expect(
      problemaLancamento({ ...form, lines: [form.lines[0], { ...form.lines[1], amount: '0' }] }),
    ).toContain('positivo');
    expect(
      problemaLancamento({
        ...form,
        lines: [form.lines[0], { ...form.lines[0], accountId: 'serv' }],
      }),
    ).toContain('um débito e um crédito');

    const balanceado = { ...form, lines: [form.lines[0], { ...form.lines[1], amount: '100.00' }] };
    expect(problemaLancamento(balanceado)).toBeNull();
    expect(montarLancamento(balanceado)).toEqual({
      entryDate: '2026-03-05',
      history: 'Aporte de capital',
      lines: [
        { accountId: 'caixa', type: 'DEBITO', amount: '100.00' },
        {
          accountId: 'serv',
          type: 'CREDITO',
          amount: '100.00',
          costCenterId: 'cc-1',
          extraHistory: 'ref',
        },
      ],
    });
    expect(problemaEstorno('erro')).toContain('mínimo de 5');
    expect(problemaEstorno('Lançado em duplicidade')).toBeNull();
    expect(consultaLancamentos({ q: '', origin: 'MANUAL', from: '2026-03-01' })).toEqual({
      origin: 'MANUAL',
      accountId: undefined,
      batch: undefined,
      from: '2026-03-01',
      to: undefined,
    });
  });

  it('mostra o bloqueio da competência pelo período (RN-008 — UI-059)', () => {
    const periodos = [
      periodo({ status: 'FECHADO' }),
      periodo({ id: 'per-04', month: 4, status: 'EM_FECHAMENTO' }),
    ];
    expect(bloqueioDaCompetencia(null, '2026-03-10')).toBeNull();
    expect(bloqueioDaCompetencia(periodos, '2026-03-10')).toContain('03/2026 está fechado');
    expect(bloqueioDaCompetencia(periodos, '2026-04-10')).toBeNull();
    expect(bloqueioDaCompetencia(periodos, '2026-05-10')).toContain(
      'Não há período contábil para 05/2026',
    );

    expect(acoesDoPeriodo('ABERTO')).toEqual({
      iniciarFechamento: true,
      fechar: true,
      reabrir: false,
    });
    expect(acoesDoPeriodo('EM_FECHAMENTO')).toEqual({
      iniciarFechamento: false,
      fechar: true,
      reabrir: false,
    });
    expect(acoesDoPeriodo('FECHADO')).toEqual({
      iniciarFechamento: false,
      fechar: false,
      reabrir: true,
    });
    expect(
      anteriorAberto([periodo({ month: 1, status: 'FECHADO' }), periodo({ month: 2 })], periodo()),
    ).toMatchObject({
      month: 2,
    });
    expect(problemaReabertura('ajuste')).toBeNull();
    expect(problemaReabertura('ok')).toContain('mínimo de 5');
  });

  it('recorta períodos e compara exercícios sem ponto flutuante (UI-057/UI-058)', () => {
    expect(problemaRecorte('2026-03-31', '2026-03-01')).toContain('posterior');
    expect(problemaRecorte('', '2026-03-01')).toContain('Informe');
    expect(mesDaData('2026-02-10')).toEqual({ de: '2026-02-01', ate: '2026-02-28' });
    expect(anoAnterior('2024-02-29')).toBe('2023-02-28');

    expect(variacaoPercentual('112.50', '100.00')).toBe('+12,5%');
    expect(variacaoPercentual('50', '100')).toBe('−50,0%');
    expect(variacaoPercentual('100', '100')).toBe('0,0%');
    expect(variacaoPercentual('10', '0')).toBe('—');
    expect(variacaoPercentual('10', null)).toBe('—');

    const atual = dre('1000', '0', '400').expense.lines;
    const anterior = [
      {
        accountId: 'adm',
        code: '4.1',
        name: 'Despesas administrativas',
        type: 'DESPESA' as const,
        amount: '500',
      },
      { accountId: 'mkt', code: '4.2', name: 'Marketing', type: 'DESPESA' as const, amount: '80' },
    ];
    expect(linhasComparativas(atual, anterior)).toEqual([
      {
        accountId: 'adm',
        code: '4.1',
        name: 'Despesas administrativas',
        atual: '400',
        anterior: '500',
        variacao: '-100.00',
        percentual: '−20,0%',
      },
      {
        accountId: 'mkt',
        code: '4.2',
        name: 'Marketing',
        atual: '0.00',
        anterior: '80',
        variacao: '-80.00',
        percentual: '−100,0%',
      },
    ]);
    expect(nomeDoAnexo('attachment; filename="contabil_2026-03.csv"')).toBe('contabil_2026-03.csv');
    expect(nomeDoAnexo(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

function classificacao(sobrescrever: Partial<AccountClassification> = {}): AccountClassification {
  return {
    id: 'cat-1',
    code: 'REC-SERV',
    name: 'Serviços prestados',
    ledgerAccountId: null,
    ledgerAccountCode: null,
    ledgerAccountName: null,
    ...sobrescrever,
  };
}

interface Classificacao {
  trocarOrigem(origem: string): void;
  escolher(id: string, accountId: string | null): void;
  salvar(item: AccountClassification): void;
  itens(): AccountClassification[];
  podeClassificar(): boolean;
}

describe('classificação contábil das operações financeiras (UI-055)', () => {
  it('lista a origem na empresa ativa, avisa o que está sem conta e classifica', () => {
    const { mock, companyId } = prepararSessao([
      'accounting-classifications:READ',
      'accounting-classifications:UPDATE',
      'ledger-accounts:READ',
    ]);
    const fixture = TestBed.createComponent(ClassificationsPage);
    fixture.detectChanges();

    const lista = mock.expectOne((r) => r.url === `${BASE}/accounting/classifications/categories`);
    expect(lista.request.headers.get('x-company-id')).toBe(companyId);
    expect(lista.request.params.has('unclassifiedOnly')).toBe(false);
    lista.flush([
      classificacao(),
      classificacao({
        id: 'cat-2',
        name: 'Aluguel',
        ledgerAccountId: 'adm',
        ledgerAccountCode: '4.1',
        ledgerAccountName: 'Despesas',
      }),
    ]);
    mock.expectOne(`${BASE}/ledger-accounts/tree`).flush(planoExemplo());
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('1 de 2 sem conta contábil');
    expect(texto).toContain('4.1 — Despesas');

    const pagina = fixture.componentInstance as unknown as Classificacao;
    pagina.escolher('cat-1', 'serv');
    pagina.salvar(pagina.itens()[0]);
    const salvar = mock.expectOne(`${BASE}/accounting/classifications/categories/cat-1`);
    expect(salvar.request.method).toBe('PUT');
    expect(salvar.request.body).toEqual({ accountId: 'serv' });
    salvar.flush(
      classificacao({
        ledgerAccountId: 'serv',
        ledgerAccountCode: '3.1',
        ledgerAccountName: 'Receita de serviços',
      }),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'classificada em 3.1 — Receita de serviços',
    );

    pagina.trocarOrigem('payroll-items');
    mock.expectOne((r) => r.url === `${BASE}/accounting/classifications/payroll-items`).flush([]);
    mock.verify();
  });

  it('sem permissão de alterar não oferece a edição', () => {
    const { mock } = prepararSessao(['accounting-classifications:READ']);
    const fixture = TestBed.createComponent(ClassificationsPage);
    fixture.detectChanges();
    mock
      .expectOne((r) => r.url === `${BASE}/accounting/classifications/categories`)
      .flush([classificacao()]);
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as Classificacao;
    expect(pagina.podeClassificar()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Alterar para');
    expect(fixture.nativeElement.textContent).toContain('Sem acesso ao plano de contas');
    mock.verify();
  });
});

// ---------------------------------------------------------------------------

interface Lancamentos {
  abrirEstorno(l: JournalEntry): void;
  estornar(): void;
  motivo: { set(v: string): void };
  competenciaEstorno: { set(v: string): void };
  bloqueioEstorno(): string | null;
  alternar(id: string): void;
  lista: { linhas(): JournalEntry[] };
}

describe('lançamentos contábeis e estorno (UI-056/UI-059)', () => {
  it('mostra origem, documento, partidas e o cadeado do período fechado', () => {
    const { mock, companyId } = prepararSessao([
      'journal-entries:READ',
      'journal-entries:DELETE',
      'accounting-periods:READ',
    ]);
    const fixture = TestBed.createComponent(JournalEntriesPage);
    fixture.detectChanges();

    const lista = mock.expectOne((r) => r.url === `${BASE}/journal-entries`);
    expect(lista.request.headers.get('x-company-id')).toBe(companyId);
    lista.flush({ data: [lancamento()], total: 1, page: 1, pageSize: 20, totalPages: 1 });
    mock
      .expectOne((r) => r.url === `${BASE}/accounting/periods`)
      .flush([periodo({ status: 'FECHADO' })]);
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as Lancamentos;
    pagina.alternar('lan-1');
    fixture.detectChanges();
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Baixa de título');
    expect(texto).toContain('03/2026 fechado');
    expect(texto).toContain('3.1 — Receita de serviços');
    expect(texto).not.toContain('Novo lançamento');

    // Estorno na competência original (fechada) é bloqueado antes do servidor.
    pagina.abrirEstorno(pagina.lista.linhas()[0]);
    pagina.motivo.set('Baixa lançada em duplicidade');
    expect(pagina.bloqueioEstorno()).toContain('fechado');
    pagina.estornar();
    mock.expectNone(`${BASE}/journal-entries/lan-1/reverse`);

    // Informar a competência num mês sem bloqueio libera — mas sem período carregado, avisa.
    pagina.competenciaEstorno.set('2026-04-02');
    expect(pagina.bloqueioEstorno()).toContain('Não há período');
    mock.verify();
  });

  it('estorna com motivo e competência e recarrega a lista', () => {
    const { mock } = prepararSessao(['journal-entries:READ', 'journal-entries:DELETE']);
    const fixture = TestBed.createComponent(JournalEntriesPage);
    fixture.detectChanges();
    mock
      .expectOne((r) => r.url === `${BASE}/journal-entries`)
      .flush({ data: [lancamento()], total: 1, page: 1, pageSize: 20, totalPages: 1 });

    const pagina = fixture.componentInstance as unknown as Lancamentos;
    pagina.abrirEstorno(pagina.lista.linhas()[0]);
    pagina.motivo.set('curto');
    pagina.competenciaEstorno.set('2026-04-02');
    pagina.estornar();
    const estorno = mock.expectOne(`${BASE}/journal-entries/lan-1/reverse`);
    expect(estorno.request.body).toEqual({ reason: 'curto', competenceDate: '2026-04-02' });
    estorno.flush(lancamento({ id: 'lan-2', number: 43, reversalOfId: 'lan-1' }));
    mock
      .expectOne((r) => r.url === `${BASE}/journal-entries`)
      .flush({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Lançamento nº 42 estornado pelo nº 43.');
    mock.verify();
  });
});

interface FormularioLancamento {
  mudar(campo: string, valor: string): void;
  mudarPartida(i: number, campo: string, valor: string | null): void;
  salvar(): void;
  bloqueio(): string | null;
  problema(): string | null;
}

describe('lançamento manual com partida dobrada (UI-056)', () => {
  it('não envia desbalanceado nem em período fechado; envia o balanceado', () => {
    const { mock } = prepararSessao([
      'journal-entries:CREATE',
      'ledger-accounts:READ',
      'accounting-periods:READ',
    ]);
    const router = TestBed.inject(Router);
    const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(JournalEntryFormPage);
    fixture.detectChanges();
    mock.expectOne(`${BASE}/ledger-accounts/tree`).flush(planoExemplo());
    mock
      .expectOne((r) => r.url === `${BASE}/accounting/periods`)
      .flush([periodo({ status: 'FECHADO' }), periodo({ id: 'per-04', month: 4 })]);

    const pagina = fixture.componentInstance as unknown as FormularioLancamento;
    pagina.mudar('entryDate', '2026-03-10');
    pagina.mudar('history', 'Aporte de capital');
    pagina.mudarPartida(0, 'accountId', 'caixa');
    pagina.mudarPartida(0, 'amount', '100.00');
    pagina.mudarPartida(1, 'accountId', 'serv');
    pagina.mudarPartida(1, 'amount', '90.00');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('R$ 10,00');
    expect(pagina.bloqueio()).toContain('03/2026 está fechado');

    pagina.mudar('competenceDate', '2026-04-01');
    expect(pagina.bloqueio()).toBeNull();
    pagina.salvar();
    expect(pagina.problema()).toContain('desbalanceado');
    mock.expectNone(`${BASE}/journal-entries`);

    pagina.mudarPartida(1, 'amount', '100.00');
    pagina.salvar();
    const criar = mock.expectOne(`${BASE}/journal-entries`);
    expect(criar.request.body).toEqual({
      entryDate: '2026-03-10',
      competenceDate: '2026-04-01',
      history: 'Aporte de capital',
      lines: [
        { accountId: 'caixa', type: 'DEBITO', amount: '100.00' },
        { accountId: 'serv', type: 'CREDITO', amount: '100.00' },
      ],
    });
    criar.flush(lancamento({ number: 50 }));
    expect(navegar).toHaveBeenCalledWith(['/contabil/lancamentos'], {
      state: { aviso: 'Lançamento nº 50 registrado.' },
    });
    mock.verify();
  });
});

// ---------------------------------------------------------------------------

interface Recorte {
  de: { set(v: string): void };
  ate: { set(v: string): void };
  centro: { set(v: string): void };
  comparar: { set(v: boolean): void };
  consultar(offset?: number): void;
}

describe('razão e balancete por período, conta e centro de custo (UI-057)', () => {
  it('abre o razão com o recorte da URL, incluindo o centro de custo', () => {
    const { mock, companyId } = prepararSessao(
      ['accounting-reports:READ'],
      [rota({ accountId: 'caixa', from: '2026-03-01', to: '2026-03-31', costCenterId: 'cc-1' })],
    );
    const fixture = TestBed.createComponent(LedgerPage);
    fixture.detectChanges();

    const razao = mock.expectOne((r) => r.url === `${BASE}/accounting/reports/ledger`);
    expect(razao.request.headers.get('x-company-id')).toBe(companyId);
    expect(razao.request.params.get('accountId')).toBe('caixa');
    expect(razao.request.params.get('costCenterId')).toBe('cc-1');
    expect(razao.request.params.get('limit')).toBe('200');
    expect(razao.request.params.has('offset')).toBe(false);
    razao.flush({
      account: {
        id: 'caixa',
        code: '1.1.01',
        name: 'Caixa geral',
        type: 'ATIVO',
        nature: 'DEVEDORA',
      },
      range: { from: '2026-03-01', to: '2026-03-31' },
      costCenterId: 'cc-1',
      openingBalance: '500',
      totalDebit: '300',
      totalCredit: '900',
      closingBalance: '-100',
      rows: [
        {
          entryId: 'l1',
          entryNumber: 5,
          competenceDate: '2026-03-05',
          history: 'Recebimento',
          extraHistory: null,
          origin: 'TITULO_BAIXA',
          debit: '300',
          credit: '0',
          balance: '800',
        },
      ],
    } satisfies LedgerReport);
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('1.1.01 — Caixa geral');
    expect(texto).toContain('recortado por centro de custo');
    expect(texto).toContain('R$ 800,00');
    expect(texto).toContain('Saldo contrário à natureza');
    mock.verify();
  });

  it('consulta o balancete com centro de custo e acusa quando não fecha', () => {
    const { mock } = prepararSessao(['accounting-reports:READ']);
    const fixture = TestBed.createComponent(TrialBalancePage);
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as Recorte;
    pagina.de.set('2026-03-01');
    pagina.ate.set('2026-03-31');
    pagina.centro.set('cc-1');
    pagina.consultar();
    const balancete = mock.expectOne((r) => r.url === `${BASE}/accounting/reports/trial-balance`);
    expect(balancete.request.params.get('costCenterId')).toBe('cc-1');
    expect(balancete.request.params.has('includeZeroed')).toBe(false);
    balancete.flush({
      range: { from: '2026-03-01', to: '2026-03-31' },
      costCenterId: 'cc-1',
      totalDebit: '100',
      totalCredit: '90',
      balanced: false,
      rows: [
        {
          accountId: 'caixa',
          code: '1.1.01',
          name: 'Caixa geral',
          type: 'ATIVO',
          nature: 'DEVEDORA',
          openingBalance: '0',
          debit: '100',
          credit: '90',
          closingBalance: '10',
        },
      ],
    } satisfies TrialBalance);
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Balancete não fecha');
    expect(texto).toContain('diferença de R$ 10,00');
    mock.verify();
  });
});

describe('DRE com comparativo entre exercícios (UI-058)', () => {
  it('consulta o período e o mesmo período do ano anterior', () => {
    const { mock } = prepararSessao(['accounting-reports:READ']);
    const fixture = TestBed.createComponent(IncomeStatementPage);
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as Recorte;
    pagina.de.set('2026-01-01');
    pagina.ate.set('2026-03-31');
    pagina.consultar();

    const chamadas = mock.match((r) => r.url === `${BASE}/accounting/reports/income-statement`);
    expect(
      chamadas.map((c) => `${c.request.params.get('from')}|${c.request.params.get('to')}`),
    ).toEqual(['2026-01-01|2026-03-31', '2025-01-01|2025-03-31']);
    chamadas[0].flush(dre('11250', '0', '400'));
    chamadas[1].flush(
      dre('10000', '0', '500', { range: { from: '2025-01-01', to: '2025-03-31' } }),
    );
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Receitas');
    expect(texto).toContain('+12,5%');
    expect(texto).toContain('Lucro líquido');
    expect(texto).toContain('R$ 10.850,00');
    mock.verify();
  });

  it('sem comparativo faz uma consulta só', () => {
    const { mock } = prepararSessao(['accounting-reports:READ']);
    const fixture = TestBed.createComponent(IncomeStatementPage);
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as Recorte;
    pagina.comparar.set(false);
    pagina.consultar();
    mock
      .expectOne((r) => r.url === `${BASE}/accounting/reports/income-statement`)
      .flush(dre('100', '0', '200'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Prejuízo líquido');
    mock.verify();
  });
});

// ---------------------------------------------------------------------------

interface Periodos {
  confirmar(p: AccountingPeriod, acao: string): void;
  executar(): void;
  motivo: { set(v: string): void };
  periodos(): AccountingPeriod[];
  abrirExercicio(): void;
  ano: { set(v: string): void };
}

describe('fechamento e reabertura de períodos (UI-059)', () => {
  it('fecha em ordem e reabre só com motivo', () => {
    const { mock, companyId } = prepararSessao([
      'accounting-periods:READ',
      'accounting-periods:UPDATE',
    ]);
    const fixture = TestBed.createComponent(PeriodsPage);
    fixture.detectChanges();

    const lista = mock.expectOne((r) => r.url === `${BASE}/accounting/periods`);
    expect(lista.request.headers.get('x-company-id')).toBe(companyId);
    lista.flush([
      periodo({ id: 'per-02', month: 2 }),
      periodo({ status: 'FECHADO', closedAt: '2026-04-02T10:00:00Z' }),
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1 período(s) fechado(s)');
    expect(fixture.nativeElement.textContent).toContain('Não aceita lançamentos');

    const pagina = fixture.componentInstance as unknown as Periodos;
    pagina.confirmar(pagina.periodos()[1], 'REABRIR');
    pagina.motivo.set('ok');
    pagina.executar();
    mock.expectNone(`${BASE}/accounting/periods/per-03/reopen`);

    pagina.motivo.set('Ajuste de provisão de férias');
    pagina.executar();
    const reabrir = mock.expectOne(`${BASE}/accounting/periods/per-03/reopen`);
    expect(reabrir.request.body).toEqual({ reason: 'Ajuste de provisão de férias' });
    reabrir.flush(periodo({ status: 'REABERTO', reopenReason: 'Ajuste de provisão de férias' }));

    pagina.confirmar(pagina.periodos()[0], 'FECHADO');
    pagina.executar();
    const fechar = mock.expectOne(`${BASE}/accounting/periods/per-02/close`);
    expect(fechar.request.body).toEqual({ status: 'FECHADO' });
    fechar.flush(periodo({ id: 'per-02', month: 2, status: 'FECHADO' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Período 02/2026: fechado.');

    pagina.ano.set('2027');
    pagina.abrirExercicio();
    const abrir = mock.expectOne(
      (r) => r.url === `${BASE}/accounting/periods` && r.method === 'POST',
    );
    expect(abrir.request.body).toEqual({ year: 2027 });
    abrir.flush([periodo({ year: 2027, month: 1 })]);
    mock.verify();
  });
});

// ---------------------------------------------------------------------------

describe('exportação contábil (UI-060)', () => {
  it('gera o arquivo por POST, salva como Blob e mostra a contagem', () => {
    const { mock, companyId } = prepararSessao(['accounting-reports:EXPORT']);
    const criar = vi.fn(() => 'blob:contabil');
    const revogar = vi.fn();
    Object.assign(URL, { createObjectURL: criar, revokeObjectURL: revogar });
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const fixture = TestBed.createComponent(ExportPage);
    fixture.detectChanges();
    const pagina = fixture.componentInstance as unknown as Recorte & { exportar(): void };
    pagina.de.set('2026-03-01');
    pagina.ate.set('2026-03-31');
    pagina.exportar();

    const exportar = mock.expectOne(`${BASE}/accounting/export`);
    expect(exportar.request.headers.get('x-company-id')).toBe(companyId);
    expect(exportar.request.responseType).toBe('blob');
    expect(exportar.request.body).toEqual({
      from: '2026-03-01',
      to: '2026-03-31',
      format: 'csv',
      pendingOnly: true,
      markExported: false,
    });
    exportar.flush(new Blob(['numero;data']), {
      headers: {
        'Content-Disposition': 'attachment; filename="contabil_20260301_20260331.csv"',
        'X-Total-Entries': '12',
        'X-Total-Lines': '30',
      },
    });
    fixture.detectChanges();

    expect(clique).toHaveBeenCalled();
    expect(revogar).toHaveBeenCalledWith('blob:contabil');
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('contabil_20260301_20260331.csv');
    expect(texto).toContain('12 lançamento(s), 30 partida(s). Nada foi marcado.');
    clique.mockRestore();
    mock.verify();
  });
});
