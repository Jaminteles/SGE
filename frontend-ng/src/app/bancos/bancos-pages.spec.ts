import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type { CompanyBankAccount, PaymentTransaction } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { BankAccountsPage, problemaConta } from './bank-accounts-page';
import { BankTransactionsPage } from './bank-transactions-page';
import { OperationsPage } from './operations-page';
import { PaymentDetailPage, etapasOrdem } from './payment-detail-page';
import { PaymentFormPage } from './payment-form-page';
import {
  aceitaCancelamento,
  aceitaConsulta,
  consultaConta,
  consultaOrdem,
  problemaExtrato,
  problemaFavorecido,
} from './rotulos';
import { StatementsPage } from './statements-page';

const BASE = '/api/v1';

function paginado<T>(data: T[], total = data.length) {
  return { data, total, page: 1, pageSize: 20, totalPages: 1 };
}

function conta(sobrescrever: Partial<CompanyBankAccount> = {}): CompanyBankAccount {
  return {
    id: 'cta-1',
    description: 'Itaú movimento',
    bankCode: '341',
    bankName: 'Itaú',
    agency: '1234',
    agencyDigit: null,
    account: '98765',
    accountDigit: '0',
    accountType: 'CORRENTE',
    pixKey: null,
    branchId: null,
    providerId: null,
    credentialId: null,
    openingBalance: '0.00',
    currentBalance: '15230.45',
    balanceDate: null,
    allowsPayment: true,
    allowsReceipt: true,
    isDefault: true,
    isActive: true,
    note: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...sobrescrever,
  };
}

function ordem(sobrescrever: Partial<PaymentTransaction> = {}): PaymentTransaction {
  return {
    id: 'ord-1',
    companyId: '11111111-1111-4111-8111-111111111111',
    bankAccountId: 'cta-1',
    providerId: 'prv-manual',
    installmentId: null,
    direction: 'DEBITO',
    method: 'PIX',
    status: 'ENVIADA',
    amount: '1250.00',
    description: 'Aluguel setembro',
    scheduledFor: null,
    executedAt: '2026-09-10T13:00:00.000Z',
    confirmedAt: null,
    payeeName: 'Imobiliária Central',
    payeeDocument: '12345678000190',
    payeeBankCode: null,
    payeeAgency: null,
    payeeAccount: null,
    pixKey: 'financeiro@central.com.br',
    barcode: null,
    idempotencyKey: '0f8fad5b-d9cb-469f-a165-70867728950e',
    externalId: 'E-778899',
    endToEndId: null,
    errorCode: null,
    errorMessage: null,
    attempts: 1,
    maxAttempts: 5,
    cancellable: false,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: '2026-09-10T12:59:00.000Z',
    updatedAt: '2026-09-10T13:00:00.000Z',
    bankAccount: { id: 'cta-1', description: 'Itaú movimento', bankCode: '341', account: '98765' },
    settlements: [],
    ...sobrescrever,
  };
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

function erroHttp(status: number, message: string) {
  return [{ statusCode: status, message }, { status, statusText: 'Erro' }] as const;
}

// ---------------------------------------------------------------------------

describe('regras de bancos espelhadas do backend', () => {
  it('exige o destino de cada modalidade, como `assertPayee` (RF-062)', () => {
    const base = {
      method: 'PIX' as const,
      pixKey: '',
      barcode: '',
      payeeBankCode: '',
      payeeAgency: '',
      payeeAccount: '',
      payeeDocument: '',
    };
    expect(problemaFavorecido(base)).toBe('Pagamento PIX exige a chave do favorecido.');
    expect(problemaFavorecido({ ...base, pixKey: 'a@b.com' })).toBeNull();
    expect(problemaFavorecido({ ...base, method: 'BOLETO', barcode: '1234' })).toContain('44');
    expect(problemaFavorecido({ ...base, method: 'BOLETO', barcode: '2'.repeat(47) })).toBeNull();
    expect(
      problemaFavorecido({ ...base, method: 'TED', payeeBankCode: '001', payeeAgency: '1' }),
    ).toBe('Transferência exige banco, agência, conta e CPF/CNPJ do favorecido.');
    expect(
      problemaFavorecido({
        ...base,
        method: 'DOC',
        payeeBankCode: '001',
        payeeAgency: '1',
        payeeAccount: '2',
        payeeDocument: '123.456.789-09',
      }),
    ).toBeNull();
    expect(problemaFavorecido({ ...base, method: 'TRANSFERENCIA_INTERNA' })).toBe(
      'Transferência interna exige a conta do favorecido.',
    );
  });

  it('cancela a ordem que não saiu sempre, e a enviada só se o provedor suportar (RF-065)', () => {
    expect(aceitaCancelamento({ status: 'AGENDADA', cancellable: false })).toBe(true);
    expect(aceitaCancelamento({ status: 'ENFILEIRADA', cancellable: false })).toBe(true);
    expect(aceitaCancelamento({ status: 'ENVIADA', cancellable: false })).toBe(false);
    expect(aceitaCancelamento({ status: 'PROCESSANDO', cancellable: true })).toBe(true);
    expect(aceitaCancelamento({ status: 'CONFIRMADA', cancellable: true })).toBe(false);
    expect(aceitaConsulta({ status: 'ENVIADA', externalId: null })).toBe(false);
    expect(aceitaConsulta({ status: 'CONFIRMADA', externalId: 'E-1' })).toBe(false);
  });

  it('traduz os filtros sem mandar parâmetro vazio', () => {
    expect(consultaOrdem({ q: '', status: '', from: '2026-09-01', to: '2026-09-30' })).toEqual({
      q: '',
      status: undefined,
      method: undefined,
      direction: undefined,
      bankAccountId: undefined,
      createdFrom: '2026-09-01',
      createdTo: '2026-09-30',
    });
    expect(consultaConta({ q: 'itau', situacao: 'false', habilitacao: 'pagar' })).toEqual({
      q: 'itau',
      isActive: false,
      allowsPayment: true,
      allowsReceipt: undefined,
    });
  });

  it('confere conta, extrato e linha do tempo antes de gastar requisição', () => {
    const form = {
      description: 'Conta',
      bankCode: '34',
      bankName: '',
      agency: '1',
      agencyDigit: '',
      account: '2',
      accountDigit: '',
      accountType: 'CORRENTE' as const,
      pixKey: '',
      providerId: '',
      credentialId: '',
      openingBalance: '0.00',
      allowsPayment: true,
      allowsReceipt: true,
      isDefault: false,
      note: '',
    };
    expect(problemaConta(form, true)).toBe('O código do banco deve ter de 3 a 5 dígitos.');
    // Na edição, banco/agência/conta não vão ao servidor e não são conferidos.
    expect(problemaConta(form, false)).toBeNull();

    expect(problemaExtrato(new File(['x'], 'extrato.pdf'))).toContain('OFX, CSV ou CNAB 240');
    expect(problemaExtrato(new File([], 'extrato.ofx'))).toBe('Arquivo vazio.');
    expect(problemaExtrato(new File(['OFXHEADER'], 'EXTRATO.OFX'))).toBeNull();

    const etapas = etapasOrdem(ordem({ status: 'CONFIRMADA', confirmedAt: '2026-09-10T14:00:00Z' }));
    expect(etapas.map((e) => e.rotulo)).toEqual(['Criada', 'Enviada ao banco', 'Confirmada']);
    expect(etapas.at(-1)?.estado).toBe('feita');
  });
});

// ---------------------------------------------------------------------------

interface Formulario {
  mudar(campo: string, valor: unknown): void;
  revisar(): void;
  enviar(): void;
  problema(): string | null;
  confirmando(): boolean;
}

function abrirFormulario(permissoes = ['payments:CREATE', 'company-bank-accounts:READ']) {
  const sessao = prepararSessao(permissoes);
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(PaymentFormPage);
  fixture.detectChanges();

  const contas = sessao.mock.expectOne((r) => r.url === `${BASE}/banking/accounts`);
  expect(contas.request.params.get('isActive')).toBe('true');
  contas.flush(paginado([conta()]));

  const pagina = fixture.componentInstance as unknown as Formulario;
  return { ...sessao, fixture, pagina, navegar };
}

describe('emissão de ordem com Idempotency-Key (UI-043/UI-044)', () => {
  it('envia só o destino da modalidade, com a chave e a empresa ativa', () => {
    const { mock, pagina, navegar, companyId } = abrirFormulario();

    pagina.mudar('method', 'PIX');
    pagina.mudar('amount', '1250.00');
    pagina.revisar();
    expect(pagina.problema()).toBe('Pagamento PIX exige a chave do favorecido.');
    expect(pagina.confirmando()).toBe(false);
    mock.verify();

    pagina.mudar('barcode', '1'.repeat(44)); // sobra de outra modalidade
    pagina.mudar('pixKey', ' financeiro@central.com.br ');
    pagina.mudar('payeeDocument', '123.456.789-09');
    pagina.revisar();
    expect(pagina.confirmando()).toBe(true);
    pagina.enviar();

    const envio = mock.expectOne(`${BASE}/banking/payments`);
    expect(envio.request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(envio.request.headers.get('x-company-id')).toBe(companyId);
    expect(envio.request.body).toMatchObject({
      bankAccountId: 'cta-1',
      direction: 'DEBITO',
      method: 'PIX',
      amount: '1250.00',
      pixKey: 'financeiro@central.com.br',
      payeeDocument: '12345678909',
    });
    expect(envio.request.body.barcode).toBeUndefined();
    envio.flush(ordem({ id: 'ord-9' }));

    expect(navegar).toHaveBeenCalledWith(['/bancos/ordens', 'ord-9']);
  });

  it('reusa a chave no retry da mesma ordem e troca depois de recusa definitiva (RF-067)', () => {
    const { mock, pagina } = abrirFormulario();
    const url = `${BASE}/banking/payments`;

    pagina.mudar('method', 'TRANSFERENCIA_INTERNA');
    pagina.mudar('amount', '10.00');
    pagina.mudar('payeeAccount', '5555');
    pagina.enviar();
    const primeira = mock.expectOne(url);
    const chave = primeira.request.headers.get('Idempotency-Key');
    // Queda de rede: o servidor pode ou não ter criado — só a chave resolve.
    primeira.error(new ProgressEvent('error'));

    // Mudar o formulário depois de falha de rede não troca a chave.
    pagina.mudar('description', 'Reserva');
    pagina.enviar();
    const segunda = mock.expectOne(url);
    expect(segunda.request.headers.get('Idempotency-Key')).toBe(chave);
    segunda.flush(...erroHttp(400, 'O provedor MANUAL não executa pagamentos por TRANSFERENCIA_INTERNA.'));

    // Recusa definitiva: nada foi criado, e a ordem corrigida é outra ordem.
    pagina.mudar('method', 'PIX');
    pagina.mudar('pixKey', 'a@b.com');
    pagina.enviar();
    expect(mock.expectOne(url).request.headers.get('Idempotency-Key')).not.toBe(chave);
  });

  it('agenda para data futura e recusa data passada (RF-063)', () => {
    const { mock, pagina } = abrirFormulario();

    pagina.mudar('method', 'PIX');
    pagina.mudar('amount', '99.90');
    pagina.mudar('pixKey', 'a@b.com');
    pagina.mudar('scheduledFor', '2020-01-01');
    pagina.enviar();
    expect(pagina.problema()).toBe('A data de agendamento não pode estar no passado.');
    mock.verify();

    pagina.mudar('scheduledFor', '2999-12-31');
    pagina.enviar();
    expect(mock.expectOne(`${BASE}/banking/payments`).request.body.scheduledFor).toBe('2999-12-31');
  });
});

// ---------------------------------------------------------------------------

interface Detalhe {
  podeCancelar(): boolean;
  podeConsultar(): boolean;
  podeConfirmar(): boolean;
  abrirCancelamento(): void;
  motivo: { set(valor: string): void };
  cancelar(): void;
  consultar(): void;
  abrirConfirmacao(): void;
  mudarConfirmacao(campo: string, valor: string): void;
  confirmar(): void;
}

async function abrirDetalhe(permissoes: string[], registro: PaymentTransaction) {
  const sessao = prepararSessao(permissoes, [rota('ord-1')]);
  const fixture = TestBed.createComponent(PaymentDetailPage);
  fixture.detectChanges();
  sessao.mock.expectOne(`${BASE}/banking/payments/ord-1`).flush(registro);
  await fixture.whenStable();
  fixture.detectChanges();
  return { ...sessao, fixture, pagina: fixture.componentInstance as unknown as Detalhe };
}

const TODAS_ACOES = ['payments:READ', 'payments:UPDATE', 'payments:DELETE', 'payments:APPROVE'];

describe('detalhe da ordem: situação, ações e comprovante (UI-044/UI-045)', () => {
  it('só oferece o que a ordem e o perfil permitem', async () => {
    const enviada = await abrirDetalhe(TODAS_ACOES, ordem());
    // Enviada a provedor que não cancela depois do envio.
    expect(enviada.pagina.podeCancelar()).toBe(false);
    expect(enviada.pagina.podeConsultar()).toBe(true);
    expect(enviada.fixture.nativeElement.textContent).toContain('E-778899');
    TestBed.resetTestingModule();

    const somenteLeitura = await abrirDetalhe(['payments:READ'], ordem({ status: 'AGENDADA' }));
    expect(somenteLeitura.pagina.podeCancelar()).toBe(false);
    expect(somenteLeitura.pagina.podeConfirmar()).toBe(false);
  });

  it('cancela com motivo e passa a mostrar a ordem devolvida pelo servidor (RF-065)', async () => {
    const { mock, pagina, fixture } = await abrirDetalhe(
      TODAS_ACOES,
      ordem({ status: 'AGENDADA', scheduledFor: '2026-09-20', externalId: null }),
    );
    expect(pagina.podeCancelar()).toBe(true);

    pagina.abrirCancelamento();
    pagina.motivo.set('abc');
    pagina.cancelar();
    mock.verify();

    pagina.motivo.set('  Fornecedor pediu adiamento  ');
    pagina.cancelar();
    const cancelamento = mock.expectOne(`${BASE}/banking/payments/ord-1/cancel`);
    expect(cancelamento.request.body).toEqual({ reason: 'Fornecedor pediu adiamento' });
    cancelamento.flush(
      ordem({ status: 'CANCELADA', cancellationReason: 'Fornecedor pediu adiamento' }),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Cancelada');
    expect(pagina.podeCancelar()).toBe(false);
  });

  it('consulta o banco e confirma manualmente com o identificador (RF-064)', async () => {
    const { mock, pagina } = await abrirDetalhe(TODAS_ACOES, ordem());

    pagina.consultar();
    mock.expectOne(`${BASE}/banking/payments/ord-1/sync`).flush(ordem({ status: 'PROCESSANDO' }));

    pagina.abrirConfirmacao();
    pagina.mudarConfirmacao('confirmedAt', '2026-09-10T15:30');
    pagina.mudarConfirmacao('note', 'Confirmado por telefone');
    pagina.confirmar();
    const confirmacao = mock.expectOne(`${BASE}/banking/payments/ord-1/confirm`);
    expect(confirmacao.request.body.externalId).toBe('E-778899');
    expect(confirmacao.request.body.confirmedAt).toMatch(/^2026-09-10T\d{2}:30:00\.000Z$/);
    expect(confirmacao.request.body.note).toBe('Confirmado por telefone');
  });

  it('mostra o comprovante da ordem confirmada, com os identificadores do banco (RF-068)', async () => {
    const { fixture } = await abrirDetalhe(
      ['payments:READ'],
      ordem({
        status: 'CONFIRMADA',
        confirmedAt: '2026-09-10T14:00:00.000Z',
        endToEndId: 'E60701190202609101400abc',
      }),
    );
    const comprovante: HTMLElement | null = fixture.nativeElement.querySelector('.comprovante');
    expect(comprovante?.textContent).toContain('Comprovante de pagamento');
    expect(comprovante?.textContent).toContain('E-778899');
    expect(comprovante?.textContent).toContain('E60701190202609101400abc');
    expect(comprovante?.textContent).toContain('Empresa Fantasma Teste LTDA');
  });
});

// ---------------------------------------------------------------------------

interface Contas {
  abrir(conta: CompanyBankAccount | null): void;
  mudar(campo: string, valor: unknown): void;
  salvar(): void;
}

describe('contas bancárias (UI-042)', () => {
  it('lista o saldo informado pelo banco e cadastra só com dígitos', async () => {
    const { mock } = prepararSessao(['company-bank-accounts:READ', 'company-bank-accounts:CREATE']);
    const fixture = TestBed.createComponent(BankAccountsPage);
    fixture.detectChanges();
    mock
      .expectOne((r) => r.url === `${BASE}/banking/accounts`)
      .flush(paginado([conta(), conta({ id: 'cta-2', balanceDate: '2026-09-09', isDefault: false })]));
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Sem extrato importado');
    expect(texto).toContain('Extrato de 09/09/2026');

    const pagina = fixture.componentInstance as unknown as Contas;
    pagina.abrir(null);
    // Sem `integration-credentials:READ`, o catálogo de provedores não é pedido.
    mock.verify();

    pagina.mudar('description', ' Bradesco folha ');
    pagina.mudar('bankCode', '237');
    pagina.mudar('agency', '12.34');
    pagina.mudar('account', '55.667-8');
    pagina.salvar();

    const criacao = mock.expectOne(`${BASE}/banking/accounts`);
    expect(criacao.request.method).toBe('POST');
    expect(criacao.request.body).toMatchObject({
      description: 'Bradesco folha',
      bankCode: '237',
      agency: '1234',
      account: '556678',
      openingBalance: '0.00',
    });
    expect(criacao.request.body.currentBalance).toBeUndefined();
  });

  it('edita sem mandar banco, agência e conta, que são a identidade da conta', async () => {
    const { mock } = prepararSessao(['company-bank-accounts:READ', 'company-bank-accounts:UPDATE']);
    const fixture = TestBed.createComponent(BankAccountsPage);
    fixture.detectChanges();
    mock.expectOne((r) => r.url === `${BASE}/banking/accounts`).flush(paginado([conta()]));

    const pagina = fixture.componentInstance as unknown as Contas;
    pagina.abrir(conta());
    pagina.mudar('allowsPayment', false);
    pagina.salvar();

    const alteracao = mock.expectOne(`${BASE}/banking/accounts/cta-1`);
    expect(alteracao.request.method).toBe('PATCH');
    expect(alteracao.request.body.allowsPayment).toBe(false);
    expect(alteracao.request.body.bankCode).toBeUndefined();
    expect(alteracao.request.body.agency).toBeUndefined();
    expect(alteracao.request.body.account).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

interface Extratos {
  selecionar(arquivo: File | null): void;
  importar(): void;
}

describe('extratos e movimentos (UI-046)', () => {
  function abrirExtratos() {
    const sessao = prepararSessao([
      'bank-statements:READ',
      'bank-statements:CREATE',
      'company-bank-accounts:READ',
    ]);
    const fixture = TestBed.createComponent(StatementsPage);
    fixture.detectChanges();
    sessao.mock.expectOne((r) => r.url === `${BASE}/banking/statements`).flush(paginado([]));
    sessao.mock.expectOne((r) => r.url === `${BASE}/banking/accounts`).flush(paginado([conta()]));
    return { ...sessao, fixture, pagina: fixture.componentInstance as unknown as Extratos };
  }

  it('importa o arquivo como multipart e mostra as contagens do servidor', async () => {
    const { mock, pagina, fixture } = abrirExtratos();

    pagina.selecionar(new File(['OFXHEADER:100'], 'itau-setembro.ofx'));
    pagina.importar();

    const envio = mock.expectOne(`${BASE}/banking/statements/import`);
    const corpo = envio.request.body as FormData;
    expect(corpo).toBeInstanceOf(FormData);
    expect(corpo.get('bankAccountId')).toBe('cta-1');
    expect((corpo.get('file') as File).name).toBe('itau-setembro.ofx');
    // Sem formato escolhido, o backend deduz pelo conteúdo.
    expect(corpo.has('format')).toBe(false);
    envio.flush({
      id: 'ext-1',
      bankAccountId: 'cta-1',
      format: 'OFX',
      fileName: 'itau-setembro.ofx',
      fileHash: 'abc',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-15',
      openingBalance: '100.00',
      closingBalance: '250.00',
      totalCount: 12,
      importedCount: 9,
      duplicateCount: 3,
      status: 'CONCLUIDO',
      error: null,
      createdAt: '2026-09-15T10:00:00.000Z',
    });
    mock.expectOne((r) => r.url === `${BASE}/banking/statements`).flush(paginado([]));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      '9 de 12 lançamentos importados, 3 já existiam e foram ignorados.',
    );
  });

  it('recusa extensão desconhecida sem requisição e exibe o 409 de arquivo repetido', async () => {
    const { mock, pagina, fixture } = abrirExtratos();

    pagina.selecionar(new File(['%PDF'], 'extrato.pdf'));
    pagina.importar();
    mock.verify();

    pagina.selecionar(new File(['OFXHEADER'], 'extrato.ofx'));
    pagina.importar();
    mock
      .expectOne(`${BASE}/banking/statements/import`)
      .flush(...erroHttp(409, 'Este arquivo já foi importado nesta conta em 2026-09-01.'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Este arquivo já foi importado');
  });

  it('abre os movimentos filtrados pela importação de origem', () => {
    const { mock } = prepararSessao(['bank-statements:READ'], [
      rota(null, { statementImportId: 'ext-1' }),
    ]);
    const fixture = TestBed.createComponent(BankTransactionsPage);
    fixture.detectChanges();

    const consulta = mock.expectOne((r) => r.url === `${BASE}/banking/bank-transactions`);
    expect(consulta.request.params.get('statementImportId')).toBe('ext-1');
    expect(consulta.request.params.has('bankAccountId')).toBe(false);
    // Sem `company-bank-accounts:READ`, as contas não são pedidas.
    mock.verify();
  });
});

// ---------------------------------------------------------------------------

interface Operacoes {
  abrirReprocesso(target: 'JOB' | 'WEBHOOK', id: string, descricao: string): void;
  motivo: { set(valor: string): void };
  reprocessar(): void;
}

describe('painel de operações assíncronas (UI-047)', () => {
  it('mostra fila, ordens em falha e reprocessa só o que o backend aceita', async () => {
    const { mock } = prepararSessao([
      'payments:READ',
      'integrations:READ',
      'integration-events:READ',
      'integration-events:APPROVE',
    ]);
    const fixture = TestBed.createComponent(OperationsPage);
    fixture.detectChanges();

    mock.expectOne(`${BASE}/integrations/health`).flush({
      totals: { total: 1, active: 1, suspended: 0, degraded: 0, errors24h: 2 },
      queue: { window: '7d', byStatus: { FALHA: 2, CONCLUIDO: 40 }, pending: 3, failed: 2 },
      webhooks: { window: '7d', byStatus: {}, pending: 0, failed: 1 },
    });
    mock
      .expectOne((r) => r.url === `${BASE}/banking/payments` && r.params.get('status') === 'FALHA')
      .flush(paginado([ordem({ status: 'FALHA', errorMessage: 'Conta do favorecido encerrada' })]));
    mock
      .expectOne(
        (r) => r.url === `${BASE}/banking/payments` && r.params.get('status') === 'ENFILEIRADA',
      )
      .flush(paginado([]));
    const jobs = mock.expectOne(
      (r) => r.url === `${BASE}/integrations/failed` && r.params.get('target') === 'JOB',
    );
    expect(jobs.request.params.get('q')).toBe('payment.');
    jobs.flush(
      paginado([
        {
          id: 'job-1',
          queue: 'pagamentos',
          name: 'payment.send',
          status: 'FALHA',
          attempts: 5,
          maxAttempts: 5,
          error: 'timeout',
          lastErrorAt: '2026-09-10T13:00:00.000Z',
          createdAt: '2026-09-10T12:00:00.000Z',
          finishedAt: null,
          correlationId: null,
        },
      ]),
    );
    mock
      .expectOne((r) => r.url === `${BASE}/integrations/failed` && r.params.get('target') === 'WEBHOOK')
      .flush(
        paginado([
          {
            id: 'wh-1',
            providerId: 'prv-1',
            eventType: 'pix.confirmado',
            externalId: 'E-1',
            signatureValid: false,
            status: 'FALHA',
            attempts: 1,
            error: 'assinatura',
            receivedAt: '2026-09-10T13:00:00.000Z',
            processedAt: null,
          },
        ]),
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Conta do favorecido encerrada');
    expect(texto).toContain('Envio de ordem ao banco');
    expect(texto).toContain('5 de 5');
    // Webhook de assinatura inválida não ganha botão de reprocessar.
    expect(texto).toContain('Assinatura inválida');

    const pagina = fixture.componentInstance as unknown as Operacoes;
    pagina.abrirReprocesso('JOB', 'job-1', 'Envio de ordem ao banco');
    pagina.motivo.set('Provedor voltou');
    pagina.reprocessar();
    pagina.reprocessar(); // duplo clique: uma requisição só
    const reprocesso = mock.expectOne(`${BASE}/integrations/reprocess`);
    expect(reprocesso.request.body).toEqual({ target: 'JOB', id: 'job-1', reason: 'Provedor voltou' });
    reprocesso.flush({ target: 'JOB', sourceId: 'job-1', jobId: null, queue: 'pagamentos' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('já tinha um reprocessamento pendente');
  });

  it('não consulta a fila nem as falhas sem as permissões de integração', () => {
    const { mock } = prepararSessao(['payments:READ']);
    const fixture = TestBed.createComponent(OperationsPage);
    fixture.detectChanges();

    expect(mock.match((r) => r.url.startsWith(`${BASE}/integrations`))).toHaveLength(0);
    expect(mock.match((r) => r.url === `${BASE}/banking/payments`)).toHaveLength(2);
  });
});
