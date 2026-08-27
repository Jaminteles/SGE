import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountClassificationsService } from './account-classifications.service';
import { LedgerAccountsService } from './ledger-accounts.service';
import { ParseClassifiableSourcePipe } from './parse-classifiable-source.pipe';

const CATEGORY = {
  id: 'cat-1',
  code: '4.1.01',
  name: 'Energia',
  ledgerAccountId: null,
  ledgerAccount: null,
};

function buildService(
  options: { rows?: Record<string, unknown>[]; postable?: Record<string, unknown> | null } = {},
) {
  const updates: { model: string; data: Record<string, unknown> }[] = [];
  const rows = options.rows ?? [CATEGORY];

  const model = (name: string) => ({
    findMany: jest.fn().mockResolvedValue(rows),
    update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      updates.push({ model: name, data });
      return Promise.resolve({ id: 'cat-1' });
    }),
  });

  const prisma = {
    db: {
      category: model('category'),
      payrollItem: model('payrollItem'),
      companyBankAccount: model('companyBankAccount'),
    },
  } as unknown as PrismaService;

  const accounts = {
    findPostable: jest
      .fn()
      .mockResolvedValue(options.postable === undefined ? { id: 'conta-1' } : options.postable),
  } as unknown as LedgerAccountsService;

  return {
    service: new AccountClassificationsService(prisma, accounts),
    updates,
    prisma,
    accounts,
  };
}

describe('AccountClassificationsService.assign', () => {
  it('aponta a conta contábil da categoria (RF-080)', async () => {
    const { service, updates } = buildService();

    await service.assign('empresa-1', 'categories', 'cat-1', { accountId: 'conta-1' });

    expect(updates[0]).toEqual({ model: 'category', data: { ledgerAccountId: 'conta-1' } });
  });

  it('aceita remover a classificação, deixando a origem sem contrapartida', async () => {
    const { service, updates } = buildService();

    await service.assign('empresa-1', 'categories', 'cat-1', { accountId: null });

    expect(updates[0].data).toEqual({ ledgerAccountId: null });
  });

  it('recusa conta sintética, inativa ou de outra empresa com a mesma resposta', async () => {
    const { service } = buildService({ postable: null });

    await expect(
      service.assign('empresa-1', 'categories', 'cat-1', { accountId: 'conta-alheia' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('devolve 404 quando a origem não é da empresa ativa', async () => {
    const { service } = buildService({ rows: [] });

    await expect(
      service.assign('empresa-1', 'categories', 'de-outra', { accountId: 'conta-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('busca a origem sempre presa à empresa ativa', async () => {
    const { service, prisma } = buildService();

    await service.findAll('empresa-1', 'categories', {});

    const where = (prisma.db.category.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.companyId).toBe('empresa-1');
  });
});

describe('ParseClassifiableSourcePipe', () => {
  it('aceita apenas as origens conhecidas', () => {
    const pipe = new ParseClassifiableSourcePipe();

    expect(pipe.transform('categories')).toBe('categories');
    expect(pipe.transform('bank-accounts')).toBe('bank-accounts');
  });

  it('recusa origem arbitrária vinda da URL', () => {
    const pipe = new ParseClassifiableSourcePipe();

    expect(() => pipe.transform('usuario')).toThrow(BadRequestException);
  });
});
