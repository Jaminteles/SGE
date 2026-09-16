import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { MatchingPage } from '../conciliacao/matching-page';
import { PaymentFormPage } from '../bancos/payment-form-page';
import { EntryDetailPage } from '../financeiro/entry-detail-page';
import { config } from '../core/lib/config';
import { BASE, entrarPelaTela, iniciarAplicacao, responderPendentes, telaAtiva } from './harness';

/**
 * Fluxos críticos de dinheiro, ponta a ponta (RNF-012 — UI-087).
 *
 * Cada um começa no login e termina na requisição que move dinheiro. O que
 * estes testes provam, e os de tela não provam, é o encadeamento: sessão,
 * empresa ativa, guarda de permissão, carregamento preguiçoso do módulo e
 * cabeçalhos — tudo junto, na ordem em que o usuário faz.
 */

const CONTA = {
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
};

const PARCELA = {
  id: 'parc-1',
  entryId: 'tit-1',
  number: 1,
  totalInstallments: 1,
  dueDate: '2026-09-10',
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
};

const TITULO = {
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
  issueDate: '2026-09-01',
  competenceDate: '2026-09-01',
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
  createdAt: '2026-09-01T12:00:00.000Z',
  installments: [PARCELA],
};

const MOVIMENTO = '22222222-2222-4222-8222-222222222222';

const SUGESTOES = {
  bankTransactionId: MOVIMENTO,
  movementDate: '2026-09-10',
  direction: 'CREDITO',
  amount: '400.00',
  reconciliationStatus: 'NAO_CONCILIADO',
  identification: {
    kind: 'PIX',
    counterpartName: 'ALFA LTDA',
    partnerName: 'Alfa',
    partnerId: 'prc-1',
  },
  candidates: [
    {
      installmentId: 'parc-1',
      entryId: 'tit-1',
      entryNumber: 'REC-0042',
      entryType: 'RECEBER',
      partnerId: 'prc-1',
      partnerName: 'Alfa',
      description: 'Venda 42',
      installmentNumber: 1,
      totalInstallments: 1,
      dueDate: '2026-09-10',
      balance: '400.00',
      dayGap: 0,
      difference: '0.00',
      score: '98.0',
      reasons: ['valor exato', 'pago na data do vencimento'],
    },
  ],
};

/** Entra pela tela de login e chega à rota pedida, com o módulo já carregado. */
async function entrarEIr(permissoes: string[], rota: string, respostas: Record<string, object>) {
  const cenario = iniciarAplicacao(permissoes);
  const harness = await RouterTestingHarness.create();

  await harness.navigateByUrl(rota);
  expect(cenario.router.url).toContain('/login');
  await entrarPelaTela(cenario, harness);

  expect(cenario.router.url).toBe(rota);
  responderPendentes(cenario.mock, respostas);
  harness.detectChanges();

  return { cenario, harness };
}

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('fluxo crítico: emissão de ordem de pagamento (UI-087)', () => {
  interface Form {
    mudar(campo: string, valor: unknown): void;
    revisar(): void;
    enviar(): void;
    confirmando(): boolean;
    problema(): string | null;
  }

  it('emite um PIX com chave de idempotência, cabeçalho de empresa e token', async () => {
    const { cenario, harness } = await entrarEIr(
      ['payments:READ', 'payments:CREATE', 'company-bank-accounts:READ'],
      '/bancos/ordens/nova',
      { 'banking/accounts': { data: [CONTA], total: 1, page: 1, pageSize: 100, totalPages: 1 } },
    );

    const form = telaAtiva(harness, PaymentFormPage) as unknown as Form;
    form.mudar('method', 'PIX');
    form.mudar('amount', '1250.00');
    form.mudar('pixKey', 'financeiro@central.com.br');
    form.mudar('payeeName', 'Imobiliária Central');
    expect(form.problema()).toBeNull();

    // A ordem passa pela confirmação: nada de dinheiro sai em um clique só.
    form.revisar();
    expect(form.confirmando()).toBe(true);
    form.enviar();

    const envio = cenario.mock.expectOne(`${BASE}/banking/payments`);
    expect(envio.request.method).toBe('POST');
    // Decimal canônico em string (RN-012) — nunca `number`.
    expect(envio.request.body.amount).toBe('1250.00');
    expect(typeof envio.request.body.amount).toBe('string');
    expect(envio.request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(envio.request.headers.get('Authorization')).toMatch(/^Bearer /);
    expect(envio.request.headers.get(config.companyHeader)).toBe(cenario.empresas[0].companyId);
    envio.flush({ id: 'ord-1', status: 'ENVIADA' });
    await harness.fixture.whenStable();

    // Ordem aceita leva à tela dela — é lá que o acompanhamento continua.
    expect(cenario.router.url).toBe('/bancos/ordens/ord-1');
    responderPendentes(cenario.mock, { 'banking/payments/ord-1': { id: 'ord-1' } });
  });

  it('barra quem tem leitura de ordens mas não pode criar', async () => {
    const cenario = iniciarAplicacao(['payments:READ']);
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/bancos/ordens/nova');
    await entrarPelaTela(cenario, harness);

    expect(cenario.router.url).toContain('/sem-permissao');
    cenario.mock.verify();
  });
});

describe('fluxo crítico: baixa de parcela (UI-087)', () => {
  interface Detalhe {
    abrirBaixa(parcela: unknown): void;
    mudarBaixa(campo: string, valor: unknown): void;
    registrarBaixa(): void;
    problemaBaixa(): string | null;
  }

  it('registra a baixa com chave de idempotência e relê o título do servidor', async () => {
    const { cenario, harness } = await entrarEIr(
      ['financial-entries:READ', 'settlements:CREATE'],
      '/financeiro/titulos/tit-1',
      { 'financial-entries/tit-1': TITULO },
    );

    const detalhe = telaAtiva(harness, EntryDetailPage) as unknown as Detalhe;
    detalhe.abrirBaixa(PARCELA);
    detalhe.mudarBaixa('principalAmount', '400.00');
    expect(detalhe.problemaBaixa()).toBeNull();
    detalhe.registrarBaixa();

    const baixa = cenario.mock.expectOne(
      `${BASE}/financial-entries/tit-1/installments/parc-1/settlements`,
    );
    expect(baixa.request.body.principalAmount).toBe('400.00');
    expect(baixa.request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(baixa.request.headers.get(config.companyHeader)).toBe(cenario.empresas[0].companyId);
    baixa.flush({ id: 'bx-1' });

    // O saldo volta do servidor: a tela não faz a conta por conta própria.
    cenario.mock
      .expectOne(`${BASE}/financial-entries/tit-1`)
      .flush({ ...TITULO, status: 'LIQUIDADO', balance: '0.00', settledAmount: '400.00' });
  });
});

describe('fluxo crítico: conciliação de movimento (UI-087)', () => {
  interface Conciliar {
    escolherParcela(candidata: unknown): void;
    vincular(): void;
    problemaDoVinculo(): string | null;
  }

  it('concilia o movimento com a parcela sugerida', async () => {
    const { cenario, harness } = await entrarEIr(
      ['reconciliation:READ', 'reconciliation:CREATE'],
      `/conciliacao/movimentos/${MOVIMENTO}`,
      { [`reconciliation/bank-transactions/${MOVIMENTO}/suggestions`]: SUGESTOES },
    );

    const tela = telaAtiva(harness, MatchingPage) as unknown as Conciliar;
    tela.escolherParcela(SUGESTOES.candidates[0]);
    expect(tela.problemaDoVinculo()).toBeNull();
    tela.vincular();

    const vinculo = cenario.mock.expectOne(`${BASE}/reconciliation`);
    expect(vinculo.request.method).toBe('POST');
    expect(vinculo.request.body.bankTransactionId).toBe(MOVIMENTO);
    expect(vinculo.request.body.installmentId).toBe('parc-1');
    expect(vinculo.request.body.amount).toBe('400.00');
    expect(vinculo.request.headers.get(config.companyHeader)).toBe(cenario.empresas[0].companyId);
    vinculo.flush({ id: 'con-1' });

    responderPendentes(cenario.mock);
  });
});
