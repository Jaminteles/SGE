import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardService } from './dashboard.service';

const decimal = (value: string) => new Prisma.Decimal(value);
const PERIOD = { from: '2026-06-01', to: '2026-06-30' };

function portfolioRow(overrides: Record<string, unknown> = {}) {
  return {
    tipo: 'RECEBER',
    faixa_atraso: 'A_VENCER',
    competencia: new Date('2026-06-01T00:00:00.000Z'),
    parcelas: 2,
    saldo: decimal('1000.00'),
    encargos: decimal('0.00'),
    valor_atualizado: decimal('1000.00'),
    ...overrides,
  };
}

function realizedRow(overrides: Record<string, unknown> = {}) {
  return {
    tipo: 'RECEBER',
    competencia: new Date('2026-06-01T00:00:00.000Z'),
    baixas: 3,
    valor_principal: decimal('500.00'),
    valor_juros: decimal('10.00'),
    valor_multa: decimal('5.00'),
    valor_desconto: decimal('2.00'),
    valor_total: decimal('513.00'),
    ...overrides,
  };
}

/**
 * O serviço faz várias consultas por método; o mock responde por ordem de
 * chamada, que é o que permite testar a composição sem banco.
 */
function buildService(responses: unknown[][]) {
  let call = 0;

  const prisma = {
    db: {
      $queryRaw: jest.fn(() => Promise.resolve(responses[call++] ?? [])),
    },
  } as unknown as PrismaService;

  return { service: new DashboardService(prisma), prisma };
}

describe('DashboardService.financial (RF-106)', () => {
  it('separa carteira aberta de realizado e apura o saldo do período', async () => {
    const { service } = buildService([
      [
        portfolioRow(),
        portfolioRow({ tipo: 'PAGAR', valor_atualizado: decimal('400.00'), parcelas: 1 }),
        portfolioRow({ faixa_atraso: 'ACIMA_DE_90', valor_atualizado: decimal('250.00') }),
      ],
      [realizedRow(), realizedRow({ tipo: 'PAGAR', valor_total: decimal('213.00') })],
    ]);

    const result = await service.financial('empresa-1', PERIOD);

    expect(result.openPortfolio.receivable.toString()).toBe('1250');
    expect(result.openPortfolio.payable.toString()).toBe('400');
    // Vencido é o que não está em `A_VENCER` — a faixa vem do modelo (bd/09).
    expect(result.openPortfolio.overdueReceivable.toString()).toBe('250');
    expect(result.realized.net.toString()).toBe('300');
    expect(result.realized.interest.toString()).toBe('30');
  });

  it('nunca concatena a empresa nem os filtros no texto do SQL', async () => {
    const { service, prisma } = buildService([[], []]);

    await service.financial('empresa-1', { ...PERIOD, branchId: 'filial-9' });

    const calls = (prisma.db.$queryRaw as unknown as jest.Mock).mock.calls as unknown[][];
    for (const call of calls) {
      const [template] = call as [TemplateStringsArray];
      expect(template.raw.join('')).not.toContain('empresa-1');
      expect(template.raw.join('')).not.toContain('filial-9');
      expect(JSON.stringify(call)).toContain('empresa-1');
    }
  });

  it('escopa toda consulta pela empresa ativa, mesmo sem filtro nenhum', async () => {
    const { service, prisma } = buildService([[], []]);

    await service.financial('empresa-1', PERIOD);

    const calls = (prisma.db.$queryRaw as unknown as jest.Mock).mock.calls as unknown[][];
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(JSON.stringify(call)).toContain('empresa_id');
      expect(JSON.stringify(call)).toContain('empresa-1');
    }
  });

  it('recusa período invertido', async () => {
    const { service } = buildService([[], []]);

    await expect(
      service.financial('empresa-1', { from: '2026-06-30', to: '2026-06-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DashboardService.portfolio (RF-107)', () => {
  it('apura o aging sobre a carteira inteira, não só sobre a janela', async () => {
    const { service } = buildService([
      [portfolioRow()],
      [
        portfolioRow(),
        portfolioRow({ faixa_atraso: 'ACIMA_DE_90', valor_atualizado: decimal('700.00') }),
      ],
    ]);

    const result = await service.portfolio('empresa-1', PERIOD);

    expect(result.dueInPeriod).toHaveLength(1);
    const overdue = result.aging.find((band) => band.band === 'ACIMA_DE_90');
    expect(overdue?.receivable.toString()).toBe('700');
    expect(result.totals.receivable.toString()).toBe('1000');
  });
});

describe('DashboardService.cashFlow (RF-108)', () => {
  it('consulta apenas o consolidado real, sem cenário digitado', async () => {
    const { service, prisma } = buildService([[], []]);

    await service.cashFlow('empresa-1', PERIOD);

    const [template] = (prisma.db.$queryRaw as unknown as jest.Mock).mock.calls[0] as [
      TemplateStringsArray,
    ];
    expect(template.raw.join('')).toContain('vw_fluxo_caixa_diario');
    expect(JSON.stringify((prisma.db.$queryRaw as unknown as jest.Mock).mock.calls[0])).toContain(
      'cenario_id IS NULL',
    );
  });

  it('apura o resultado como receita menos custo e despesa', async () => {
    const { service } = buildService([
      [],
      [
        {
          competencia: new Date('2026-06-01T00:00:00.000Z'),
          tipo: 'RECEITA',
          codigo: '3.1',
          nome: 'Vendas',
          valor: decimal('1000.00'),
        },
        {
          competencia: new Date('2026-06-01T00:00:00.000Z'),
          tipo: 'DESPESA',
          codigo: '4.1',
          nome: 'Aluguel',
          valor: decimal('300.00'),
        },
      ],
    ]);

    const result = await service.cashFlow('empresa-1', PERIOD);

    expect(result.result.revenue.toString()).toBe('1000');
    expect(result.result.expense.toString()).toBe('300');
    expect(result.result.net.toString()).toBe('700');
  });
});

describe('DashboardService.workforce (RF-110)', () => {
  it('conta só o quadro ativo no total, mantendo o desligado na listagem', async () => {
    const { service } = buildService([
      [
        {
          departamento_id: 'dep-1',
          departamento_nome: 'Operações',
          cargo_id: null,
          centro_custo_id: null,
          status: 'ATIVO',
          funcionarios: 4,
          funcionarios_com_salario: 3,
          salario_base_total: decimal('12000.00'),
        },
        {
          departamento_id: 'dep-1',
          departamento_nome: 'Operações',
          cargo_id: null,
          centro_custo_id: null,
          status: 'DESLIGADO',
          funcionarios: 2,
          funcionarios_com_salario: 2,
          salario_base_total: decimal('5000.00'),
        },
      ],
      [
        {
          competencia: new Date('2026-06-01T00:00:00.000Z'),
          departamento_id: 'dep-1',
          admissoes: 1,
          desligamentos: 2,
        },
      ],
      [],
    ]);

    const result = await service.workforce('empresa-1', PERIOD);

    expect(result.headcount).toHaveLength(2);
    expect(result.totals.activeEmployees).toBe(4);
    expect(result.totals.activeBaseSalary.toString()).toBe('12000');
    expect(result.totals.terminations).toBe(2);
  });
});
