import { AuditEvent, EntryType, PaymentMethodType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { PaymentSettlementsService } from './payment-settlements.service';

interface Scenario {
  /** Baixa já existente para a mesma transação. */
  existing?: { id: string } | null;
  installmentBalance?: string;
}

function buildService(scenario: Scenario = {}) {
  const created: Record<string, unknown>[] = [];
  const events: { event: AuditEvent }[] = [];

  const prisma = {
    db: {
      settlement: {
        findFirst: jest.fn().mockResolvedValue(scenario.existing ?? null),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ id: 'baixa-1' });
        }),
      },
      financialInstallment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'parcela-1',
          number: 1,
          totalInstallments: 3,
          balance: new Prisma.Decimal(scenario.installmentBalance ?? '1000.00'),
          entry: { number: 'TIT-1', type: EntryType.PAGAR },
        }),
      },
    },
  } as unknown as PrismaService;

  const audit = {
    record: jest.fn((input: { event: AuditEvent }) => {
      events.push(input);
      return Promise.resolve();
    }),
  } as unknown as AuditService;

  return { service: new PaymentSettlementsService(prisma, audit), created, events, prisma };
}

function transaction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tx-1',
    companyId: 'empresa-1',
    bankAccountId: 'conta-1',
    installmentId: 'parcela-1',
    amount: new Prisma.Decimal('1000.00'),
    method: PaymentMethodType.PIX,
    description: 'Pagamento fornecedor',
    confirmedAt: new Date('2026-12-10T12:00:00Z'),
    ...overrides,
  } as Parameters<PaymentSettlementsService['settle']>[0];
}

describe('PaymentSettlementsService', () => {
  it('gera a baixa vinculada à transação e à conta debitada', async () => {
    const { service, created, events } = buildService();

    const id = await service.settle(transaction());

    expect(id).toBe('baixa-1');
    expect(created[0]).toMatchObject({
      installmentId: 'parcela-1',
      transactionId: 'tx-1',
      bankAccountId: 'conta-1',
    });
    expect((created[0].principalAmount as Prisma.Decimal).toFixed(2)).toBe('1000.00');
    expect(events[0].event).toBe(AuditEvent.PAGAMENTO);
  });

  it('não gera segunda baixa para a mesma transação — webhook repetido não paga duas vezes', async () => {
    const { service, created } = buildService({ existing: { id: 'baixa-existente' } });

    const id = await service.settle(transaction());

    expect(id).toBe('baixa-existente');
    expect(created).toHaveLength(0);
  });

  it('separa o que excede o saldo como encargo, sem deixar a parcela negativa', async () => {
    const { service, created } = buildService({ installmentBalance: '1000.00' });

    await service.settle(transaction({ amount: new Prisma.Decimal('1030.00') }));

    expect((created[0].principalAmount as Prisma.Decimal).toFixed(2)).toBe('1000.00');
    expect((created[0].interestAmount as Prisma.Decimal).toFixed(2)).toBe('30.00');
  });

  it('paga parcialmente sem inventar encargo quando o valor é menor que o saldo', async () => {
    const { service, created } = buildService({ installmentBalance: '1000.00' });

    await service.settle(transaction({ amount: new Prisma.Decimal('400.00') }));

    expect((created[0].principalAmount as Prisma.Decimal).toFixed(2)).toBe('400.00');
    expect((created[0].interestAmount as Prisma.Decimal).toFixed(2)).toBe('0.00');
  });

  it('ignora ordens que não liquidam parcela alguma', async () => {
    const { service, created } = buildService();

    const id = await service.settle(transaction({ installmentId: null }));

    expect(id).toBeNull();
    expect(created).toHaveLength(0);
  });

  it('procura a parcela dentro da empresa da transação (RN-001)', async () => {
    const { service, prisma } = buildService();

    await service.settle(transaction());

    const findFirst = prisma.db.financialInstallment.findFirst as jest.Mock;
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: 'parcela-1',
      companyId: 'empresa-1',
    });
  });
});
