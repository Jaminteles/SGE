import { BadRequestException, ConflictException } from '@nestjs/common';
import { EntryType, Periodicity, Prisma } from '@prisma/client';
import { RecurrencesService } from './recurrences.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesService } from '../../common/references/references.service';
import { FinancialEntriesService } from './financial-entries.service';

function buildRecurrence(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recorrencia-1',
    companyId: 'empresa-1',
    description: 'Aluguel da matriz',
    type: EntryType.PAGAR,
    periodicity: Periodicity.MENSAL,
    dueDay: 10,
    defaultAmount: new Prisma.Decimal('2500.00'),
    partnerId: 'parceiro-1',
    categoryId: null,
    costCenterId: null,
    startDate: new Date('2026-01-10T00:00:00.000Z'),
    endDate: null,
    maxOccurrences: null,
    generatedCount: 0,
    nextRunDate: new Date('2026-01-10T00:00:00.000Z'),
    isActive: true,
    ...overrides,
  };
}

function buildService(overrides: { recurrence?: Record<string, unknown> } = {}) {
  const recurrence = overrides.recurrence ?? buildRecurrence();

  const recurrenceDelegate = {
    create: jest.fn().mockResolvedValue({ id: 'recorrencia-1' }),
    update: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(recurrence),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };

  const prisma = {
    db: {
      recurrence: recurrenceDelegate,
      // Emula `fn_proxima_ocorrencia` para MENSAL: avança um mês a partir da
      // data recebida, que é o suficiente para exercitar as paradas do laço.
      $queryRaw: jest
        .fn()
        .mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
          const base = new Date(`${String(values[0])}T00:00:00.000Z`);
          const next = new Date(base);
          next.setUTCMonth(next.getUTCMonth() + 1);
          return Promise.resolve([{ proxima: next }]);
        }),
    },
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;

  const entries = {
    createEntry: jest
      .fn()
      .mockImplementation(() => Promise.resolve({ id: 'titulo-x', number: 'CP-2026-000001' })),
  } as unknown as FinancialEntriesService;

  return {
    service: new RecurrencesService(prisma, references, entries),
    recurrenceDelegate,
    entries,
  };
}

describe('RecurrencesService', () => {
  // RF-053: a rodada gera tudo o que já venceu — três meses esquecidos são três
  // títulos, e não um só com o valor somado.
  it('gera uma ocorrência por período devido até a data informada', async () => {
    const { service, entries } = buildService();

    const result = await service.generate(
      'empresa-1',
      'recorrencia-1',
      { until: '2026-03-10' },
      'user-1',
    );

    expect(entries.createEntry).toHaveBeenCalledTimes(3);
    expect(result.entries.map((e) => e.dueDate)).toEqual([
      '2026-01-10',
      '2026-02-10',
      '2026-03-10',
    ]);
  });

  it('para no número máximo de ocorrências e encerra a recorrência', async () => {
    const { service, entries, recurrenceDelegate } = buildService({
      recurrence: buildRecurrence({ maxOccurrences: 2 }),
    });

    await service.generate('empresa-1', 'recorrencia-1', { until: '2026-06-10' }, 'user-1');

    expect(entries.createEntry).toHaveBeenCalledTimes(2);
    expect(recurrenceDelegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ generatedCount: 2, nextRunDate: null, isActive: false }),
      }),
    );
  });

  it('para no fim do contrato', async () => {
    const { service, entries } = buildService({
      recurrence: buildRecurrence({ endDate: new Date('2026-02-28T00:00:00.000Z') }),
    });

    await service.generate('empresa-1', 'recorrencia-1', { until: '2026-06-10' }, 'user-1');

    expect(entries.createEntry).toHaveBeenCalledTimes(2);
  });

  it('avisa quando não há nada a gerar até a data', async () => {
    const { service } = buildService();

    await expect(
      service.generate('empresa-1', 'recorrencia-1', { until: '2025-12-01' }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa gerar de recorrência encerrada', async () => {
    const { service } = buildService({ recurrence: buildRecurrence({ isActive: false }) });

    await expect(
      service.generate('empresa-1', 'recorrencia-1', { until: '2026-03-10' }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('exige valor quando a recorrência não tem valor padrão', async () => {
    const { service } = buildService({ recurrence: buildRecurrence({ defaultAmount: null }) });

    await expect(
      service.generate('empresa-1', 'recorrencia-1', { until: '2026-03-10' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa fim anterior ao início', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', {
        description: 'Aluguel',
        type: EntryType.PAGAR,
        periodicity: Periodicity.MENSAL,
        startDate: '2026-03-01',
        endDate: '2026-01-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
