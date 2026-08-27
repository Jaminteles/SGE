import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FiscalReportsService } from './fiscal-reports.service';

const decimal = (value: string) => new Prisma.Decimal(value);

function row(overrides: Record<string, unknown> = {}) {
  return {
    competencia: new Date('2026-06-01T00:00:00.000Z'),
    sentido: 'ENTRADA',
    modelo: 'NFE',
    documentos: 2,
    valor_total: decimal('1000.00'),
    valor_produtos: decimal('900.00'),
    valor_icms: decimal('180.00'),
    valor_icms_st: decimal('0.00'),
    valor_ipi: decimal('0.00'),
    valor_pis: decimal('0.00'),
    valor_cofins: decimal('0.00'),
    valor_iss: decimal('0.00'),
    ...overrides,
  };
}

function buildService(rows: Record<string, unknown>[] = [row()]) {
  const statements: unknown[] = [];

  const prisma = {
    db: {
      $queryRaw: jest.fn((...args: unknown[]) => {
        statements.push(args);
        return Promise.resolve(rows);
      }),
    },
  } as unknown as PrismaService;

  return { service: new FiscalReportsService(prisma), statements, prisma };
}

describe('FiscalReportsService.assessment', () => {
  it('soma o período separando entrada de saída (RF-093)', async () => {
    const { service } = buildService([
      row(),
      row({ sentido: 'SAIDA', valor_icms: decimal('300.00'), documentos: 1 }),
    ]);

    const report = await service.assessment('empresa-1', { from: '2026-06-01', to: '2026-06-30' });

    expect(report.rows).toHaveLength(2);
    expect(report.totals.ENTRADA.icmsAmount.toString()).toBe('180');
    expect(report.totals.SAIDA.icmsAmount.toString()).toBe('300');
    expect(report.totals.ENTRADA.documents).toBe(2);
  });

  it('passa empresa e período como parâmetro, nunca concatenados na consulta', async () => {
    const { service, prisma } = buildService();

    await service.assessment('empresa-1', { from: '2026-06-01', to: '2026-06-30' });

    const call = (prisma.db.$queryRaw as unknown as jest.Mock).mock.calls[0] as unknown[];
    // O primeiro argumento é o template; os valores viajam como parâmetros do
    // `Prisma.Sql` embutido, e não dentro do texto do SQL.
    expect(JSON.stringify(call)).toContain('empresa-1');
    const [template] = call as [{ strings?: string[] } & TemplateStringsArray];
    expect(template.raw.join('')).not.toContain('empresa-1');
  });

  it('recusa período invertido', async () => {
    const { service } = buildService();

    await expect(
      service.assessment('empresa-1', { from: '2026-06-30', to: '2026-06-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
