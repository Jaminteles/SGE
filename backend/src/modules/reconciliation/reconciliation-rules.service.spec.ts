import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReconciliationRulesService } from './reconciliation-rules.service';
import { CreateReconciliationRuleDto } from './dto/reconciliation-rule.dto';

function buildService(existing: Record<string, unknown> | null = null) {
  const created: Record<string, unknown>[] = [];

  const prisma = {
    db: {
      reconciliationRule: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ id: 'regra-1', ...data });
        }),
        update: jest.fn().mockResolvedValue({ id: 'regra-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    },
  } as unknown as PrismaService;

  return { service: new ReconciliationRulesService(prisma), created, prisma };
}

const rule: CreateReconciliationRuleDto = {
  name: 'PIX de clientes',
  conditions: { descriptionContains: 'PIX', direction: 'CREDITO' } as never,
  actions: { autoReconcile: true, minScore: '90.00' },
};

describe('ReconciliationRulesService.create', () => {
  it('grava tolerâncias como Decimal e aplica os padrões', async () => {
    const { service, created } = buildService();

    await service.create('empresa-1', rule);

    expect(created[0]).toMatchObject({ companyId: 'empresa-1', priority: 100, dayTolerance: 3 });
    expect(created[0].valueTolerance).toBeInstanceOf(Prisma.Decimal);
  });

  it('recusa regra sem condição: ela casaria com todo movimento', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', { ...rule, conditions: {} as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa conciliação automática sem piso de confiança', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', { ...rule, actions: { autoReconcile: true } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa a regra que concilia e ignora ao mesmo tempo', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', {
        ...rule,
        actions: { autoReconcile: true, minScore: '90.00', markIgnored: true },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa faixa de valor invertida', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', {
        ...rule,
        conditions: { minAmount: '100.00', maxAmount: '50.00' } as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa nome repetido na mesma empresa', async () => {
    const { service } = buildService({ id: 'regra-existente' });

    await expect(service.create('empresa-1', rule)).rejects.toBeInstanceOf(ConflictException);
  });

  it('não grava chave ausente como null no jsonb', async () => {
    const { service, created } = buildService();

    await service.create('empresa-1', {
      ...rule,
      conditions: { descriptionContains: 'PIX', documentEquals: undefined } as never,
    });

    expect(created[0].conditions).toEqual({ descriptionContains: 'PIX' });
  });
});

describe('ReconciliationRulesService.deactivate', () => {
  it('desativa em vez de remover: a regra explica conciliações já feitas', async () => {
    const { service, prisma } = buildService({
      id: 'regra-1',
      name: 'PIX',
      conditions: {},
      actions: {},
    });

    await service.deactivate('empresa-1', 'regra-1');

    expect(prisma.db.reconciliationRule.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });

  it('não alcança a regra de outra empresa', async () => {
    const { service, prisma } = buildService(null);

    await expect(service.deactivate('empresa-2', 'regra-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.db.reconciliationRule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'regra-1', companyId: 'empresa-2' } }),
    );
  });
});
