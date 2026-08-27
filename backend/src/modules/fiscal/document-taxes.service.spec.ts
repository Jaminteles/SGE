import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentTaxesService } from './document-taxes.service';
import { TaxClassificationsService } from './tax-classifications.service';

const decimal = (value: string) => new Prisma.Decimal(value);

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    number: '1234',
    series: '1',
    accessKey: null,
    issuedAt: new Date('2026-06-10T00:00:00.000Z'),
    status: 'PROCESSADO',
    productsAmount: decimal('1000.00'),
    totalAmount: decimal('1000.00'),
    icmsAmount: decimal('180.00'),
    icmsStAmount: decimal('0.00'),
    ipiAmount: decimal('0.00'),
    pisAmount: decimal('0.00'),
    cofinsAmount: decimal('0.00'),
    issAmount: decimal('0.00'),
    ...overrides,
  };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    sequence: 1,
    description: 'Notebook',
    ncm: '84713012',
    cest: null,
    cfop: '1102',
    quantity: decimal('1'),
    unitPrice: decimal('1000'),
    lineAmount: decimal('1000.00'),
    icmsCst: '00',
    icmsBase: decimal('1000.00'),
    icmsRate: decimal('18.000000'),
    icmsAmount: decimal('180.00'),
    icmsStAmount: decimal('0.00'),
    ipiAmount: decimal('0.00'),
    pisAmount: decimal('0.00'),
    cofinsAmount: decimal('0.00'),
    classificationId: null,
    classification: null,
    ...overrides,
  };
}

function buildService(
  options: {
    doc?: Record<string, unknown> | null;
    items?: Record<string, unknown>[];
    usable?: Record<string, unknown> | null;
    catalog?: { id: string; code: string }[];
  } = {},
) {
  const updates: Record<string, unknown>[] = [];
  const updateManyCalls: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const queries: Record<string, unknown>[] = [];

  const prisma = {
    db: {
      fiscalDocument: {
        findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
          queries.push(args.where);
          return Promise.resolve(options.doc === undefined ? document() : options.doc);
        }),
      },
      fiscalDocumentItem: {
        findMany: jest.fn().mockResolvedValue(options.items ?? [item()]),
        findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
          queries.push(args.where);
          return Promise.resolve({ id: 'item-1' });
        }),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return Promise.resolve({ ...item(), ...data });
        }),
        updateMany: jest.fn(
          (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            updateManyCalls.push(args);
            return Promise.resolve({ count: 1 });
          },
        ),
      },
      taxClassification: {
        findMany: jest.fn().mockResolvedValue(options.catalog ?? []),
      },
    },
  } as unknown as PrismaService;

  const classifications = {
    findUsable: jest
      .fn()
      .mockResolvedValue(options.usable === undefined ? { id: 'cls-1' } : options.usable),
  } as unknown as TaxClassificationsService;

  return {
    service: new DocumentTaxesService(prisma, classifications),
    updates,
    updateManyCalls,
    queries,
    classifications,
  };
}

describe('DocumentTaxesService.summary', () => {
  it('devolve o declarado e a soma dos itens sem recalcular a nota (RF-090)', async () => {
    const { service } = buildService();

    const summary = await service.summary('empresa-1', 'doc-1');

    expect(summary.declared.icmsAmount.toString()).toBe('180');
    expect(summary.itemTotals.icmsAmount.toString()).toBe('180');
    expect(summary.unclassifiedItems).toBe(1);
  });

  it('aponta divergência entre a alíquota declarada e a esperada pelo NCM', async () => {
    const { service } = buildService({
      items: [
        item({
          classificationId: 'cls-1',
          classification: {
            id: 'cls-1',
            code: '84713012',
            description: 'Notebook',
            icmsRate: decimal('12.000000'),
            ipiRate: null,
          },
        }),
      ],
    });

    const summary = await service.summary('empresa-1', 'doc-1');

    expect(summary.divergences).toHaveLength(1);
    expect(summary.divergences[0]).toMatchObject({ sequence: 1, field: 'icmsRate' });
  });

  it('não inventa divergência quando o item não tem classificação', async () => {
    const { service } = buildService();

    const summary = await service.summary('empresa-1', 'doc-1');

    expect(summary.divergences).toHaveLength(0);
  });

  it('devolve 404 para documento de outra empresa: id na rota não atravessa tenant', async () => {
    const { service, queries } = buildService({ doc: null });

    await expect(service.summary('empresa-1', 'doc-de-outra')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(queries[0]).toMatchObject({ id: 'doc-de-outra', companyId: 'empresa-1' });
  });
});

describe('DocumentTaxesService.classify', () => {
  it('grava só o vínculo com a classificação; o declarado não é tocado (RF-090)', async () => {
    const { service, updates } = buildService();

    await service.classify('empresa-1', 'doc-1', { sequence: 1, classificationId: 'cls-1' });

    expect(updates[0]).toEqual({ classificationId: 'cls-1' });
  });

  it('aceita desfazer o vínculo', async () => {
    const { service, updates } = buildService();

    await service.classify('empresa-1', 'doc-1', { sequence: 1, classificationId: null });

    expect(updates[0]).toEqual({ classificationId: null });
  });

  it('recusa classificação inativa, de outro tipo ou de outra empresa com a mesma resposta', async () => {
    const { service } = buildService({ usable: null });

    await expect(
      service.classify('empresa-1', 'doc-1', { sequence: 1, classificationId: 'cls-de-outra' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DocumentTaxesService.autoClassify', () => {
  it('liga as linhas cujo NCM já existe e lista o que falta cadastrar (RF-090)', async () => {
    const { service, updateManyCalls } = buildService({
      items: [
        { id: 'item-1', ncm: '84713012' },
        { id: 'item-2', ncm: '99999999' },
      ],
      catalog: [{ id: 'cls-1', code: '84713012' }],
    });

    const result = await service.autoClassify('empresa-1', 'doc-1');

    expect(result).toEqual({ classified: 1, pending: ['99999999'] });
    expect(updateManyCalls[0].where).toMatchObject({ companyId: 'empresa-1' });
    expect(updateManyCalls[0].data).toEqual({ classificationId: 'cls-1' });
  });

  it('não faz nada quando toda linha já está classificada', async () => {
    const { service, updateManyCalls } = buildService({ items: [] });

    const result = await service.autoClassify('empresa-1', 'doc-1');

    expect(result).toEqual({ classified: 0, pending: [] });
    expect(updateManyCalls).toHaveLength(0);
  });
});
