import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AlertDefinition, AlertRunnerService } from './alert-runner.service';
import { DueDateAlertsService } from './due-date-alerts.service';

const DAY_MS = 86_400_000;

/**
 * Captura a definição do alerta sem tocar no banco: o que estes testes checam é
 * a consulta que o alerta monta e o texto que ele escreve, que é onde moram as
 * decisões (horizonte, saldo em aberto, chave de dedupe).
 */
function buildService(rows: unknown[] = []) {
  const prisma = {
    db: {
      financialInstallment: { findMany: jest.fn().mockResolvedValue(rows) },
    },
  } as unknown as PrismaService;

  let captured: AlertDefinition<never> | undefined;
  const runner = {
    run: jest.fn((_companyId: string, definition: AlertDefinition<never>) => {
      captured = definition;
      return Promise.resolve(0);
    }),
  } as unknown as AlertRunnerService;

  const service = new DueDateAlertsService(prisma, runner);
  return { service, prisma, definition: () => captured! };
}

function installment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'parcela-1',
    number: 1,
    totalInstallments: 3,
    dueDate: new Date(Date.now() + DAY_MS),
    balance: new Prisma.Decimal('1500.00'),
    entry: { id: 'titulo-1', type: 'PAGAR', number: '123', description: 'Energia' },
    ...overrides,
  };
}

describe('DueDateAlertsService', () => {
  it('só olha parcela com saldo em aberto, mesmo com piso de valor configurado', async () => {
    const { service, prisma, definition } = buildService();

    await service.run('empresa-1');
    await definition().collect({ minAmount: '500.00' });

    const where = (prisma.db.financialInstallment.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.companyId).toBe('empresa-1');
    expect(where.balance.gt).toBe(0);
    expect(where.balance.gte).toBeInstanceOf(Prisma.Decimal);
  });

  it('respeita o horizonte da regra em vez do padrão', async () => {
    const { service, prisma, definition } = buildService();

    await service.run('empresa-1');
    await definition().collect({ daysAhead: 30, includeOverdue: false });

    const where = (prisma.db.financialInstallment.findMany as jest.Mock).mock.calls[0][0].where;
    const span = where.dueDate.lte.getTime() - where.dueDate.gte.getTime();
    expect(Math.round(span / DAY_MS)).toBe(30);
  });

  it('avisa uma vez por vencimento o que ainda vai vencer', async () => {
    const { service, definition } = buildService();

    await service.run('empresa-1');
    const notification = definition().build(installment() as never);

    expect(notification.dedupeKey).toMatch(/^VENCIMENTO:parcela-1:\d{4}-\d{2}-\d{2}$/);
    expect(notification.priority).toBe(3);
    expect(notification.entity).toBe('titulo_parcela');
  });

  it('relembra por dia o que já venceu, com prioridade maior', async () => {
    const { service, definition } = buildService();

    await service.run('empresa-1');
    const notification = definition().build(
      installment({ dueDate: new Date(Date.now() - 2 * DAY_MS) }) as never,
    );

    expect(notification.dedupeKey).toContain(':VENCIDO:');
    expect(notification.priority).toBe(2);
    expect(notification.title).toContain('vencida');
  });

  it('escreve o valor a partir do Decimal, sem passar por float', async () => {
    const { service, definition } = buildService();

    await service.run('empresa-1');
    const notification = definition().build(
      installment({ balance: new Prisma.Decimal('1234.56') }) as never,
    );

    expect(notification.message).toContain('R$ 1234.56');
  });
});
