import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccountNature, LedgerAccountType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLedgerAccountDto } from './dto/ledger-account.dto';
import { LedgerAccountsService } from './ledger-accounts.service';

function buildService(options: { existing?: Record<string, unknown> | null; lines?: number } = {}) {
  const created: Record<string, unknown>[] = [];

  const prisma = {
    db: {
      ledgerAccount: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ id: 'conta-1', ...data });
        }),
        findFirst: jest.fn().mockResolvedValue(options.existing ?? null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({ id: 'conta-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      journalEntryLine: { count: jest.fn().mockResolvedValue(options.lines ?? 0) },
    },
  } as unknown as PrismaService;

  return { service: new LedgerAccountsService(prisma), created, prisma };
}

const account: CreateLedgerAccountDto = {
  code: '4.1.01.001',
  name: 'Despesa com energia',
  type: LedgerAccountType.DESPESA,
  acceptsEntry: true,
};

describe('LedgerAccountsService.create', () => {
  it('deriva a natureza do tipo: despesa é devedora (RF-079)', async () => {
    const { service, created } = buildService();

    await service.create('empresa-1', account);

    expect(created[0]).toMatchObject({
      companyId: 'empresa-1',
      nature: AccountNature.DEVEDORA,
      level: 1,
    });
  });

  it('recusa natureza trocada: ela inverteria o sinal no balancete', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', { ...account, nature: AccountNature.CREDORA }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige natureza na conta de compensação, a única que aceita as duas', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', { ...account, type: LedgerAccountType.COMPENSACAO }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa filha de tipo diferente do pai', async () => {
    const { service } = buildService({
      existing: {
        id: 'pai',
        type: LedgerAccountType.ATIVO,
        acceptsEntry: false,
        level: 2,
      },
    });

    await expect(
      service.create('empresa-1', { ...account, parentId: 'pai' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa pendurar conta sob uma que aceita lançamento', async () => {
    const { service } = buildService({
      existing: {
        id: 'pai',
        type: LedgerAccountType.DESPESA,
        acceptsEntry: true,
        level: 3,
      },
    });

    await expect(
      service.create('empresa-1', { ...account, parentId: 'pai' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('herda o nível do pai em vez de aceitar o informado', async () => {
    const { service, created } = buildService({
      existing: {
        id: 'pai',
        type: LedgerAccountType.DESPESA,
        acceptsEntry: false,
        level: 3,
      },
    });

    await service.create('empresa-1', { ...account, parentId: 'pai' });

    expect(created[0].level).toBe(4);
  });

  it('traduz código repetido em conflito, não em 500', async () => {
    const { service, prisma } = buildService();
    (prisma.db.ledgerAccount.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicada', {
        code: 'P2002',
        clientVersion: '6',
      }),
    );

    await expect(service.create('empresa-1', account)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('LedgerAccountsService — isolamento e histórico', () => {
  it('devolve 404 para conta de outra empresa: id na rota não atravessa tenant', async () => {
    const { service } = buildService({ existing: null });

    await expect(service.findOne('empresa-1', 'conta-de-outra')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('recusa inativar conta que já recebeu partida', async () => {
    const { service } = buildService({
      existing: { id: 'conta-1', type: LedgerAccountType.DESPESA, acceptsEntry: true, level: 4 },
      lines: 3,
    });

    await expect(
      service.update('empresa-1', 'conta-1', { isActive: false }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa marcar como analítica uma conta que tem filhas', async () => {
    const { service, prisma } = buildService({
      existing: { id: 'conta-1', type: LedgerAccountType.DESPESA, acceptsEntry: false, level: 2 },
    });
    (prisma.db.ledgerAccount.count as jest.Mock).mockResolvedValue(2);

    await expect(
      service.update('empresa-1', 'conta-1', { acceptsEntry: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('LedgerAccountsService.tree', () => {
  it('aninha as filhas sob o pai numa consulta só', async () => {
    const { service, prisma } = buildService();
    (prisma.db.ledgerAccount.findMany as jest.Mock).mockResolvedValue([
      { id: 'a', parentId: null, code: '4' },
      { id: 'b', parentId: 'a', code: '4.1' },
      { id: 'c', parentId: 'b', code: '4.1.01' },
    ]);

    const tree = await service.tree('empresa-1');

    expect(prisma.db.ledgerAccount.findMany).toHaveBeenCalledTimes(1);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].children[0].id).toBe('c');
  });
});
