import { BadRequestException } from '@nestjs/common';
import { JournalLineType, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingExportService } from './accounting-export.service';

function entry(
  overrides: Record<string, unknown> = {},
  lineOverrides: Record<string, unknown> = {},
) {
  return {
    id: 'lanc-1',
    number: 7n,
    entryDate: new Date('2026-03-10T00:00:00.000Z'),
    competenceDate: new Date('2026-03-10T00:00:00.000Z'),
    history: 'Energia elétrica',
    origin: 'TITULO_BAIXA',
    lines: [
      {
        sequence: 1,
        type: JournalLineType.DEBITO,
        amount: new Prisma.Decimal('1500.00'),
        extraHistory: null,
        account: { code: '4.1.01.001', name: 'Energia', spedReferenceCode: '4.01' },
        costCenterId: null,
        ...lineOverrides,
      },
    ],
    ...overrides,
  };
}

function buildService(entries: Record<string, unknown>[] = [entry()]) {
  const updates: Record<string, unknown>[] = [];

  const prisma = {
    db: {
      journalEntry: {
        findMany: jest.fn().mockResolvedValue(entries),
        updateMany: jest.fn((args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return Promise.resolve({ count: entries.length });
        }),
      },
    },
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return { service: new AccountingExportService(prisma, audit), updates, prisma, audit };
}

const range = { from: '2026-03-01', to: '2026-03-31' };

describe('AccountingExportService.export', () => {
  it('exporta no grão da partida, com valor decimal de duas casas', async () => {
    const { service } = buildService();

    const result = await service.export('empresa-1', range, 'user-1');

    expect(result.lines).toBe(1);
    expect(result.content).toContain('"1500.00"');
    expect(result.content.split('\n')[0]).toContain('conta_codigo');
  });

  it('não marca como exportado sem pedido explícito', async () => {
    const { service, updates } = buildService();

    const result = await service.export('empresa-1', range, 'user-1');

    expect(updates).toHaveLength(0);
    expect(result.marked).toBe(0);
  });

  it('marca e carimba a data quando pedido', async () => {
    const { service, updates } = buildService();

    await service.export('empresa-1', { ...range, markExported: true }, 'user-1');

    expect(updates[0]).toMatchObject({ exported: true });
    expect(updates[0].exportedAt).toBeInstanceOf(Date);
  });

  it('neutraliza fórmula no histórico: o campo é texto digitado por usuário', async () => {
    const { service } = buildService([entry({ history: '=CMD|calc!A1' })]);

    const result = await service.export('empresa-1', range, 'user-1');

    expect(result.content).toContain('"\'=CMD|calc!A1"');
  });

  it('escapa aspas em vez de quebrar a coluna', async () => {
    const { service } = buildService([entry({ history: 'Conta "principal"' })]);

    const result = await service.export('empresa-1', range, 'user-1');

    expect(result.content).toContain('"Conta ""principal"""');
  });

  it('devolve JSON quando pedido, com o mesmo conteúdo', async () => {
    const { service } = buildService();

    const result = await service.export('empresa-1', { ...range, format: 'json' }, 'user-1');

    expect(result.contentType).toBe('application/json');
    expect(JSON.parse(result.content)[0]).toMatchObject({ valor: '1500.00', tipo: 'DEBITO' });
  });

  it('audita a exportação: o dado saiu do sistema', async () => {
    const { service, audit } = buildService();

    await service.export('empresa-1', range, 'user-1');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'EXPORTACAO', entity: 'lancamento_contabil' }),
    );
  });

  it('recusa janela invertida', async () => {
    const { service } = buildService();

    await expect(
      service.export('empresa-1', { from: '2026-03-31', to: '2026-03-01' }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filtra por empresa na consulta, além da RLS', async () => {
    const { service, prisma } = buildService();

    await service.export('empresa-1', range, 'user-1');

    const where = (prisma.db.journalEntry.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.companyId).toBe('empresa-1');
  });
});
