import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntryType, JournalLineType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JournalEntriesService, PostingInput } from './journal-entries.service';
import { JournalPostingsService } from './journal-postings.service';

const CASH_ACCOUNT = 'conta-caixa';
const EXPENSE_ACCOUNT = 'conta-despesa';

function settlement(
  overrides: Record<string, unknown> = {},
  entryOverrides: Record<string, unknown> = {},
) {
  return {
    id: 'baixa-1',
    settlementDate: new Date('2026-03-10'),
    totalAmount: new Prisma.Decimal('1500.00'),
    bankAccountId: 'banco-1',
    isReversed: false,
    installment: {
      number: 1,
      entry: {
        type: EntryType.PAGAR,
        number: '123',
        description: 'Energia elétrica',
        branchId: null,
        costCenterId: null,
        ledgerAccountId: null,
        category: { code: '4.1.01', ledgerAccountId: EXPENSE_ACCOUNT },
        ...entryOverrides,
      },
    },
    ...overrides,
  };
}

function buildService(
  options: {
    row?: Record<string, unknown> | null;
    bankAccount?: Record<string, unknown> | null;
    existing?: Record<string, unknown> | null;
  } = {},
) {
  const posted: PostingInput[] = [];

  const prisma = {
    db: {
      settlement: {
        findFirst: jest
          .fn()
          .mockResolvedValue(options.row === undefined ? settlement() : options.row),
      },
      companyBankAccount: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options.bankAccount === undefined
              ? { description: 'Itaú CC', ledgerAccountId: CASH_ACCOUNT }
              : options.bankAccount,
          ),
      },
    },
  } as unknown as PrismaService;

  const entries = {
    findByOrigin: jest.fn().mockResolvedValue(options.existing ?? null),
    post: jest.fn((_companyId: string, input: PostingInput) => {
      posted.push(input);
      return Promise.resolve({ id: 'lanc-1' });
    }),
    reverse: jest.fn().mockResolvedValue({ id: 'lanc-2' }),
  } as unknown as JournalEntriesService;

  return { service: new JournalPostingsService(prisma, entries), posted, entries };
}

describe('JournalPostingsService.postSettlement', () => {
  it('debita a contrapartida e credita o caixa numa baixa de PAGAR', async () => {
    const { service, posted } = buildService();

    await service.postSettlement('empresa-1', 'baixa-1', 'user-1');

    expect(posted[0].lines).toEqual([
      expect.objectContaining({ accountId: EXPENSE_ACCOUNT, type: JournalLineType.DEBITO }),
      expect.objectContaining({ accountId: CASH_ACCOUNT, type: JournalLineType.CREDITO }),
    ]);
    expect(posted[0].origin).toBe('TITULO_BAIXA');
    expect(posted[0].originId).toBe('baixa-1');
  });

  it('inverte os lados numa baixa de RECEBER', async () => {
    const { service, posted } = buildService({
      row: settlement({}, { type: EntryType.RECEBER }),
    });

    await service.postSettlement('empresa-1', 'baixa-1', 'user-1');

    expect(posted[0].lines[0]).toMatchObject({
      accountId: CASH_ACCOUNT,
      type: JournalLineType.DEBITO,
    });
    expect(posted[0].lines[1]).toMatchObject({
      accountId: EXPENSE_ACCOUNT,
      type: JournalLineType.CREDITO,
    });
  });

  it('mantém o valor em Decimal, sem passar por float', async () => {
    const { service, posted } = buildService({
      row: settlement({ totalAmount: new Prisma.Decimal('1234.56') }),
    });

    await service.postSettlement('empresa-1', 'baixa-1', 'user-1');

    expect(posted[0].lines[0].amount).toBeInstanceOf(Prisma.Decimal);
    expect(posted[0].lines[0].amount.toFixed(2)).toBe('1234.56');
  });

  it('é idempotente: a mesma baixa devolve o lançamento que já existe', async () => {
    const { service, entries, posted } = buildService({ existing: { id: 'lanc-9' } });

    const result = await service.postSettlement('empresa-1', 'baixa-1', 'user-1');

    expect(result).toEqual({ id: 'lanc-9' });
    expect(entries.post).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);
  });

  it('prefere a conta do título à da categoria: é a classificação mais específica', async () => {
    const { service, posted } = buildService({
      row: settlement({}, { ledgerAccountId: 'conta-do-titulo' }),
    });

    await service.postSettlement('empresa-1', 'baixa-1', 'user-1');

    expect(posted[0].lines[0].accountId).toBe('conta-do-titulo');
  });

  it('recusa contabilizar sem classificação em vez de escolher uma conta plausível', async () => {
    const { service } = buildService({
      row: settlement({}, { category: { code: '4.1.01', ledgerAccountId: null } }),
    });

    await expect(service.postSettlement('empresa-1', 'baixa-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa contabilizar com conta bancária sem classificação', async () => {
    const { service } = buildService({
      bankAccount: { description: 'Itaú CC', ledgerAccountId: null },
    });

    await expect(service.postSettlement('empresa-1', 'baixa-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa contabilizar baixa estornada', async () => {
    const { service } = buildService({ row: settlement({ isReversed: true }) });

    await expect(service.postSettlement('empresa-1', 'baixa-1', 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('devolve 404 para baixa de outra empresa: id na rota não atravessa tenant', async () => {
    const { service } = buildService({ row: null });

    await expect(service.postSettlement('empresa-1', 'de-outra', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('JournalPostingsService.reverseSettlementPosting', () => {
  it('estorna o lançamento gerado pela baixa', async () => {
    const { service, entries } = buildService({ existing: { id: 'lanc-9' } });

    await service.reverseSettlementPosting('empresa-1', 'baixa-1', 'Baixa desfeita', 'user-1');

    expect(entries.reverse).toHaveBeenCalledWith(
      'empresa-1',
      'lanc-9',
      { reason: 'Baixa desfeita' },
      'user-1',
    );
  });

  it('devolve 404 quando a baixa nunca foi contabilizada', async () => {
    const { service } = buildService({ existing: null });

    await expect(
      service.reverseSettlementPosting('empresa-1', 'baixa-1', 'Baixa desfeita', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
