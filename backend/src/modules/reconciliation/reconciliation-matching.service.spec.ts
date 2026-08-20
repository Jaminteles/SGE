import { EntryType, Prisma, TransactionDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BankTransactionIdentifierService } from './bank-transaction-identifier.service';
import { ReconciliationMatchingService } from './reconciliation-matching.service';

type InstallmentRow = ReturnType<typeof installment>;

function installment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'parcela-1',
    number: 1,
    totalInstallments: 1,
    dueDate: new Date('2026-08-05T00:00:00.000Z'),
    balance: new Prisma.Decimal('1500.00'),
    bankIdentifier: null as string | null,
    digitableLine: null as string | null,
    barcode: null as string | null,
    entry: {
      id: 'titulo-1',
      number: 'TIT-1',
      type: EntryType.RECEBER,
      description: 'Serviço prestado',
      documentReference: null as string | null,
      partnerId: 'parceiro-1',
      partner: { legalName: 'ACME LTDA', tradeName: 'ACME' },
    },
    ...overrides,
  };
}

function buildService(rows: InstallmentRow[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = {
    db: { financialInstallment: { findMany } },
  } as unknown as PrismaService;

  const identifier = {
    resolve: jest.fn().mockResolvedValue({ kind: 'PIX', identifiedAt: '2026-08-05T00:00:00.000Z' }),
  } as unknown as BankTransactionIdentifierService;

  return { service: new ReconciliationMatchingService(prisma, identifier), findMany };
}

function movement(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'mov-1',
    movementDate: new Date('2026-08-05T00:00:00.000Z'),
    direction: TransactionDirection.CREDITO,
    amount: new Prisma.Decimal('1500.00'),
    description: 'PIX RECEBIDO ACME',
    document: null,
    counterpartName: 'ACME',
    ...overrides,
  } as Parameters<ReconciliationMatchingService['findCandidates']>[1];
}

const options = { dayTolerance: 5, valueTolerance: new Prisma.Decimal(0), limit: 5 };

describe('ReconciliationMatchingService', () => {
  it('pontua 100 quando valor, data, documento e parceiro conferem', async () => {
    const { service } = buildService([
      installment({ bankIdentifier: '123456789', entry: installment().entry }),
    ]);

    const [best] = await service.findCandidates(
      'empresa-1',
      movement({ document: '123456789' }),
      options,
      { partnerId: 'parceiro-1' },
    );

    expect(best.score.toFixed(2)).toBe('100.00');
    expect(best.difference.isZero()).toBe(true);
  });

  it('procura título a receber para crédito e a pagar para débito', async () => {
    const { service, findMany } = buildService([]);

    await service.findCandidates('empresa-1', movement(), options);
    expect(findMany.mock.calls[0][0].where.entry.type).toBe(EntryType.RECEBER);

    await service.findCandidates(
      'empresa-1',
      movement({ direction: TransactionDirection.DEBITO }),
      options,
    );
    expect(findMany.mock.calls[1][0].where.entry.type).toBe(EntryType.PAGAR);
  });

  it('desconta o que já foi conciliado antes de procurar a parcela', async () => {
    const { service, findMany } = buildService([]);

    await service.findCandidates(
      'empresa-1',
      movement({ amount: new Prisma.Decimal('3000.00') }),
      options,
      undefined,
      new Prisma.Decimal('1000.00'),
    );

    const balance = findMany.mock.calls[0][0].where.balance;
    expect(balance.gte.toFixed(2)).toBe('2000.00');
    expect(balance.lte.toFixed(2)).toBe('2000.00');
  });

  it('não devolve candidata quando o movimento já foi conciliado por inteiro', async () => {
    const { service, findMany } = buildService([installment()]);

    const candidates = await service.findCandidates(
      'empresa-1',
      movement(),
      options,
      undefined,
      new Prisma.Decimal('1500.00'),
    );

    expect(candidates).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('penaliza a distância do vencimento e ordena pela pontuação', async () => {
    const { service } = buildService([
      installment({ id: 'parcela-longe', dueDate: new Date('2026-08-01T00:00:00.000Z') }),
      installment({ id: 'parcela-perto', dueDate: new Date('2026-08-05T00:00:00.000Z') }),
    ]);

    const candidates = await service.findCandidates('empresa-1', movement(), options);

    expect(candidates.map((candidate) => candidate.installmentId)).toEqual([
      'parcela-perto',
      'parcela-longe',
    ]);
    expect(candidates[1].score.lessThan(candidates[0].score)).toBe(true);
  });

  it('exclui do candidato a parcela já conciliada com o mesmo movimento', async () => {
    const { service, findMany } = buildService([]);

    await service.findCandidates('empresa-1', movement(), options);

    expect(findMany.mock.calls[0][0].where.reconciliations).toEqual({
      none: { bankTransactionId: 'mov-1', undoneAt: null },
    });
  });

  it('registra a diferença quando o valor está apenas dentro da tolerância', async () => {
    const { service } = buildService([installment({ balance: new Prisma.Decimal('1490.00') })]);

    const [best] = await service.findCandidates('empresa-1', movement(), {
      ...options,
      valueTolerance: new Prisma.Decimal('20.00'),
    });

    expect(best.difference.toFixed(2)).toBe('10.00');
    expect(best.score.lessThan(100)).toBe(true);
  });
});
