import { BadRequestException, ConflictException } from '@nestjs/common';
import { EntryType, FiscalDocumentStatus, Prisma, StockMovementType } from '@prisma/client';
import { FiscalPostingsService } from './fiscal-postings.service';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesService } from '../../common/references/references.service';
import { StockMovementsService, MOVEMENT_ORIGIN } from '../stock/stock-movements.service';
import { ENTRY_ORIGIN, FinancialEntriesService } from '../finance/financial-entries.service';

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    sequence: 1,
    productId: 'prod-1',
    product: { id: 'prod-1', code: 'CIM-01', description: 'Cimento', tracksStock: true },
    quantity: new Prisma.Decimal('10'),
    unitPrice: new Prisma.Decimal('38.5'),
    lineAmount: new Prisma.Decimal('385'),
    ...overrides,
  };
}

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    companyId: 'empresa-1',
    number: '4567',
    series: '1',
    status: FiscalDocumentStatus.PROCESSADO,
    accessKey: '35261112345678000195550010000045671123456782',
    issuerName: 'Fornecedora LTDA',
    issuerPartnerId: 'forn-1',
    purchaseOrderId: null,
    branchId: 'fil-1',
    issuedAt: new Date('2026-11-30T12:00:00Z'),
    movedAt: null,
    freightAmount: new Prisma.Decimal('0'),
    insuranceAmount: new Prisma.Decimal('0'),
    otherExpenseAmount: new Prisma.Decimal('0'),
    totalAmount: new Prisma.Decimal('385'),
    generatedStock: false,
    generatedPayable: false,
    items: [item()],
    receipts: [],
    ...overrides,
  };
}

function buildService(current: Record<string, unknown> = document()) {
  const prisma = {
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;
  const documents = {
    findOne: jest.fn().mockResolvedValue(current),
  } as unknown as FiscalDocumentsService;
  const movements = { record: jest.fn().mockResolvedValue([]) } as unknown as StockMovementsService;
  const entries = {
    createEntry: jest.fn().mockResolvedValue({ id: 'tit-1' }),
  } as unknown as FinancialEntriesService;

  return {
    service: new FiscalPostingsService(prisma, references, documents, movements, entries),
    movements,
    entries,
  };
}

describe('FiscalPostingsService', () => {
  it('dá entrada no estoque pelo custo posto e gera o título do total da nota', async () => {
    // 20,00 de frete no cabeçalho, rateados na única linha: 2,00 por unidade.
    const { service, movements, entries } = buildService(
      document({
        freightAmount: new Prisma.Decimal('20'),
        totalAmount: new Prisma.Decimal('405'),
      }),
    );

    await service.post(
      'empresa-1',
      'doc-1',
      { generateStock: true, generatePayable: true, locationId: 'loc-1' },
      'user-1',
    );

    const [, [movement]] = (movements.record as jest.Mock).mock.calls[0];
    expect(movement).toMatchObject({
      productId: 'prod-1',
      locationId: 'loc-1',
      type: StockMovementType.ENTRADA,
      origin: MOVEMENT_ORIGIN.FISCAL_DOCUMENT,
      // O item, e não o documento: é a granularidade do índice único de bd/12.
      originId: 'item-1',
      fiscalDocumentId: 'doc-1',
    });
    expect((movement.unitCost as Prisma.Decimal).toFixed(2)).toBe('40.50');

    const [, dto, , source] = (entries.createEntry as jest.Mock).mock.calls[0];
    expect(dto).toMatchObject({
      type: EntryType.PAGAR,
      grossAmount: '405.00',
      partnerId: 'forn-1',
    });
    expect(source).toMatchObject({
      origin: ENTRY_ORIGIN.FISCAL_DOCUMENT,
      originId: 'doc-1',
      fiscalDocumentId: 'doc-1',
    });
  });

  it('exige ao menos um efeito', async () => {
    const { service } = buildService();

    await expect(
      service.post(
        'empresa-1',
        'doc-1',
        { generateStock: false, generatePayable: false },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa documento que não está processado', async () => {
    const { service } = buildService(document({ status: FiscalDocumentStatus.ERRO }));

    await expect(
      service.post('empresa-1', 'doc-1', { generateStock: false, generatePayable: true }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // RN-004: a marca é projeção do que existe no banco (bd/12) e cobre as duas
  // portas — inclusive o efeito produzido pelo recebimento desta nota.
  it('recusa repetir efeito já gerado', async () => {
    const stocked = buildService(document({ generatedStock: true }));
    await expect(
      stocked.service.post(
        'empresa-1',
        'doc-1',
        { generateStock: true, generatePayable: false, locationId: 'loc-1' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const paid = buildService(document({ generatedPayable: true }));
    await expect(
      paid.service.post(
        'empresa-1',
        'doc-1',
        { generateStock: false, generatePayable: true },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // Com pedido e conferência, quem dá entrada é o recebimento: a nota se vincula.
  it('recusa gerar efeito quando a nota tem recebimento', async () => {
    const { service } = buildService(
      document({ receipts: [{ id: 'rec-1', number: 'RC-2026-000001', generatedStock: true }] }),
    );

    await expect(
      service.post(
        'empresa-1',
        'doc-1',
        { generateStock: true, generatePayable: false, locationId: 'loc-1' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa gerar efeito sem fornecedor vinculado', async () => {
    const { service } = buildService(document({ issuerPartnerId: null }));

    await expect(
      service.post('empresa-1', 'doc-1', { generateStock: false, generatePayable: true }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // Dar entrada em parte da nota deixaria o resto invisível — e ninguém procura
  // o que não aparece.
  it('recusa dar entrada com item sem produto vinculado', async () => {
    const { service } = buildService(
      document({ items: [item(), item({ id: 'item-2', sequence: 2, productId: null })] }),
    );

    await expect(
      service.post(
        'empresa-1',
        'doc-1',
        { generateStock: true, generatePayable: false, locationId: 'loc-1' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('exige o local de estoque na entrada', async () => {
    const { service } = buildService();

    await expect(
      service.post('empresa-1', 'doc-1', { generateStock: true, generatePayable: false }, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa entrada quando nenhum item controla estoque', async () => {
    const { service } = buildService(
      document({
        items: [
          item({
            product: { id: 'prod-1', code: 'SRV-01', description: 'Frete', tracksStock: false },
          }),
        ],
      }),
    );

    await expect(
      service.post(
        'empresa-1',
        'doc-1',
        { generateStock: true, generatePayable: false, locationId: 'loc-1' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
