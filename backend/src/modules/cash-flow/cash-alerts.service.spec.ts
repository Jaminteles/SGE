import { Prisma } from '@prisma/client';
import { CashAlertsService } from './cash-alerts.service';
import { CashFlowService } from './cash-flow.service';
import { PrismaService } from '../../prisma/prisma.service';
import { formatDateOnly } from '../../common/utils/date-only';

const d = (value: string) => new Prisma.Decimal(value);

function day(offset: number): Date {
  const base = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  return new Date(base.getTime() + offset * 86_400_000);
}

function buildAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alerta-1',
    name: 'Caixa mínimo operacional',
    bankAccountId: null,
    minimumBalance: d('5000.00'),
    daysAhead: 30,
    isActive: true,
    ...overrides,
  };
}

function buildService(options: {
  alert?: Record<string, unknown>;
  balance?: Prisma.Decimal;
  movements?: { dia: Date; entradas: Prisma.Decimal; saidas: Prisma.Decimal }[];
}) {
  const alert = options.alert ?? buildAlert();

  const alertDelegate = {
    findMany: jest.fn().mockResolvedValue([alert]),
    findFirst: jest.fn().mockResolvedValue(alert),
    create: jest.fn().mockResolvedValue(alert),
    update: jest.fn().mockResolvedValue(alert),
  };

  const prisma = {
    db: { cashAlert: alertDelegate, $queryRaw: jest.fn().mockResolvedValue([{ id: 'conta-1' }]) },
  } as unknown as PrismaService;

  const cashFlow = {
    currentCashBalance: jest.fn().mockResolvedValue(options.balance ?? d('10000.00')),
    dailyNet: jest.fn().mockResolvedValue(options.movements ?? []),
  } as unknown as CashFlowService;

  return { service: new CashAlertsService(prisma, cashFlow), alertDelegate, cashFlow };
}

describe('CashAlertsService', () => {
  // RF-105: o alerta serve para dizer *quando*. Saber que vai faltar em algum
  // dia dos próximos trinta não muda decisão nenhuma.
  it('aponta o primeiro dia em que o saldo projetado cruza o mínimo', async () => {
    const { service } = buildService({
      balance: d('10000.00'),
      movements: [
        { dia: day(3), entradas: d('0'), saidas: d('4000.00') },
        { dia: day(5), entradas: d('0'), saidas: d('3000.00') },
        { dia: day(9), entradas: d('0'), saidas: d('1000.00') },
      ],
    });

    const result = await service.evaluate('empresa-1', 'alerta-1');

    expect(result.breached).toBe(true);
    // 10000 -4000 = 6000 (acima do mínimo); -3000 = 3000 (abaixo).
    expect(result.breachDate).toBe(formatDateOnly(day(5)));
    expect(result.lowestBalance.toString()).toBe('2000');
    expect(result.shortfall.toString()).toBe('3000');
  });

  it('não acusa ruptura quando o caixa se mantém acima do mínimo', async () => {
    const { service } = buildService({
      balance: d('10000.00'),
      movements: [{ dia: day(2), entradas: d('1000.00'), saidas: d('500.00') }],
    });

    const result = await service.evaluate('empresa-1', 'alerta-1');

    expect(result.breached).toBe(false);
    expect(result.breachDate).toBeNull();
    expect(result.shortfall.toString()).toBe('0');
    expect(result.closingBalance.toString()).toBe('10500');
  });

  // Movimento além do horizonte configurado não entra: o alerta responde pela
  // janela que alguém escolheu vigiar.
  it('ignora movimentos fora do horizonte do alerta', async () => {
    const { service } = buildService({
      alert: buildAlert({ daysAhead: 5 }),
      balance: d('10000.00'),
      movements: [{ dia: day(20), entradas: d('0'), saidas: d('9000.00') }],
    });

    const result = await service.evaluate('empresa-1', 'alerta-1');

    expect(result.horizon).toEqual({ from: formatDateOnly(day(0)), to: formatDateOnly(day(5)) });
    expect(result.breached).toBe(false);
    expect(result.closingBalance.toString()).toBe('10000');
  });

  it('conta quantos alertas ativos estão em ruptura', async () => {
    const { service } = buildService({
      balance: d('1000.00'),
      movements: [],
    });

    const result = await service.evaluateAll('empresa-1');

    expect(result.breached).toBe(1);
    expect(result.alerts).toHaveLength(1);
  });
});
