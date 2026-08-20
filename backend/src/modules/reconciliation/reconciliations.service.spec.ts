import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, ReconciliationStatus, TransactionDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ReconciliationsService } from './reconciliations.service';

interface Scenario {
  movement?: Record<string, unknown> | null;
  installment?: Record<string, unknown> | null;
  settlement?: Record<string, unknown> | null;
  alreadyReconciled?: string;
}

function buildService(scenario: Scenario = {}) {
  const created: Record<string, unknown>[] = [];

  const movement =
    scenario.movement === null
      ? null
      : {
          id: 'mov-1',
          bankAccountId: 'conta-1',
          direction: TransactionDirection.CREDITO,
          amount: new Prisma.Decimal('1500.00'),
          movementDate: new Date('2026-08-05T00:00:00.000Z'),
          reconciliationStatus: ReconciliationStatus.NAO_CONCILIADO,
          metadata: {},
          ...scenario.movement,
        };

  const installment =
    scenario.installment === null
      ? null
      : {
          id: 'parcela-1',
          number: 1,
          totalInstallments: 1,
          balance: new Prisma.Decimal('1500.00'),
          status: 'ABERTA',
          entry: { number: 'TIT-1', type: 'RECEBER' },
          ...scenario.installment,
        };

  const prisma = {
    transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({})),
    db: {
      bankTransaction: {
        findFirst: jest.fn().mockResolvedValue(movement),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ metadata: {} }),
        findFirstOrThrow: jest.fn().mockResolvedValue(movement),
        update: jest.fn().mockResolvedValue({ id: 'mov-1' }),
      },
      financialInstallment: { findFirst: jest.fn().mockResolvedValue(installment) },
      settlement: { findFirst: jest.fn().mockResolvedValue(scenario.settlement ?? null) },
      paymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      reconciliation: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: {
            reconciledAmount: scenario.alreadyReconciled
              ? new Prisma.Decimal(scenario.alreadyReconciled)
              : null,
          },
        }),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ id: 'conc-1', ...data });
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 'conc-1' }),
      },
    },
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return { service: new ReconciliationsService(prisma, audit), created, prisma, audit };
}

const dto = { bankTransactionId: 'mov-1', installmentId: 'parcela-1', amount: '1500.00' };

describe('ReconciliationsService.create', () => {
  it('grava o vínculo confirmado, sem diferença, quando os valores fecham', async () => {
    const { service, created } = buildService();

    await service.create('empresa-1', dto, 'usuario-1');

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      companyId: 'empresa-1',
      bankTransactionId: 'mov-1',
      installmentId: 'parcela-1',
      hasDivergence: false,
      confirmed: true,
      confirmedById: 'usuario-1',
    });
    expect((created[0].difference as Prisma.Decimal).isZero()).toBe(true);
  });

  it('recusa conciliar entrada do extrato com título a pagar', async () => {
    const { service } = buildService({
      installment: { entry: { number: 'TIT-1', type: 'PAGAR' } },
    });

    await expect(service.create('empresa-1', dto, 'usuario-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa conciliar saída do extrato com título a receber', async () => {
    const { service } = buildService({
      movement: { direction: TransactionDirection.DEBITO },
    });

    await expect(service.create('empresa-1', dto, 'usuario-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('não deixa a soma dos vínculos vivos passar do valor do movimento', async () => {
    const { service } = buildService({ alreadyReconciled: '1000.00' });

    await expect(service.create('empresa-1', dto, 'usuario-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('exige justificativa quando o valor conciliado difere do lançamento', async () => {
    const { service } = buildService({
      installment: { balance: new Prisma.Decimal('1400.00') },
    });

    await expect(service.create('empresa-1', dto, 'usuario-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('aceita a divergência justificada e a marca para o painel de RF-076', async () => {
    const { service, created } = buildService({
      installment: { balance: new Prisma.Decimal('1400.00') },
    });

    await service.create(
      'empresa-1',
      { ...dto, justification: 'Tarifa de recebimento retida pelo banco' },
      'usuario-1',
    );

    expect(created[0].hasDivergence).toBe(true);
    expect((created[0].difference as Prisma.Decimal).toFixed(2)).toBe('100.00');
  });

  it('exige ao menos um alvo', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', { bankTransactionId: 'mov-1', amount: '10.00' }, 'usuario-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa o movimento de outra empresa como se não existisse', async () => {
    const { service, prisma } = buildService({ movement: null });

    await expect(service.create('empresa-2', dto, 'usuario-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // A empresa ativa entra no `where`, e não é conferida depois de ler a linha:
    // é o que impede enumerar id alheio pela diferença entre 404 e 403.
    expect(prisma.db.bankTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'mov-1', companyId: 'empresa-2' } }),
    );
  });

  it('recusa a parcela de outra empresa como se não existisse', async () => {
    const { service, prisma } = buildService({ installment: null });

    await expect(service.create('empresa-1', dto, 'usuario-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.db.financialInstallment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'parcela-1', companyId: 'empresa-1' } }),
    );
  });

  it('recusa conciliar movimento marcado como ignorado', async () => {
    const { service } = buildService({
      movement: { reconciliationStatus: ReconciliationStatus.IGNORADO },
    });

    await expect(service.create('empresa-1', dto, 'usuario-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('ReconciliationsService.undo', () => {
  it('registra o desfazimento em vez de apagar a linha', async () => {
    const { service, prisma } = buildService();
    (prisma.db.reconciliation.findFirst as jest.Mock).mockResolvedValue({
      id: 'conc-1',
      undoneAt: null,
      bankTransactionId: 'mov-1',
      reconciledAmount: new Prisma.Decimal('1500.00'),
    });

    await service.undo(
      'empresa-1',
      'conc-1',
      { reason: 'Conciliado no título errado' },
      'usuario-2',
    );

    expect(prisma.db.reconciliation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          undoneById: 'usuario-2',
          undoReason: 'Conciliado no título errado',
        }),
      }),
    );
  });

  it('não desfaz duas vezes', async () => {
    const { service, prisma } = buildService();
    (prisma.db.reconciliation.findFirst as jest.Mock).mockResolvedValue({
      id: 'conc-1',
      undoneAt: new Date(),
      bankTransactionId: 'mov-1',
      reconciledAmount: new Prisma.Decimal('1500.00'),
    });

    await expect(
      service.undo('empresa-1', 'conc-1', { reason: 'de novo' }, 'usuario-2'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ReconciliationsService.ignore', () => {
  it('recusa ignorar movimento que tem conciliação viva', async () => {
    const { service } = buildService({ alreadyReconciled: '500.00' });

    await expect(
      service.ignore('empresa-1', 'mov-1', { reason: 'tarifa' }, 'usuario-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('marca como ignorado preservando os metadados já gravados', async () => {
    const { service, prisma } = buildService();
    (prisma.db.bankTransaction.findUniqueOrThrow as jest.Mock).mockResolvedValue({
      metadata: { identification: { kind: 'TARIFA' } },
    });

    await service.ignore('empresa-1', 'mov-1', { reason: 'Tarifa mensal' }, 'usuario-1');

    const update = (prisma.db.bankTransaction.update as jest.Mock).mock.calls[0][0];
    expect(update.data.reconciliationStatus).toBe(ReconciliationStatus.IGNORADO);
    expect(update.data.metadata.identification).toEqual({ kind: 'TARIFA' });
    expect(update.data.metadata.reconciliation).toMatchObject({ reason: 'Tarifa mensal' });
  });
});
