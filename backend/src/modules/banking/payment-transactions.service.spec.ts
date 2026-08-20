import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  EntryType,
  PaymentMethodType,
  PaymentTransactionStatus,
  Prisma,
  TransactionDirection,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { CompanyAccountsService } from './company-accounts.service';
import { PaymentSettlementsService } from './payment-settlements.service';
import { ProviderResolver } from './providers/provider-resolver.service';
import { ProviderCapabilities, ProviderError } from './providers/payment-provider.port';
import { PaymentTransactionsService } from './payment-transactions.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

const CAPABILITIES: ProviderCapabilities = {
  pix: true,
  boleto: true,
  ted: true,
  doc: true,
  transferencia_interna: true,
  cancelamento: true,
  consulta: true,
  webhook: true,
};

interface Scenario {
  capabilities?: ProviderCapabilities;
  /** Situação corrente da transação carregada por `load`. */
  status?: PaymentTransactionStatus;
  cancellable?: boolean;
  externalId?: string | null;
  installment?: {
    type: EntryType;
    balance: string;
  } | null;
  /** Outra ordem viva para a mesma parcela. */
  inFlight?: { id: string } | null;
  send?: jest.Mock;
  cancel?: jest.Mock;
  query?: jest.Mock;
}

function buildService(scenario: Scenario = {}) {
  const updates: Record<string, unknown>[] = [];
  const created: Record<string, unknown>[] = [];
  const enqueued: Record<string, unknown>[] = [];
  const settled: Record<string, unknown>[] = [];

  const row = {
    id: 'tx-1',
    companyId: 'empresa-1',
    bankAccountId: 'conta-1',
    providerId: 'prov-1',
    installmentId: 'parcela-1',
    direction: TransactionDirection.DEBITO,
    method: PaymentMethodType.PIX,
    status: scenario.status ?? PaymentTransactionStatus.ENFILEIRADA,
    amount: new Prisma.Decimal('1000.00'),
    description: 'Pagamento',
    scheduledFor: null,
    executedAt: null,
    confirmedAt: null,
    payeeName: 'Fornecedor',
    payeeDocument: '12345678000199',
    payeeBankCode: null,
    payeeAgency: null,
    payeeAccount: null,
    pixKey: 'chave@pix',
    barcode: null,
    idempotencyKey: 'chave-idem-1',
    externalId: scenario.externalId === undefined ? null : scenario.externalId,
    endToEndId: null,
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    maxAttempts: 5,
    cancellable: scenario.cancellable ?? true,
    cancelledAt: null,
    cancellationReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    bankAccount: {
      id: 'conta-1',
      bankCode: '341',
      agency: '1234',
      account: '567890',
      accountDigit: '1',
      pixKey: null,
      providerId: 'prov-1',
      credentialId: 'cred-1',
    },
  };

  const prisma = {
    db: {
      paymentTransaction: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ ...row, ...data, id: 'tx-1' });
        }),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return Promise.resolve({
            id: 'tx-1',
            companyId: 'empresa-1',
            bankAccountId: 'conta-1',
            installmentId: row.installmentId,
            amount: row.amount,
            method: row.method,
            description: row.description,
            confirmedAt: (data.confirmedAt as Date) ?? null,
            status: data.status ?? row.status,
          });
        }),
        findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
          if (args.where.status) {
            return Promise.resolve(scenario.inFlight ?? null);
          }
          return Promise.resolve(row);
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      financialInstallment: {
        findFirst: jest.fn(() =>
          Promise.resolve(
            scenario.installment === null
              ? null
              : {
                  status: 'ABERTA',
                  balance: new Prisma.Decimal(scenario.installment?.balance ?? '1000.00'),
                  entry: { type: scenario.installment?.type ?? EntryType.PAGAR },
                },
          ),
        ),
      },
    },
    transaction: jest.fn((fn: () => Promise<unknown>) => fn()),
  } as unknown as PrismaService;

  const accounts = {
    findForPayment: jest.fn().mockResolvedValue({
      id: 'conta-1',
      bankCode: '341',
      agency: '1234',
      account: '567890',
      accountDigit: '1',
      pixKey: null,
      providerId: 'prov-1',
      credentialId: 'cred-1',
      isActive: true,
      allowsPayment: true,
      allowsReceipt: true,
    }),
  } as unknown as CompanyAccountsService;

  const provider = {
    send: scenario.send ?? jest.fn().mockResolvedValue({ status: 'ENVIADA', externalId: 'ext-1' }),
    cancel: scenario.cancel ?? jest.fn().mockResolvedValue({ status: 'CANCELADA' }),
    query: scenario.query ?? jest.fn().mockResolvedValue({ status: 'CONFIRMADA' }),
  };

  const providers = {
    resolveForAccount: jest.fn().mockResolvedValue({
      providerId: 'prov-1',
      provider,
      context: {
        companyId: 'empresa-1',
        providerCode: 'SANDBOX',
        capabilities: scenario.capabilities ?? CAPABILITIES,
        credentials: {},
        environment: 'SANDBOX',
      },
    }),
  } as unknown as ProviderResolver;

  const settlements = {
    settle: jest.fn((tx: Record<string, unknown>) => {
      settled.push(tx);
      return Promise.resolve('baixa-1');
    }),
  } as unknown as PaymentSettlementsService;

  const idempotency = {
    run: jest.fn(async (params: { execute: () => Promise<{ response: unknown }> }) => {
      const outcome = await params.execute();
      return { replayed: false, response: outcome.response };
    }),
  } as unknown as IdempotencyService;

  const queue = {
    enqueue: jest.fn((params: Record<string, unknown>) => {
      enqueued.push(params);
      return Promise.resolve('job-1');
    }),
  } as unknown as JobQueueService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  const service = new PaymentTransactionsService(
    prisma,
    accounts,
    providers,
    settlements,
    idempotency,
    queue,
    audit,
  );

  return { service, updates, created, enqueued, settled, provider, row };
}

function paymentDto(overrides: Partial<CreatePaymentDto> = {}): CreatePaymentDto {
  return {
    bankAccountId: 'conta-1',
    method: PaymentMethodType.PIX,
    amount: '1000.00',
    pixKey: 'chave@pix',
    ...overrides,
  } as CreatePaymentDto;
}

describe('PaymentTransactionsService — criação (RF-062/RF-063/RF-069)', () => {
  it('cria a ordem, enfileira o envio e marca como enfileirada', async () => {
    const { service, created, enqueued, updates } = buildService();

    await service.create(
      'empresa-1',
      paymentDto({ installmentId: undefined }),
      'user-1',
      'chave-idem-1',
    );

    expect(created[0]).toMatchObject({ idempotencyKey: 'chave-idem-1', cancellable: true });
    expect(enqueued[0]).toMatchObject({ name: 'payment.send', companyId: 'empresa-1' });
    expect(updates[0]).toMatchObject({ status: PaymentTransactionStatus.ENFILEIRADA });
  });

  it('mantém a ordem agendada e não a enfileira para agora (RF-063)', async () => {
    const { service, created, enqueued, updates } = buildService();
    const scheduledFor = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

    await service.create(
      'empresa-1',
      paymentDto({ scheduledFor, installmentId: undefined }),
      'user-1',
      'chave-idem-1',
    );

    expect(created[0]).toMatchObject({ status: PaymentTransactionStatus.AGENDADA });
    expect(enqueued[0].scheduledFor).toBeInstanceOf(Date);
    expect(updates).toHaveLength(0);
  });

  it('recusa agendamento no passado', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        paymentDto({ scheduledFor: '2020-01-01', installmentId: undefined }),
        'user-1',
        'chave-idem-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige a chave PIX no método PIX e o código de barras no boleto', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        paymentDto({ pixKey: undefined, installmentId: undefined }),
        'user-1',
        'chave-idem-1',
      ),
    ).rejects.toThrow(/chave do favorecido/);

    await expect(
      service.create(
        'empresa-1',
        paymentDto({
          method: PaymentMethodType.BOLETO,
          pixKey: undefined,
          installmentId: undefined,
        }),
        'user-1',
        'chave-idem-1',
      ),
    ).rejects.toThrow(/código de barras/);
  });

  it('recusa modalidade que o provedor não executa (RF-061)', async () => {
    const { service } = buildService({ capabilities: { ...CAPABILITIES, pix: false } });

    await expect(
      service.create(
        'empresa-1',
        paymentDto({ installmentId: undefined }),
        'user-1',
        'chave-idem-1',
      ),
    ).rejects.toThrow(/não executa pagamentos por PIX/);
  });

  it('recusa modalidade fora das executadas por integração', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        paymentDto({ method: PaymentMethodType.DINHEIRO, installmentId: undefined }),
        'user-1',
        'chave-idem-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa pagar um título a receber (sentido incompatível)', async () => {
    const { service } = buildService({
      installment: { type: EntryType.RECEBER, balance: '500.00' },
    });

    await expect(
      service.create(
        'empresa-1',
        paymentDto({ installmentId: 'parcela-1' }),
        'user-1',
        'chave-idem-1',
      ),
    ).rejects.toThrow(/exige uma ordem de credito/i);
  });

  it('recusa segunda ordem viva para a mesma parcela (RN-004)', async () => {
    const { service } = buildService({ inFlight: { id: 'tx-anterior' } });

    await expect(
      service.create(
        'empresa-1',
        paymentDto({ installmentId: 'parcela-1' }),
        'user-1',
        'chave-idem-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa parcela sem saldo em aberto', async () => {
    const { service } = buildService({ installment: { type: EntryType.PAGAR, balance: '0.00' } });

    await expect(
      service.create(
        'empresa-1',
        paymentDto({ installmentId: 'parcela-1' }),
        'user-1',
        'chave-idem-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa parcela de outra empresa (RN-001)', async () => {
    const { service } = buildService({ installment: null });

    await expect(
      service.create(
        'empresa-1',
        paymentDto({ installmentId: 'parcela-1' }),
        'user-1',
        'chave-idem-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PaymentTransactionsService — envio pelo worker (RF-069/RF-070)', () => {
  it('grava o identificador externo devolvido pelo provedor (RF-068)', async () => {
    const { service, updates } = buildService();

    await service.dispatch('empresa-1', 'tx-1');

    expect(updates[0]).toMatchObject({
      status: PaymentTransactionStatus.ENVIADA,
      externalId: 'ext-1',
    });
  });

  it('não reenvia ordem que já saiu — o job repetido é inofensivo', async () => {
    const send = jest.fn();
    const { service, updates } = buildService({ status: PaymentTransactionStatus.ENVIADA, send });

    await service.dispatch('empresa-1', 'tx-1');

    expect(send).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('encerra em FALHA quando o provedor recusa definitivamente', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(new ProviderError('Saldo insuficiente', 'SEM_SALDO', false));
    const { service, updates } = buildService({ send });

    await service.dispatch('empresa-1', 'tx-1');

    expect(updates[0]).toMatchObject({
      status: PaymentTransactionStatus.FALHA,
      errorCode: 'SEM_SALDO',
    });
  });

  it('propaga falha retentável sem escrever nada — a fila reagenda (RF-070)', async () => {
    const send = jest.fn().mockRejectedValue(new ProviderError('Fora do ar', 'INDISPONIVEL', true));
    const { service, updates } = buildService({ send });

    await expect(service.dispatch('empresa-1', 'tx-1')).rejects.toBeInstanceOf(ProviderError);
    expect(updates).toHaveLength(0);
  });

  it('gera a baixa quando o provedor confirma na hora', async () => {
    const send = jest.fn().mockResolvedValue({ status: 'CONFIRMADA', externalId: 'ext-1' });
    const { service, settled } = buildService({ send });

    await service.dispatch('empresa-1', 'tx-1');

    expect(settled).toHaveLength(1);
  });
});

describe('PaymentTransactionsService — cancelamento (RF-065)', () => {
  it('cancela sem chamar o provedor quando a ordem ainda não saiu', async () => {
    const cancel = jest.fn();
    const { service, updates } = buildService({
      status: PaymentTransactionStatus.AGENDADA,
      cancel,
    });

    await service.cancel(
      'empresa-1',
      'tx-1',
      { reason: 'Fornecedor cancelou a entrega' },
      'user-1',
    );

    expect(cancel).not.toHaveBeenCalled();
    expect(updates[0]).toMatchObject({ status: PaymentTransactionStatus.CANCELADA });
  });

  it('recusa cancelar ordem enviada quando o provedor não suporta', async () => {
    const { service } = buildService({
      status: PaymentTransactionStatus.ENVIADA,
      cancellable: false,
      externalId: 'ext-1',
    });

    await expect(
      service.cancel('empresa-1', 'tx-1', { reason: 'Mudança de decisão' }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('não marca como cancelada se o provedor recusar o cancelamento', async () => {
    const cancel = jest
      .fn()
      .mockRejectedValue(new ProviderError('Já liquidado', 'NAO_CANCELAVEL', false));
    const { service, updates } = buildService({
      status: PaymentTransactionStatus.ENVIADA,
      externalId: 'ext-1',
      cancel,
    });

    await expect(
      service.cancel('empresa-1', 'tx-1', { reason: 'Mudança de decisão' }, 'user-1'),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(updates).toHaveLength(0);
  });

  it('recusa cancelar ordem já confirmada', async () => {
    const { service } = buildService({ status: PaymentTransactionStatus.CONFIRMADA });

    await expect(
      service.cancel('empresa-1', 'tx-1', { reason: 'Tarde demais' }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PaymentTransactionsService — confirmação e consulta (RF-064)', () => {
  it('confirmar duas vezes não gera segunda baixa', async () => {
    const { service, settled } = buildService({ status: PaymentTransactionStatus.CONFIRMADA });

    await service.confirmManually('empresa-1', 'tx-1', {}, 'user-1');

    expect(settled).toHaveLength(0);
  });

  it('a confirmação manual gera a baixa do título', async () => {
    const { service, settled, updates } = buildService({
      status: PaymentTransactionStatus.ENVIADA,
    });

    await service.confirmManually('empresa-1', 'tx-1', { externalId: 'ext-9' }, 'user-1');

    expect(updates[0]).toMatchObject({ status: PaymentTransactionStatus.CONFIRMADA });
    expect(settled).toHaveLength(1);
  });

  it('recusa consulta em provedor que não a suporta', async () => {
    const { service } = buildService({
      status: PaymentTransactionStatus.ENVIADA,
      externalId: 'ext-1',
      capabilities: { ...CAPABILITIES, consulta: false },
    });

    await expect(service.sync('empresa-1', 'tx-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa consulta sem identificador externo', async () => {
    const { service } = buildService({
      status: PaymentTransactionStatus.ENVIADA,
      externalId: null,
    });

    await expect(service.sync('empresa-1', 'tx-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('PaymentTransactionsService — isolamento multiempresa (RN-001)', () => {
  it('procura a ordem sempre com a empresa ativa no filtro', async () => {
    const { service } = buildService();
    const notFound = new PaymentTransactionsService(
      {
        db: { paymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) } },
      } as unknown as PrismaService,
      {} as CompanyAccountsService,
      {} as ProviderResolver,
      {} as PaymentSettlementsService,
      {} as IdempotencyService,
      {} as JobQueueService,
      {} as AuditService,
    );

    await expect(notFound.load('outra-empresa', 'tx-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.load('empresa-1', 'tx-1')).resolves.toMatchObject({ id: 'tx-1' });
  });
});
