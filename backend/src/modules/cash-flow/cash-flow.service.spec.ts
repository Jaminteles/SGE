import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CashFlowService } from './cash-flow.service';
import { CashFlowGranularity } from './dto/query-projection.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { ScenariosService } from './scenarios.service';
import { formatDateOnly } from '../../common/utils/date-only';

const d = (value: string) => new Prisma.Decimal(value);

function today(offsetDays = 0): string {
  const base = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  return formatDateOnly(new Date(base.getTime() + offsetDays * 86_400_000));
}

function buildBucket(periodo: string, overrides: Record<string, unknown> = {}) {
  return {
    periodo: new Date(`${periodo}T00:00:00.000Z`),
    entradas_realizadas: d('0'),
    entradas_previstas: d('0'),
    entradas_vencidas: d('0'),
    saidas_realizadas: d('0'),
    saidas_previstas: d('0'),
    saidas_vencidas: d('0'),
    ...overrides,
  };
}

function buildService(rows: unknown[], balance = d('1000.00'), scenario?: unknown) {
  const queryRaw = jest.fn().mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join(' ');
    if (sql.includes('fn_saldo_caixa_atual')) return Promise.resolve([{ saldo: balance }]);
    return Promise.resolve(rows);
  });

  const prisma = { db: { $queryRaw: queryRaw } } as unknown as PrismaService;
  const scenarios = {
    findOne: jest.fn().mockResolvedValue(scenario),
  } as unknown as ScenariosService;

  return { service: new CashFlowService(prisma, scenarios), queryRaw, scenarios };
}

describe('CashFlowService', () => {
  describe('summary (RF-101/RF-103)', () => {
    // Uma situação sem movimento precisa aparecer zerada: ausente lê-se como
    // "não consultei", zerada, como "não há".
    it('devolve as três situações mesmo quando só uma tem movimento', async () => {
      const { service } = buildService([
        { situacao: 'REALIZADO', entradas: d('500.00'), saidas: d('200.00'), movimentos: 3n },
      ]);

      const result = await service.summary('empresa-1', {});

      expect(result.bySituation.map((s) => s.situation)).toEqual([
        'REALIZADO',
        'VENCIDO',
        'PREVISTO',
      ]);
      expect(result.bySituation[0].net.toString()).toBe('300');
      expect(result.bySituation[1].inflow.toString()).toBe('0');
      expect(result.totals.net.toString()).toBe('300');
    });

    it('recusa período com fim anterior ao início', async () => {
      const { service } = buildService([]);

      await expect(
        service.summary('empresa-1', { from: '2026-05-10', to: '2026-05-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('projection (RF-102)', () => {
    // O saldo acumulado é o ponto do requisito: cada período parte do anterior,
    // e é a sequência que mostra em qual mês o caixa vira negativo.
    it('acumula o saldo período a período a partir do caixa de hoje', async () => {
      const { service } = buildService(
        [
          buildBucket(today(), { entradas_previstas: d('400.00'), saidas_previstas: d('100.00') }),
          buildBucket(today(30), { saidas_previstas: d('1500.00') }),
        ],
        d('1000.00'),
      );

      const result = await service.projection('empresa-1', {
        granularity: CashFlowGranularity.MES,
        to: today(60),
      });

      expect(result.openingBalance.toString()).toBe('1000');
      expect(result.periods[0].closingBalance.toString()).toBe('1300');
      expect(result.periods[1].closingBalance.toString()).toBe('-200');
      expect(result.closingBalance.toString()).toBe('-200');
    });

    // Sem cenário a origem é o caixa de hoje, que já contém o realizado do
    // passado: somá-lo de novo daria um saldo projetado errado, e para mais.
    it('recusa janela que começa antes de hoje quando não há cenário', async () => {
      const { service } = buildService([]);

      await expect(
        service.projection('empresa-1', {
          granularity: CashFlowGranularity.DIA,
          from: today(-10),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('recusa período longo demais para o grão pedido', async () => {
      const { service } = buildService([]);

      await expect(
        service.projection('empresa-1', {
          granularity: CashFlowGranularity.DIA,
          from: today(),
          to: today(1000),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('projection sob cenário (RF-104)', () => {
    const scenario = {
      id: 'cenario-1',
      name: 'Vendas em queda',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-03-31T00:00:00.000Z'),
      openingBalance: d('2000.00'),
      assumptions: { entradas_percentual: -10, saidas_percentual: 5 },
    };

    // A premissa ajusta expectativa, não extrato: o realizado atravessa o
    // cenário intacto.
    it('aplica as premissas só ao previsto e ao vencido', async () => {
      const { service } = buildService(
        [
          buildBucket('2026-01-01', {
            entradas_realizadas: d('1000.00'),
            entradas_previstas: d('1000.00'),
            saidas_previstas: d('1000.00'),
            saidas_vencidas: d('500.00'),
          }),
        ],
        d('0'),
        scenario,
      );

      const result = await service.projection('empresa-1', {
        granularity: CashFlowGranularity.MES,
        scenarioId: 'cenario-1',
      });

      const [period] = result.periods;
      expect(period.inflow.realized.toString()).toBe('1000');
      expect(period.inflow.expected.toString()).toBe('900');
      expect(period.outflow.expected.toString()).toBe('1050');
      expect(period.outflow.overdue.toString()).toBe('525');
      // 2000 + (1000 + 900) - (1050 + 525)
      expect(period.closingBalance.toString()).toBe('2325');
    });

    // A janela do cenário pode ser passada: o saldo inicial dele é declarado,
    // não lido do extrato de hoje.
    it('usa a janela e o saldo inicial do cenário', async () => {
      const { service } = buildService([buildBucket('2026-01-01')], d('9999.00'), scenario);

      const result = await service.projection('empresa-1', {
        granularity: CashFlowGranularity.MES,
        scenarioId: 'cenario-1',
      });

      expect(result.period).toEqual({ from: '2026-01-01', to: '2026-03-31' });
      expect(result.openingBalance.toString()).toBe('2000');
    });
  });
});
