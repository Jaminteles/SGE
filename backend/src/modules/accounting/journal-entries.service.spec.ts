import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccountingPeriodStatus, JournalLineType, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingPeriodsService } from './accounting-periods.service';
import { CreateJournalEntryDto } from './dto/journal-entry.dto';
import { JournalEntriesService } from './journal-entries.service';

const DEBIT_ACCOUNT = '11111111-1111-1111-1111-111111111111';
const CREDIT_ACCOUNT = '22222222-2222-2222-2222-222222222222';

function buildService(
  options: {
    accounts?: Record<string, unknown>[];
    period?: Record<string, unknown> | null;
    entry?: Record<string, unknown> | null;
  } = {},
) {
  const created: Record<string, unknown>[] = [];

  const accounts = options.accounts ?? [
    { id: DEBIT_ACCOUNT, code: '4.1.01.001', acceptsEntry: true, isActive: true },
    { id: CREDIT_ACCOUNT, code: '1.1.01.001', acceptsEntry: true, isActive: true },
  ];

  const prisma = {
    db: {
      ledgerAccount: { findMany: jest.fn().mockResolvedValue(accounts) },
      journalEntry: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({
            id: 'lanc-1',
            number: 10n,
            branchId: null,
            periodId: 'per-1',
            entryDate: new Date('2026-03-10'),
            competenceDate: new Date('2026-03-10'),
            history: data.history,
            totalAmount: data.totalAmount,
            origin: data.origin,
            originId: data.originId ?? null,
            settlementId: null,
            fiscalDocumentId: null,
            batch: null,
            reversalOfId: data.reversalOfId ?? null,
            isReversed: false,
            exported: false,
            exportedAt: null,
            createdAt: new Date(),
            lines: [],
          });
        }),
        findFirst: jest.fn().mockResolvedValue(options.entry ?? null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({ id: 'lanc-0' }),
      },
    },
    transaction: jest.fn((fn: () => Promise<unknown>) => fn()),
  } as unknown as PrismaService;

  const periods = {
    findFor: jest
      .fn()
      .mockResolvedValue(
        options.period === undefined
          ? { id: 'per-1', year: 2026, month: 3, status: AccountingPeriodStatus.ABERTO }
          : options.period,
      ),
  } as unknown as AccountingPeriodsService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return { service: new JournalEntriesService(prisma, periods, audit), created, prisma, audit };
}

const dto: CreateJournalEntryDto = {
  entryDate: '2026-03-10',
  history: 'Energia elétrica de março',
  lines: [
    { accountId: DEBIT_ACCOUNT, type: JournalLineType.DEBITO, amount: '1500.00' },
    { accountId: CREDIT_ACCOUNT, type: JournalLineType.CREDITO, amount: '1500.00' },
  ],
};

describe('JournalEntriesService.create', () => {
  it('grava valores como Decimal e usa a soma dos débitos como total', async () => {
    const { service, created } = buildService();

    await service.create('empresa-1', dto, 'user-1');

    expect(created[0].totalAmount).toBeInstanceOf(Prisma.Decimal);
    expect((created[0].totalAmount as Prisma.Decimal).toFixed(2)).toBe('1500.00');
    expect(created[0].companyId).toBe('empresa-1');
  });

  it('recusa lançamento desbalanceado, com a diferença na mensagem', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        {
          ...dto,
          lines: [
            { accountId: DEBIT_ACCOUNT, type: JournalLineType.DEBITO, amount: '1500.00' },
            { accountId: CREDIT_ACCOUNT, type: JournalLineType.CREDITO, amount: '1400.00' },
          ],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa partida em conta sintética', async () => {
    const { service } = buildService({
      accounts: [
        { id: DEBIT_ACCOUNT, code: '4.1', acceptsEntry: false, isActive: true },
        { id: CREDIT_ACCOUNT, code: '1.1.01.001', acceptsEntry: true, isActive: true },
      ],
    });

    await expect(service.create('empresa-1', dto, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa conta de outra empresa sem dizer que ela existe', async () => {
    const { service } = buildService({ accounts: [] });

    await expect(service.create('empresa-1', dto, 'user-1')).rejects.toThrow(
      'Conta contábil não encontrada nesta empresa.',
    );
  });

  it('recusa lançar em período fechado (RN-008)', async () => {
    const { service } = buildService({
      period: { id: 'per-1', year: 2026, month: 3, status: AccountingPeriodStatus.FECHADO },
    });

    await expect(service.create('empresa-1', dto, 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('recusa competência sem período aberto no exercício', async () => {
    const { service } = buildService({ period: null });

    await expect(service.create('empresa-1', dto, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa partida com valor não positivo: o sinal é do lado, não do valor', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        {
          ...dto,
          lines: [
            { accountId: DEBIT_ACCOUNT, type: JournalLineType.DEBITO, amount: '0.00' },
            { accountId: CREDIT_ACCOUNT, type: JournalLineType.CREDITO, amount: '0.00' },
          ],
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('audita o lançamento gravado', async () => {
    const { service, audit } = buildService();

    await service.create('empresa-1', dto, 'user-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'CRIACAO', entity: 'lancamento_contabil' }),
    );
  });
});

describe('JournalEntriesService.reverse', () => {
  const reversible = {
    id: 'lanc-0',
    number: 9n,
    branchId: null,
    isReversed: false,
    competenceDate: new Date('2026-03-10'),
    lines: [
      {
        accountId: DEBIT_ACCOUNT,
        type: JournalLineType.DEBITO,
        amount: new Prisma.Decimal('1500.00'),
        costCenterId: null,
        extraHistory: null,
      },
      {
        accountId: CREDIT_ACCOUNT,
        type: JournalLineType.CREDITO,
        amount: new Prisma.Decimal('1500.00'),
        costCenterId: null,
        extraHistory: null,
      },
    ],
  };

  it('inverte o lado de cada partida e aponta para o estornado', async () => {
    const { service, created } = buildService({ entry: reversible });

    await service.reverse('empresa-1', 'lanc-0', { reason: 'Valor errado' }, 'user-1');

    const lines = (created[0].lines as { create: { type: JournalLineType }[] }).create;
    expect(lines[0].type).toBe(JournalLineType.CREDITO);
    expect(lines[1].type).toBe(JournalLineType.DEBITO);
    expect(created[0].reversalOfId).toBe('lanc-0');
    expect(created[0].origin).toBe('ESTORNO');
  });

  it('recusa estornar duas vezes o mesmo lançamento', async () => {
    const { service } = buildService({ entry: { ...reversible, isReversed: true } });

    await expect(
      service.reverse('empresa-1', 'lanc-0', { reason: 'Valor errado' }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('devolve 404 para lançamento de outra empresa', async () => {
    const { service } = buildService({ entry: null });

    await expect(
      service.reverse('empresa-1', 'de-outra', { reason: 'Valor errado' }, 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
