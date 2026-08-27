import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TaxClassificationType } from '../../common/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { TaxClassificationsService } from './tax-classifications.service';

function classification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cls-1',
    type: TaxClassificationType.NCM,
    code: '84713012',
    description: 'Computadores portáteis',
    icmsRate: null,
    isActive: true,
    ...overrides,
  };
}

function buildService(
  options: { row?: Record<string, unknown> | null; activeRules?: number } = {},
) {
  const created: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const queries: Record<string, unknown>[] = [];

  const prisma = {
    db: {
      taxClassification: {
        findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
          queries.push(args.where);
          return Promise.resolve(options.row === undefined ? classification() : options.row);
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ ...classification(), ...data });
        }),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return Promise.resolve({ ...classification(), ...data });
        }),
      },
      taxRule: {
        count: jest.fn().mockResolvedValue(options.activeRules ?? 0),
      },
    },
  } as unknown as PrismaService;

  return { service: new TaxClassificationsService(prisma), created, updates, queries };
}

describe('TaxClassificationsService.create', () => {
  it('grava a classificação da empresa (RF-089)', async () => {
    const { service, created } = buildService();

    await service.create('empresa-1', {
      type: TaxClassificationType.NCM,
      code: '84713012',
      description: 'Computadores portáteis',
      icmsRate: '18.00',
    });

    expect(created[0]).toMatchObject({
      companyId: 'empresa-1',
      type: 'NCM',
      code: '84713012',
      icmsRate: '18.00',
    });
  });

  it('recusa NCM com sete dígitos: um código malformado nunca casa com item nenhum', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', {
        type: TaxClassificationType.NCM,
        code: '8471301',
        description: 'Errado',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa CFOP fora da faixa 1000-7999', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', {
        type: TaxClassificationType.CFOP,
        code: '9102',
        description: 'Inexistente',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TaxClassificationsService.deactivate', () => {
  it('inativa em vez de apagar: itens de notas recebidas continuam apontando para ela', async () => {
    const { service, updates } = buildService();

    await service.deactivate('empresa-1', 'cls-1');

    expect(updates[0]).toEqual({ isActive: false });
  });

  it('recusa inativar classificação com regra fiscal ativa', async () => {
    const { service } = buildService({ activeRules: 2 });

    await expect(service.deactivate('empresa-1', 'cls-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('TaxClassificationsService.findOne', () => {
  it('devolve 404 para classificação de outra empresa: id na rota não atravessa tenant', async () => {
    const { service, queries } = buildService({ row: null });

    await expect(service.findOne('empresa-1', 'cls-de-outra')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(queries[0]).toMatchObject({ id: 'cls-de-outra', companyId: 'empresa-1' });
  });
});
