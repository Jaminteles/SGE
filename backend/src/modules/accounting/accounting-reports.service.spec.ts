import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AccountNature, JournalLineType, LedgerAccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingReportsService } from './accounting-reports.service';

const D = (value: string) => new Prisma.Decimal(value);

interface GroupRow {
  accountId?: string;
  type: JournalLineType;
  _sum: { amount: Prisma.Decimal };
}

/**
 * O `groupBy` é respondido conforme o recorte pedido: `lt` é o saldo anterior,
 * `gte` é o movimento da janela. É essa distinção que os testes de saldo
 * dependem, e ela mora no `where` da chamada.
 */
function buildService(options: {
  opening?: GroupRow[];
  movements?: GroupRow[];
  accounts?: Record<string, unknown>[];
  account?: Record<string, unknown> | null;
  lines?: Record<string, unknown>[];
}) {
  const prisma = {
    db: {
      ledgerAccount: {
        findFirst: jest.fn().mockResolvedValue(options.account ?? null),
        findMany: jest.fn().mockResolvedValue(options.accounts ?? []),
      },
      journalEntryLine: {
        groupBy: jest.fn(({ where }: { where: { entry: { competenceDate: object } } }) => {
          const filter = where.entry.competenceDate as { lt?: Date; gte?: Date };
          return Promise.resolve(filter.lt ? (options.opening ?? []) : (options.movements ?? []));
        }),
        findMany: jest.fn().mockResolvedValue(options.lines ?? []),
      },
    },
  } as unknown as PrismaService;

  return { service: new AccountingReportsService(prisma), prisma };
}

const range = { from: '2026-03-01', to: '2026-03-31' };

describe('AccountingReportsService.trialBalance', () => {
  it('apura o saldo na natureza da conta: credora soma pelo crédito', async () => {
    const { service } = buildService({
      opening: [{ accountId: 'c1', type: JournalLineType.CREDITO, _sum: { amount: D('1000.00') } }],
      movements: [
        { accountId: 'c1', type: JournalLineType.CREDITO, _sum: { amount: D('500.00') } },
        { accountId: 'c1', type: JournalLineType.DEBITO, _sum: { amount: D('200.00') } },
      ],
      accounts: [
        {
          id: 'c1',
          code: '2.1.01.001',
          name: 'Fornecedores',
          type: LedgerAccountType.PASSIVO,
          nature: AccountNature.CREDORA,
        },
      ],
    });

    const result = await service.trialBalance('empresa-1', range);

    expect(result.rows[0].openingBalance.toFixed(2)).toBe('1000.00');
    expect(result.rows[0].closingBalance.toFixed(2)).toBe('1300.00');
  });

  it('acusa desbalanceamento comparando os totais de débito e crédito', async () => {
    const { service } = buildService({
      movements: [
        { accountId: 'c1', type: JournalLineType.DEBITO, _sum: { amount: D('100.00') } },
        { accountId: 'c1', type: JournalLineType.CREDITO, _sum: { amount: D('90.00') } },
      ],
      accounts: [
        {
          id: 'c1',
          code: '1.1',
          name: 'Caixa',
          type: LedgerAccountType.ATIVO,
          nature: AccountNature.DEVEDORA,
        },
      ],
    });

    const result = await service.trialBalance('empresa-1', range);

    expect(result.balanced).toBe(false);
    expect(result.totalDebit.toFixed(2)).toBe('100.00');
  });

  it('devolve totais em Decimal, nunca em number', async () => {
    const { service } = buildService({ movements: [], accounts: [] });

    const result = await service.trialBalance('empresa-1', range);

    expect(result.totalDebit).toBeInstanceOf(Prisma.Decimal);
    expect(result.totalCredit).toBeInstanceOf(Prisma.Decimal);
  });

  it('recusa janela invertida', async () => {
    const { service } = buildService({});

    await expect(
      service.trialBalance('empresa-1', { from: '2026-03-31', to: '2026-03-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AccountingReportsService.incomeStatement', () => {
  it('separa receita, custo e despesa e apura o resultado', async () => {
    const { service } = buildService({
      movements: [
        { accountId: 'r1', type: JournalLineType.CREDITO, _sum: { amount: D('10000.00') } },
        { accountId: 'k1', type: JournalLineType.DEBITO, _sum: { amount: D('4000.00') } },
        { accountId: 'd1', type: JournalLineType.DEBITO, _sum: { amount: D('2500.00') } },
      ],
      accounts: [
        {
          id: 'r1',
          code: '3.1',
          name: 'Receita de serviços',
          type: LedgerAccountType.RECEITA,
          nature: AccountNature.CREDORA,
        },
        {
          id: 'k1',
          code: '5.1',
          name: 'Custo dos serviços',
          type: LedgerAccountType.CUSTO,
          nature: AccountNature.DEVEDORA,
        },
        {
          id: 'd1',
          code: '4.1',
          name: 'Despesas administrativas',
          type: LedgerAccountType.DESPESA,
          nature: AccountNature.DEVEDORA,
        },
      ],
    });

    const result = await service.incomeStatement('empresa-1', range);

    expect(result.revenue.total.toFixed(2)).toBe('10000.00');
    expect(result.grossResult.toFixed(2)).toBe('6000.00');
    expect(result.netResult.toFixed(2)).toBe('3500.00');
  });
});

describe('AccountingReportsService.ledger', () => {
  it('parte do saldo anterior e acumula linha a linha', async () => {
    const { service } = buildService({
      account: {
        id: 'c1',
        code: '1.1.01.001',
        name: 'Caixa',
        type: LedgerAccountType.ATIVO,
        nature: AccountNature.DEVEDORA,
      },
      opening: [{ type: JournalLineType.DEBITO, _sum: { amount: D('500.00') } }],
      movements: [{ type: JournalLineType.DEBITO, _sum: { amount: D('300.00') } }],
      lines: [
        {
          type: JournalLineType.DEBITO,
          amount: D('300.00'),
          extraHistory: null,
          entry: {
            id: 'l1',
            number: 5n,
            competenceDate: new Date('2026-03-05'),
            history: 'Recebimento',
            origin: 'TITULO_BAIXA',
          },
        },
      ],
    });

    const result = await service.ledger('empresa-1', { ...range, accountId: 'c1' });

    expect(result.openingBalance.toFixed(2)).toBe('500.00');
    expect(result.rows[0].balance.toFixed(2)).toBe('800.00');
    expect(result.closingBalance.toFixed(2)).toBe('800.00');
  });

  it('devolve 404 para conta de outra empresa', async () => {
    const { service } = buildService({ account: null });

    await expect(
      service.ledger('empresa-1', { ...range, accountId: 'de-outra' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
