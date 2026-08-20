import {
  Prisma,
  ReconciliationOrigin,
  ReconciliationStatus,
  TransactionDirection,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { AutoReconciliationService } from './auto-reconciliation.service';
import { BankTransactionIdentifierService } from './bank-transaction-identifier.service';
import { MatchCandidate, ReconciliationMatchingService } from './reconciliation-matching.service';

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    installmentId: 'parcela-1',
    entryId: 'titulo-1',
    entryNumber: 'TIT-1',
    entryType: 'RECEBER',
    partnerId: 'parceiro-1',
    partnerName: 'ACME',
    description: 'Serviço',
    installmentNumber: 1,
    totalInstallments: 1,
    dueDate: new Date('2026-08-05T00:00:00.000Z'),
    balance: new Prisma.Decimal('1500.00'),
    dayGap: 0,
    difference: new Prisma.Decimal('0.00'),
    score: new Prisma.Decimal('100.00'),
    reasons: ['valor idêntico ao saldo da parcela'],
    ...overrides,
  } as MatchCandidate;
}

function movement(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'mov-1',
    bankAccountId: 'conta-1',
    movementDate: new Date('2026-08-05T00:00:00.000Z'),
    direction: TransactionDirection.CREDITO,
    amount: new Prisma.Decimal('1500.00'),
    description: 'PIX RECEBIDO ACME',
    document: null,
    counterpartName: 'ACME',
    counterpartDocument: null,
    reconciliationStatus: ReconciliationStatus.NAO_CONCILIADO,
    ...overrides,
  };
}

function buildService(options: {
  movements?: Record<string, unknown>[];
  rules?: Record<string, unknown>[];
  candidates?: MatchCandidate[];
  alreadyReconciled?: string;
}) {
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];

  const prisma = {
    db: {
      reconciliationRule: { findMany: jest.fn().mockResolvedValue(options.rules ?? []) },
      bankTransaction: {
        findMany: jest.fn().mockResolvedValue(options.movements ?? [movement()]),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          updated.push(data);
          return Promise.resolve({ id: 'mov-1' });
        }),
      },
      companyBankAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'conta-1' }) },
      reconciliation: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: {
            reconciledAmount: options.alreadyReconciled
              ? new Prisma.Decimal(options.alreadyReconciled)
              : null,
          },
        }),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ id: 'conc-1' });
        }),
      },
    },
  } as unknown as PrismaService;

  const matching = {
    findCandidates: jest.fn().mockResolvedValue(options.candidates ?? []),
  } as unknown as ReconciliationMatchingService;

  const identifier = {
    resolve: jest.fn().mockResolvedValue({ kind: 'PIX', identifiedAt: 'now' }),
  } as unknown as BankTransactionIdentifierService;

  const queue = {
    enqueue: jest.fn().mockResolvedValue('job-1'),
  } as unknown as JobQueueService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return {
    service: new AutoReconciliationService(prisma, matching, identifier, queue, audit),
    created,
    updated,
    prisma,
    queue,
  };
}

describe('AutoReconciliationService.run', () => {
  it('confirma sozinho a correspondência inequívoca e sem diferença', async () => {
    const { service, created } = buildService({ candidates: [candidate()] });

    const summary = await service.run('empresa-1', {
      bankAccountId: 'conta-1',
      from: '2026-08-01',
      to: '2026-08-31',
    });

    expect(summary.reconciled).toBe(1);
    expect(created[0]).toMatchObject({
      confirmed: true,
      origin: ReconciliationOrigin.AUTOMATICA_EXATA,
    });
  });

  it('deixa como sugestão quando a pontuação não é inequívoca', async () => {
    const { service, created } = buildService({
      candidates: [candidate({ score: new Prisma.Decimal('70.00') })],
    });

    const summary = await service.run('empresa-1', {
      bankAccountId: 'conta-1',
      from: '2026-08-01',
      to: '2026-08-31',
    });

    expect(summary.suggested).toBe(1);
    expect(created[0]).toMatchObject({ confirmed: false });
  });

  it('não confirma quando há empate entre candidatas', async () => {
    const { service, created } = buildService({
      candidates: [candidate(), candidate({ installmentId: 'parcela-2' })],
    });

    await service.run('empresa-1', {
      bankAccountId: 'conta-1',
      from: '2026-08-01',
      to: '2026-08-31',
    });

    expect(created[0].confirmed).toBe(false);
  });

  it('respeita o piso de confiança da regra que autoriza conciliar', async () => {
    const rule = {
      id: 'regra-1',
      name: 'PIX de clientes',
      conditions: { descriptionContains: 'PIX' },
      actions: { autoReconcile: true, minScore: '80.00' },
      valueTolerance: new Prisma.Decimal('0'),
      dayTolerance: 5,
    };

    const abaixo = buildService({
      rules: [rule],
      candidates: [candidate({ score: new Prisma.Decimal('75.00') })],
    });
    await abaixo.service.run('empresa-1', {
      bankAccountId: 'conta-1',
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(abaixo.created[0]).toMatchObject({
      confirmed: false,
      origin: ReconciliationOrigin.AUTOMATICA_REGRA,
      ruleId: 'regra-1',
    });

    const acima = buildService({
      rules: [rule],
      candidates: [candidate({ score: new Prisma.Decimal('85.00') })],
    });
    await acima.service.run('empresa-1', {
      bankAccountId: 'conta-1',
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(acima.created[0].confirmed).toBe(true);
  });

  it('ignora o movimento quando a regra manda, sem criar vínculo', async () => {
    const { service, created, updated } = buildService({
      rules: [
        {
          id: 'regra-tarifa',
          name: 'Tarifas',
          conditions: { descriptionContains: 'TARIFA' },
          actions: { markIgnored: true },
          valueTolerance: new Prisma.Decimal('0'),
          dayTolerance: 0,
        },
      ],
      movements: [movement({ description: 'TARIFA MANUTENCAO DE CONTA' })],
    });

    const summary = await service.run('empresa-1', {
      bankAccountId: 'conta-1',
      from: '2026-08-01',
      to: '2026-08-31',
    });

    expect(summary.ignored).toBe(1);
    expect(created).toHaveLength(0);
    expect(updated[0]).toMatchObject({ reconciliationStatus: ReconciliationStatus.IGNORADO });
  });

  it('casa a condição de descrição sem depender de acento ou caixa', async () => {
    const { service, updated } = buildService({
      rules: [
        {
          id: 'regra-1',
          name: 'Manutenção',
          conditions: { descriptionContains: 'manutenção' },
          actions: { markIgnored: true },
          valueTolerance: new Prisma.Decimal('0'),
          dayTolerance: 0,
        },
      ],
      movements: [movement({ description: 'TARIFA MANUTENCAO DE CONTA' })],
    });

    await service.run('empresa-1', {
      bankAccountId: 'conta-1',
      from: '2026-08-01',
      to: '2026-08-31',
    });

    expect(updated[0]).toMatchObject({ reconciliationStatus: ReconciliationStatus.IGNORADO });
  });

  it('pula o movimento já conciliado por inteiro', async () => {
    const { service, created } = buildService({
      candidates: [candidate()],
      alreadyReconciled: '1500.00',
    });

    const summary = await service.run('empresa-1', {
      bankAccountId: 'conta-1',
      from: '2026-08-01',
      to: '2026-08-31',
    });

    expect(created).toHaveLength(0);
    expect(summary.untouched).toBe(1);
  });

  it('não interrompe a varredura quando um movimento falha', async () => {
    const { service, prisma } = buildService({
      movements: [movement({ id: 'mov-1' }), movement({ id: 'mov-2' })],
      candidates: [candidate()],
    });
    (prisma.db.reconciliation.create as jest.Mock)
      .mockRejectedValueOnce(new Error('conflito no banco'))
      .mockResolvedValueOnce({ id: 'conc-2' });

    const summary = await service.run('empresa-1', {
      bankAccountId: 'conta-1',
      from: '2026-08-01',
      to: '2026-08-31',
    });

    expect(summary.examined).toBe(2);
    expect(summary.reconciled).toBe(1);
    expect(summary.untouched).toBe(1);
  });
});

describe('AutoReconciliationService.enqueue', () => {
  it('dedupe o enfileiramento por conta e período', async () => {
    const { service, queue } = buildService({});

    await service.enqueue(
      'empresa-1',
      { bankAccountId: 'conta-1', from: '2026-08-01', to: '2026-08-31' },
      'usuario-1',
    );

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'conciliacao:conta-1:2026-08-01:2026-08-31',
        companyId: 'empresa-1',
      }),
    );
  });

  it('recusa período invertido', async () => {
    const { service } = buildService({});

    await expect(
      service.enqueue(
        'empresa-1',
        { bankAccountId: 'conta-1', from: '2026-08-31', to: '2026-08-01' },
        'usuario-1',
      ),
    ).rejects.toThrow(/posterior/i);
  });
});
