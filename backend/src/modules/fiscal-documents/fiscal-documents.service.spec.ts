import { BadRequestException, ConflictException } from '@nestjs/common';
import { FiscalDocumentOrigin, FiscalDocumentStatus, Prisma } from '@prisma/client';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesService } from '../../common/references/references.service';
import { AuditService } from '../../common/audit/audit.service';
import { nfeAccessKey, nfeXml } from './__fixtures__/nfe';

/** CNPJ do destinatário no XML de teste: é a empresa ativa. */
const COMPANY_TAX_ID = '98765432000188';

interface Scenario {
  /** Documento já conhecido pelo hash do arquivo ou pela referência de origem. */
  known?: { id: string; number: string } | null;
  /** Original de que o XML importado seria duplicata. */
  original?: { id: string; number: string } | null;
  /** Documento devolvido por `findOne` — o estado corrente. */
  row?: Record<string, unknown>;
  companyTaxId?: string | null;
  supplier?: { id: string } | null;
  supplierProducts?: { supplierCode: string; productId: string }[];
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    companyId: 'empresa-1',
    number: '4567',
    series: '1',
    status: FiscalDocumentStatus.PROCESSADO,
    accessKey: nfeAccessKey(),
    issuerPartnerId: 'forn-1',
    purchaseOrderId: null,
    generatedStock: false,
    generatedPayable: false,
    attempts: 1,
    xmlContent: nfeXml(),
    items: [
      { id: 'item-1', sequence: 1, productId: null },
      { id: 'item-2', sequence: 2, productId: null },
    ],
    receipts: [],
    ...overrides,
  };
}

function buildService(scenario: Scenario = {}) {
  const created: { data?: Record<string, unknown> } = {};
  const updates: Record<string, unknown>[] = [];
  const itemUpdates: { where: { id: string }; data: Record<string, unknown> }[] = [];

  const documentDelegate = {
    findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      if (where.OR) return Promise.resolve(scenario.known ?? null);
      if (where.accessKey) return Promise.resolve(scenario.original ?? null);
      return Promise.resolve(scenario.row ?? documentRow());
    }),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      created.data = data;
      return Promise.resolve({ id: 'doc-1' });
    }),
    update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      updates.push(data);
      return Promise.resolve({ id: 'doc-1' });
    }),
  };

  const prisma = {
    db: {
      fiscalDocument: documentDelegate,
      fiscalDocumentItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
          itemUpdates.push(args);
          return Promise.resolve({});
        }),
      },
      company: jest.fn(),
      branch: { findFirst: jest.fn().mockResolvedValue(null) },
      partner: { findFirst: jest.fn().mockResolvedValue(scenario.supplier ?? { id: 'forn-1' }) },
      productSupplier: {
        findMany: jest.fn().mockResolvedValue(scenario.supplierProducts ?? []),
      },
      purchaseOrder: { findFirst: jest.fn().mockResolvedValue({ id: 'ped-1' }) },
    },
    transaction: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  } as unknown as PrismaService;

  // `company` é delegate, não função: atribuído aqui para não confundir o tipo.
  (prisma.db as unknown as { company: { findFirst: jest.Mock } }).company = {
    findFirst: jest.fn().mockResolvedValue({
      taxId: scenario.companyTaxId === undefined ? COMPANY_TAX_ID : scenario.companyTaxId,
      cpf: null,
    }),
  };

  const references = {
    assert: jest.fn().mockResolvedValue(undefined),
  } as unknown as ReferencesService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return {
    service: new FiscalDocumentsService(prisma, references, audit),
    created,
    updates,
    itemUpdates,
    documentDelegate,
  };
}

const manualImport = { origin: FiscalDocumentOrigin.UPLOAD_MANUAL };

describe('FiscalDocumentsService — importação', () => {
  it('grava o documento processado com itens, XML e hash', async () => {
    const { service, created } = buildService();

    const result = await service.import('empresa-1', nfeXml(), manualImport, 'user-1');

    expect(result.outcome).toBe('IMPORTADO');
    expect(created.data?.status).toBe(FiscalDocumentStatus.PROCESSADO);
    expect(created.data?.accessKey).toBe(nfeAccessKey());
    expect(created.data?.xmlHash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect((created.data?.items as { create: unknown[] }).create).toHaveLength(2);
    expect(created.data?.issuerPartnerId).toBe('forn-1');
  });

  // RF-045: a nota é documento de terceiro — o banco não reescreve os valores
  // dela para que fechem. O que não fecha fica visível e sem efeito, mas com as
  // linhas gravadas: é comparando-as com o total declarado que alguém entende o
  // problema.
  it('marca ERRO e mantém os itens quando eles não somam o total informado', async () => {
    const { service, created } = buildService();

    const result = await service.import(
      'empresa-1',
      nfeXml({ productsAmount: '900.00' }),
      manualImport,
    );

    expect(result.outcome).toBe('ERRO');
    expect(created.data?.status).toBe(FiscalDocumentStatus.ERRO);
    expect(created.data?.processingError).toMatch('produtos');
    expect((created.data?.items as { create: unknown[] }).create).toHaveLength(2);
  });

  // Linha inconsistente é o caso em que os itens ficam de fora: bd/12 recusa a
  // linha cujo total não bate com a composição, e o INSERT viraria 500.
  it('marca ERRO sem gravar itens quando a composição de uma linha não fecha', async () => {
    const { service, created } = buildService();

    const result = await service.import(
      'empresa-1',
      nfeXml({
        items: [
          {
            code: 'CIM-01',
            description: 'Cimento CP-II 50kg',
            quantity: '10.0000',
            unitPrice: '38.5000',
            total: '999.00',
          },
        ],
      }),
      manualImport,
    );

    expect(result.outcome).toBe('ERRO');
    expect(created.data?.processingError).toMatch('item 1');
    expect((created.data?.items as { create: unknown[] }).create).toHaveLength(0);
  });

  // Nota cancelada ou denegada que virasse título a pagar seria dinheiro saindo
  // por um documento que não existe mais.
  it('marca ERRO quando o protocolo não autoriza a nota', async () => {
    const { service, created } = buildService();

    const result = await service.import(
      'empresa-1',
      nfeXml({ protocolStatus: '110' }),
      manualImport,
    );

    expect(result.outcome).toBe('ERRO');
    expect(created.data?.processingError).toMatch('110');
  });

  // RN-001: importar para a empresa A a nota destinada à empresa B misturaria o
  // crédito de imposto e o estoque de duas contabilidades.
  it('marca ERRO quando o destinatário não é a empresa ativa', async () => {
    const { service, created } = buildService({ companyTaxId: '11222333000181' });

    const result = await service.import('empresa-1', nfeXml(), manualImport);

    expect(result.outcome).toBe('ERRO');
    expect(created.data?.processingError).toMatch('destinatário');
  });

  it('devolve o documento existente quando o mesmo arquivo é reenviado', async () => {
    const { service, created } = buildService({ known: { id: 'doc-1', number: '4567' } });

    const result = await service.import('empresa-1', nfeXml(), manualImport);

    expect(result.outcome).toBe('JA_IMPORTADO');
    expect(created.data).toBeUndefined();
  });

  // Chave igual com conteúdo diferente é nota reemitida ou arquivo alterado: o
  // documento nasce DUPLICADO apontando o original, para uma pessoa decidir.
  it('marca DUPLICADO quando a chave já existe com outro conteúdo', async () => {
    const { service, created } = buildService({ original: { id: 'doc-0', number: '4567' } });

    const result = await service.import(
      'empresa-1',
      nfeXml({ totalAmount: '745.00' }),
      manualImport,
    );

    expect(result.outcome).toBe('DUPLICADO');
    expect(created.data?.status).toBe(FiscalDocumentStatus.DUPLICADO);
    expect(created.data?.duplicateOfId).toBe('doc-0');
  });

  // RF-047: vínculo automático só por código homologado com aquele fornecedor.
  it('vincula o item ao produto pelo código do fornecedor', async () => {
    const { service, created } = buildService({
      supplierProducts: [{ supplierCode: 'CIM-01', productId: 'prod-1' }],
    });

    await service.import('empresa-1', nfeXml(), manualImport);

    const items = (created.data?.items as { create: { productId?: string }[] }).create;
    expect(items[0].productId).toBe('prod-1');
    expect(items[1].productId).toBeUndefined();
  });
});

describe('FiscalDocumentsService — coleta (RF-050)', () => {
  it('reporta o resultado de cada documento e não derruba o lote por um XML ruim', async () => {
    const { service } = buildService();

    const summary = await service.collect('empresa-1', {
      documents: [
        { xml: nfeXml(), originReference: 'lote-1/nota-1' },
        { xml: '<CTe><infCte/></CTe>', originReference: 'lote-1/nota-2' },
      ],
    });

    expect(summary.received).toBe(2);
    expect(summary.imported).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.results[1]).toMatchObject({
      originReference: 'lote-1/nota-2',
      outcome: 'RECUSADO',
    });
  });

  it('usa COLETA_AUTOMATICA como origem padrão e registra a referência', async () => {
    const { service, created } = buildService();

    await service.collect('empresa-1', {
      documents: [{ xml: nfeXml(), originReference: 'lote-9/nota-1' }],
    });

    expect(created.data?.origin).toBe(FiscalDocumentOrigin.COLETA_AUTOMATICA);
    expect(created.data?.originReference).toBe('lote-9/nota-1');
    expect(created.data?.collectedAt).toBeInstanceOf(Date);
  });
});

describe('FiscalDocumentsService — vínculos, reprocessamento e descarte', () => {
  it('aplica o vínculo de produto no item do próprio documento', async () => {
    const { service, itemUpdates, updates } = buildService();

    await service.link('empresa-1', 'doc-1', {
      purchaseOrderId: 'ped-1',
      items: [{ itemId: 'item-2', productId: 'prod-2' }],
    });

    expect(updates[0]).toEqual({ purchaseOrderId: 'ped-1' });
    expect(itemUpdates).toEqual([{ where: { id: 'item-2' }, data: { productId: 'prod-2' } }]);
  });

  it('recusa vincular item que não é do documento', async () => {
    const { service } = buildService();

    await expect(
      service.link('empresa-1', 'doc-1', { items: [{ itemId: 'item-9', productId: 'prod-2' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa vínculo em documento cancelado', async () => {
    const { service } = buildService({
      row: documentRow({ status: FiscalDocumentStatus.CANCELADO }),
    });

    await expect(service.link('empresa-1', 'doc-1', { branchId: 'fil-1' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  // RF-049: reprocessar é reler o mesmo XML — passando por PROCESSANDO, que é o
  // estado em que bd/12 permite reescrever os itens.
  it('reprocessa o XML armazenado e reescreve os itens', async () => {
    const { service, updates } = buildService({
      row: documentRow({ status: FiscalDocumentStatus.ERRO }),
    });

    const result = await service.reprocess('empresa-1', 'doc-1');

    expect(result.outcome).toBe('IMPORTADO');
    expect(updates[0]).toMatchObject({ status: FiscalDocumentStatus.PROCESSANDO, attempts: 2 });
    expect(updates[1]).toMatchObject({ status: FiscalDocumentStatus.PROCESSADO });
  });

  it('recusa reprocessar documento já processado', async () => {
    const { service } = buildService();

    await expect(service.reprocess('empresa-1', 'doc-1')).rejects.toBeInstanceOf(ConflictException);
  });

  // RN-004: desfazer estoque é lançamento contrário no razão, e título indevido
  // se cancela no M08 — descartar a nota não faria nem um nem outro.
  it('recusa descartar documento que já gerou efeito', async () => {
    const { service } = buildService({ row: documentRow({ generatedPayable: true }) });

    await expect(
      service.cancel('empresa-1', 'doc-1', { reason: 'Nota lançada em duplicidade' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('descarta o documento sem efeito, com motivo', async () => {
    const { service, updates } = buildService();

    await service.cancel('empresa-1', 'doc-1', { reason: 'Nota de outro estabelecimento' });

    expect(updates[0]).toEqual({ status: FiscalDocumentStatus.CANCELADO });
  });
});

describe('FiscalDocumentsService — upload', () => {
  it('recusa arquivo vazio e conteúdo binário', async () => {
    const { service } = buildService();
    const upload = (buffer: Buffer) => ({
      originalname: 'nota.xml',
      mimetype: 'application/xml',
      size: buffer.length,
      buffer,
    });

    await expect(
      service.importUpload('empresa-1', upload(Buffer.alloc(0)), manualImport),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.importUpload('empresa-1', upload(Buffer.from([0x50, 0x00, 0x4b])), manualImport),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aceita XML com BOM', async () => {
    const { service, created } = buildService();
    const buffer = Buffer.from(`﻿${nfeXml()}`, 'utf8');

    await service.importUpload(
      'empresa-1',
      {
        originalname: 'nota.xml',
        mimetype: 'application/octet-stream',
        size: buffer.length,
        buffer,
      },
      manualImport,
    );

    expect(created.data?.status).toBe(FiscalDocumentStatus.PROCESSADO);
  });
});

describe('FiscalDocumentsService — consulta', () => {
  it('compõe pendência e busca textual em AND, sem um apagar o outro', async () => {
    const { service, documentDelegate } = buildService();

    await service.findAll('empresa-1', {
      page: 1,
      pageSize: 20,
      pendingOnly: true,
      q: '4567',
      skip: 0,
      take: 20,
    } as never);

    const where = documentDelegate.findMany.mock.calls[0][0].where as {
      AND: { OR: unknown[] }[];
    };
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0].OR.length).toBeGreaterThan(1);
  });
});

describe('Prisma.Decimal', () => {
  // Guarda de sanidade do cálculo usado nas conferências: string entra, string
  // sai, e centavos não passam por ponto flutuante (RN-012).
  it('soma centavos sem erro de arredondamento', () => {
    expect(new Prisma.Decimal('0.1').plus('0.2').toFixed(2)).toBe('0.30');
  });
});
