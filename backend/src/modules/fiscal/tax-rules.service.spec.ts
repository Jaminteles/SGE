import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReferencesService } from '../../common/references/references.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TaxOperationType } from '../../common/enums';
import { TaxClassificationsService } from './tax-classifications.service';
import { TaxRulesService } from './tax-rules.service';

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reg-1',
    name: 'Regra',
    priority: 100,
    originState: null,
    destinationState: null,
    operationType: null,
    classificationId: null,
    productId: null,
    productCategoryId: null,
    cfop: null,
    icmsCst: null,
    icmsRate: null,
    icmsBaseReduction: null,
    conditions: {},
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildService(
  options: {
    candidates?: Record<string, unknown>[];
    row?: Record<string, unknown> | null;
    usableClassification?: Record<string, unknown> | null;
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const queries: Record<string, unknown>[] = [];

  const prisma = {
    db: {
      taxRule: {
        findMany: jest.fn((args: { where: Record<string, unknown> }) => {
          queries.push(args.where);
          return Promise.resolve(options.candidates ?? []);
        }),
        findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
          queries.push(args.where);
          return Promise.resolve(options.row === undefined ? rule() : options.row);
        }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ ...rule(), ...data });
        }),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...rule(), ...data }),
        ),
      },
    },
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;

  const classifications = {
    findUsable: jest
      .fn()
      .mockResolvedValue(
        options.usableClassification === undefined ? { id: 'cls-1' } : options.usableClassification,
      ),
  } as unknown as TaxClassificationsService;

  return {
    service: new TaxRulesService(prisma, references, classifications),
    created,
    queries,
    references,
    classifications,
  };
}

describe('TaxRulesService.create', () => {
  it('grava a regra com o critério informado (RF-091)', async () => {
    const { service, created } = buildService();

    await service.create('empresa-1', {
      name: 'Compra interna',
      operationType: TaxOperationType.COMPRA,
      cfop: '1102',
    });

    expect(created[0]).toMatchObject({
      companyId: 'empresa-1',
      operationType: 'COMPRA',
      cfop: '1102',
      priority: 100,
    });
  });

  it('recusa regra sem critério: ela casaria com toda operação da empresa', async () => {
    const { service } = buildService();

    await expect(service.create('empresa-1', { name: 'Vale tudo' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa classificação inativa ou de outra empresa sem dizer que ela existe', async () => {
    const { service } = buildService({ usableClassification: null });

    await expect(
      service.create('empresa-1', { name: 'Regra', classificationId: 'cls-de-outra' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TaxRulesService.resolve', () => {
  it('escolhe a de menor prioridade (RF-091)', async () => {
    const { service } = buildService({
      candidates: [
        rule({ id: 'geral', priority: 100, operationType: 'COMPRA' }),
        rule({ id: 'especifica', priority: 10, operationType: 'COMPRA' }),
      ],
    });

    const resolution = await service.resolve('empresa-1', {
      operationType: TaxOperationType.COMPRA,
    });

    expect(resolution.matched?.id).toBe('especifica');
    expect(resolution.alternatives.map((r) => r.id)).toEqual(['geral']);
  });

  it('empatada a prioridade, vence a de critérios mais específicos', async () => {
    const { service } = buildService({
      candidates: [
        rule({ id: 'por-operacao', priority: 50, operationType: 'COMPRA' }),
        rule({ id: 'por-produto', priority: 50, productId: 'prod-1' }),
      ],
    });

    const resolution = await service.resolve('empresa-1', {
      operationType: TaxOperationType.COMPRA,
      productId: 'prod-1',
    });

    expect(resolution.matched?.id).toBe('por-produto');
  });

  it('consulta só regras vigentes e ativas da empresa', async () => {
    const { service, queries } = buildService({ candidates: [] });

    const resolution = await service.resolve('empresa-1', {
      operationType: TaxOperationType.VENDA,
      onDate: '2026-06-01',
    });

    expect(resolution.matched).toBeNull();
    expect(queries[0]).toMatchObject({ companyId: 'empresa-1', isActive: true });
  });

  it('critério não informado só casa com regra que o deixa em branco', async () => {
    const { service, queries } = buildService({ candidates: [] });

    await service.resolve('empresa-1', { operationType: TaxOperationType.COMPRA });

    const where = queries[0] as { AND: Record<string, unknown>[] };
    expect(where.AND).toContainEqual({ productId: null });
    expect(where.AND).toContainEqual({
      OR: [{ operationType: 'COMPRA' }, { operationType: null }],
    });
  });
});

describe('TaxRulesService.findOne', () => {
  it('devolve 404 para regra de outra empresa: id na rota não atravessa tenant', async () => {
    const { service, queries } = buildService({ row: null });

    await expect(service.findOne('empresa-1', 'reg-de-outra')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(queries[0]).toMatchObject({ id: 'reg-de-outra', companyId: 'empresa-1' });
  });
});
