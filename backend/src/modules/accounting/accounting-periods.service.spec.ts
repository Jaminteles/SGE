import { ConflictException, NotFoundException } from '@nestjs/common';
import { AccountingPeriodStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingPeriodsService } from './accounting-periods.service';

function period(overrides: Record<string, unknown> = {}) {
  return {
    id: 'per-3',
    year: 2026,
    month: 3,
    startDate: new Date('2026-03-01T00:00:00.000Z'),
    endDate: new Date('2026-03-31T00:00:00.000Z'),
    status: AccountingPeriodStatus.ABERTO,
    ...overrides,
  };
}

function buildService(
  options: {
    row?: Record<string, unknown> | null;
    previousOpen?: Record<string, unknown> | null;
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  let firstFindFirst = true;

  const prisma = {
    db: {
      accountingPeriod: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn(({ data }: { data: Record<string, unknown>[] }) => {
          created.push(...data);
          return Promise.resolve({ count: data.length });
        }),
        findFirst: jest.fn(() => {
          // A primeira busca é o período alvo; a segunda, o anterior ainda aberto.
          if (firstFindFirst) {
            firstFindFirst = false;
            return Promise.resolve(options.row === undefined ? period() : options.row);
          }
          return Promise.resolve(options.previousOpen ?? null);
        }),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return Promise.resolve({ ...period(), ...data });
        }),
      },
    },
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return { service: new AccountingPeriodsService(prisma, audit), created, updates, audit };
}

describe('AccountingPeriodsService.openYear', () => {
  it('abre os doze meses com as datas do próprio mês', async () => {
    const { service, created } = buildService();

    await service.openYear('empresa-1', 2026);

    expect(created).toHaveLength(12);
    expect(created[0]).toMatchObject({ companyId: 'empresa-1', year: 2026, month: 1 });
    expect((created[1].endDate as Date).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect((created[11].endDate as Date).toISOString().slice(0, 10)).toBe('2026-12-31');
  });
});

describe('AccountingPeriodsService.close', () => {
  it('carimba responsável e data ao fechar, e audita como FECHAMENTO', async () => {
    const { service, updates, audit } = buildService();

    await service.close('empresa-1', 'per-3', {}, 'user-1');

    expect(updates[0]).toMatchObject({
      status: AccountingPeriodStatus.FECHADO,
      closedById: 'user-1',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'FECHAMENTO', entity: 'periodo_contabil' }),
    );
  });

  it('recusa fechar fora de ordem, com um mês anterior ainda aberto', async () => {
    const { service } = buildService({ previousOpen: { year: 2026, month: 2 } });

    await expect(service.close('empresa-1', 'per-3', {}, 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('recusa fechar o que já está fechado', async () => {
    const { service } = buildService({
      row: period({ status: AccountingPeriodStatus.FECHADO }),
    });

    await expect(service.close('empresa-1', 'per-3', {}, 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('devolve 404 para período de outra empresa: id na rota não atravessa tenant', async () => {
    const { service } = buildService({ row: null });

    await expect(service.close('empresa-1', 'de-outra', {}, 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AccountingPeriodsService.reopen', () => {
  it('grava motivo e responsável, e audita como REABERTURA', async () => {
    const { service, updates, audit } = buildService({
      row: period({ status: AccountingPeriodStatus.FECHADO }),
    });

    await service.reopen('empresa-1', 'per-3', { reason: 'Nota lançada a menor' }, 'user-1');

    expect(updates[0]).toMatchObject({
      status: AccountingPeriodStatus.REABERTO,
      reopenedById: 'user-1',
      reopenReason: 'Nota lançada a menor',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'REABERTURA', entity: 'periodo_contabil' }),
    );
  });

  it('recusa reabrir período que não está fechado', async () => {
    const { service } = buildService();

    await expect(
      service.reopen('empresa-1', 'per-3', { reason: 'Nota lançada a menor' }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
