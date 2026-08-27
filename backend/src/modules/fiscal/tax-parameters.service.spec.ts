import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TaxRegime } from '@prisma/client';
import { ReferencesService } from '../../common/references/references.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TaxParametersService } from './tax-parameters.service';

function parameter(overrides: Record<string, unknown> = {}) {
  return {
    id: 'par-1',
    branchId: null,
    taxRegime: TaxRegime.LUCRO_PRESUMIDO,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    simplesRate: null,
    issRate: null,
    ipiTaxpayer: false,
    taxSubstitute: false,
    ...overrides,
  };
}

function buildService(
  options: {
    /** Respostas de `findFirst`, na ordem em que o serviço as consome. */
    findFirst?: (Record<string, unknown> | null)[];
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const queries: Record<string, unknown>[] = [];
  const answers = [...(options.findFirst ?? [])];

  const prisma = {
    db: {
      taxParameter: {
        findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
          queries.push(args.where);
          return Promise.resolve(answers.length ? (answers.shift() ?? null) : null);
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ ...parameter(), ...data });
        }),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...parameter(), ...data }),
        ),
      },
    },
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;

  return { service: new TaxParametersService(prisma, references), created, queries, references };
}

describe('TaxParametersService.create', () => {
  it('grava o parâmetro vigente da empresa (RF-088)', async () => {
    const { service, created } = buildService();

    await service.create('empresa-1', {
      taxRegime: TaxRegime.LUCRO_REAL,
      effectiveFrom: '2026-01-01',
    });

    expect(created[0]).toMatchObject({
      companyId: 'empresa-1',
      taxRegime: TaxRegime.LUCRO_REAL,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
    });
  });

  it('recusa alíquota do Simples fora do Simples: ela entraria na apuração de quem não está nele', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', {
        taxRegime: TaxRegime.LUCRO_REAL,
        effectiveFrom: '2026-01-01',
        simplesRate: '6.00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa vigência sobreposta: a mesma data teria duas respostas de regime', async () => {
    const { service } = buildService({ findFirst: [parameter()] });

    await expect(
      service.create('empresa-1', {
        taxRegime: TaxRegime.LUCRO_REAL,
        effectiveFrom: '2026-06-01',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa fim de vigência anterior ao início', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', {
        taxRegime: TaxRegime.LUCRO_REAL,
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-05-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TaxParametersService.resolve', () => {
  it('prefere o parâmetro da filial ao da empresa (RF-088)', async () => {
    const { service, queries } = buildService({
      findFirst: [parameter({ id: 'par-filial', branchId: 'filial-1' })],
    });

    const found = await service.resolve('empresa-1', new Date('2026-06-01'), 'filial-1');

    expect(found?.id).toBe('par-filial');
    expect(queries[0]).toMatchObject({ companyId: 'empresa-1', branchId: 'filial-1' });
  });

  it('cai no parâmetro da empresa quando a filial não tem o seu', async () => {
    const { service, queries } = buildService({
      findFirst: [null, parameter({ id: 'par-empresa' })],
    });

    const found = await service.resolve('empresa-1', new Date('2026-06-01'), 'filial-1');

    expect(found?.id).toBe('par-empresa');
    expect(queries[1]).toMatchObject({ companyId: 'empresa-1', branchId: null });
  });
});

describe('TaxParametersService.findOne', () => {
  it('devolve 404 para parâmetro de outra empresa: id na rota não atravessa tenant', async () => {
    const { service, queries } = buildService({ findFirst: [null] });

    await expect(service.findOne('empresa-1', 'par-de-outra')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(queries[0]).toMatchObject({ id: 'par-de-outra', companyId: 'empresa-1' });
  });
});
