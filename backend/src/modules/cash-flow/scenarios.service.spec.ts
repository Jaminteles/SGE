import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntryType, Prisma } from '@prisma/client';
import { ScenariosService } from './scenarios.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesService } from '../../common/references/references.service';

const d = (value: string) => new Prisma.Decimal(value);

function buildScenario(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cenario-1',
    name: 'Base',
    description: null,
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: new Date('2026-03-31T00:00:00.000Z'),
    openingBalance: d('1000.00'),
    assumptions: {},
    isBaseline: true,
    ...overrides,
  };
}

function buildService(options: { scenario?: Record<string, unknown>; orphans?: number } = {}) {
  const scenario = options.scenario ?? buildScenario();

  const scenarioDelegate = {
    create: jest.fn().mockResolvedValue(scenario),
    update: jest.fn().mockResolvedValue(scenario),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findFirst: jest.fn().mockResolvedValue(scenario),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    delete: jest.fn().mockResolvedValue(scenario),
  };

  const projectionDelegate = {
    create: jest.fn().mockImplementation(({ data }: { data: unknown }) => Promise.resolve(data)),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue({}),
    count: jest.fn().mockResolvedValue(options.orphans ?? 0),
  };

  const prisma = {
    db: {
      cashFlowScenario: scenarioDelegate,
      cashFlowProjection: projectionDelegate,
      $queryRaw: jest.fn().mockResolvedValue([{ saldo: d('7500.00') }]),
    },
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;

  return {
    service: new ScenariosService(prisma, references),
    scenarioDelegate,
    projectionDelegate,
  };
}

describe('ScenariosService', () => {
  // Só um cenário base por empresa (índice parcial em bd/10): promover um
  // precisa despromover o anterior na mesma transação.
  it('desmarca o cenário base anterior ao criar outro como base', async () => {
    const { service, scenarioDelegate } = buildService();

    await service.create(
      'empresa-1',
      { name: 'Otimista', startDate: '2026-01-01', endDate: '2026-06-30', isBaseline: true },
      'user-1',
    );

    expect(scenarioDelegate.updateMany).toHaveBeenCalledWith({
      where: { companyId: 'empresa-1', isBaseline: true },
      data: { isBaseline: false },
    });
  });

  // Sem saldo informado, o cenário parte do caixa de hoje: um cenário que
  // começa em zero projetaria uma ruptura que não existe.
  it('usa o saldo de caixa atual quando o saldo inicial não é informado', async () => {
    const { service, scenarioDelegate } = buildService();

    await service.create(
      'empresa-1',
      { name: 'Base', startDate: '2026-01-01', endDate: '2026-06-30' },
      'user-1',
    );

    const { data } = scenarioDelegate.create.mock.calls[0][0] as {
      data: { openingBalance: Prisma.Decimal };
    };
    expect(data.openingBalance.toString()).toBe('7500');
  });

  it('recusa janela com fim anterior ao início', async () => {
    const { service } = buildService();

    await expect(
      service.create(
        'empresa-1',
        { name: 'Errado', startDate: '2026-06-30', endDate: '2026-01-01' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Encurtar a janela deixaria linhas manuais fora do cenário — o mesmo que o
  // banco recusa na inserção.
  it('recusa encurtar a janela quando há projeção manual fora dela', async () => {
    const { service } = buildService({ orphans: 2 });

    await expect(
      service.update('empresa-1', 'cenario-1', { endDate: '2026-02-01' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('projeções manuais (RF-104)', () => {
    it('recusa data fora da janela do cenário', async () => {
      const { service } = buildService();

      await expect(
        service.addProjection('empresa-1', 'cenario-1', {
          referenceDate: '2026-12-01',
          type: EntryType.RECEBER,
          amount: '100.00',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // O valor é sempre positivo: a direção vem do tipo. Um sinal trocado numa
    // saída viraria entrada de caixa.
    it('recusa valor não positivo', async () => {
      const { service } = buildService();

      await expect(
        service.addProjection('empresa-1', 'cenario-1', {
          referenceDate: '2026-02-01',
          type: EntryType.PAGAR,
          amount: '0',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('grava a projeção dentro da janela', async () => {
      const { service, projectionDelegate } = buildService();

      await service.addProjection('empresa-1', 'cenario-1', {
        referenceDate: '2026-02-15',
        type: EntryType.PAGAR,
        amount: '2500.00',
        description: 'Compra de máquina',
      });

      const { data } = projectionDelegate.create.mock.calls[0][0] as {
        data: { scenarioId: string; amount: Prisma.Decimal };
      };
      expect(data.scenarioId).toBe('cenario-1');
      expect(data.amount.toString()).toBe('2500');
    });

    it('recusa remover projeção de outro cenário', async () => {
      const { service } = buildService();

      await expect(
        service.removeProjection('empresa-1', 'cenario-1', 'projecao-de-outro'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
