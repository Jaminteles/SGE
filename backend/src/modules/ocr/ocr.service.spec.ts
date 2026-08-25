import { ConflictException, NotFoundException } from '@nestjs/common';
import { OcrStatus } from '@prisma/client';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { FileStorageService, UploadedFile } from '../../common/storage/file-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from './ocr.service';

const FILE: UploadedFile = {
  originalname: 'cupom.png',
  mimetype: 'image/png',
  size: 4,
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
};

function processingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ocr-1',
    companyId: 'empresa-1',
    documentId: 'doc-1',
    status: OcrStatus.PENDENTE,
    extractedText: null,
    confidence: null,
    amount: null,
    issueDate: null,
    merchantName: null,
    merchantDocument: null,
    documentKey: null,
    documentNumber: null,
    suggestedPartnerId: null,
    suggestedCategoryId: null,
    suggestedCostCenterId: null,
    corrections: null,
    validatedById: null,
    validatedAt: null,
    error: null,
    attempts: 0,
    createdAt: new Date('2026-09-07T12:00:00Z'),
    updatedAt: new Date('2026-09-07T12:00:00Z'),
    document: { fileName: 'cupom.png' },
    ...overrides,
  };
}

function buildService(existing: Record<string, unknown> | null = null) {
  const created: Record<string, unknown>[] = [];
  const documentUpdates: Record<string, unknown>[] = [];

  const prisma = {
    db: {
      ocrProcessing: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve(processingRow({ ...data, document: undefined }));
        }),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve(processingRow(data)),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      storedDocument: {
        create: jest.fn().mockResolvedValue({ id: 'doc-1', fileName: 'cupom.png' }),
        update: jest.fn((args: { data: Record<string, unknown> }) => {
          documentUpdates.push(args.data);
          return Promise.resolve({});
        }),
      },
    },
    transaction: <T>(fn: () => Promise<T>) => fn(),
  } as unknown as PrismaService;

  const storage = {
    save: jest.fn().mockResolvedValue({
      fileName: 'cupom.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      sha256: 'abc',
      storageProvider: 'LOCAL',
      storageKey: 'empresa-1/ocr/2026/uuid.png',
    }),
    read: jest.fn().mockResolvedValue(Buffer.from('conteudo')),
  } as unknown as FileStorageService;

  const queue = { enqueue: jest.fn().mockResolvedValue('job-1') } as unknown as JobQueueService;

  return {
    service: new OcrService(prisma, storage, queue),
    prisma,
    storage,
    queue,
    created,
    documentUpdates,
  };
}

describe('OcrService.receive', () => {
  it('grava documento e processamento e enfileira a leitura (RF-095/RF-096)', async () => {
    const { service, storage, queue, created } = buildService();

    const result = await service.receive('empresa-1', 'COMPROVANTE', FILE, 'usuario-1');

    expect(storage.save).toHaveBeenCalledWith('empresa-1', 'ocr', FILE);
    expect(created[0]).toMatchObject({ companyId: 'empresa-1', status: OcrStatus.PENDENTE });
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'ocr', idempotencyKey: 'ocr:ocr-1' }),
    );
    expect(result.status).toBe(OcrStatus.PENDENTE);
  });

  it('devolve o processamento existente no reenvio do mesmo arquivo, sem gravar de novo', async () => {
    const { service, storage, queue } = buildService(processingRow());

    const result = await service.receive('empresa-1', 'COMPROVANTE', FILE, 'usuario-1');

    expect(result.id).toBe('ocr-1');
    expect(storage.save).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('procura o duplicado antes de gravar: 409 não pode deixar arquivo órfão', async () => {
    const { service, prisma } = buildService(processingRow());

    await service.receive('empresa-1', 'COMPROVANTE', FILE, 'usuario-1');

    expect(prisma.db.ocrProcessing.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'empresa-1' }),
      }),
    );
  });
});

describe('OcrService.findOne', () => {
  it('não alcança o processamento de outra empresa trocando o id na rota (RN-001)', async () => {
    const { service, prisma } = buildService(null);

    await expect(service.findOne('empresa-1', 'ocr-de-outra')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.db.ocrProcessing.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ocr-de-outra', companyId: 'empresa-1' },
      }),
    );
  });
});

describe('OcrService.reprocess', () => {
  it('devolve à fila o processamento em ERRO e limpa a causa (RF-096)', async () => {
    const { service, queue } = buildService(processingRow({ status: OcrStatus.ERRO }));

    const result = await service.reprocess('empresa-1', 'ocr-1');

    expect(result.status).toBe(OcrStatus.PENDENTE);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('recusa reprocessar o que já foi lido: trocaria o texto sob a revisão', async () => {
    const { service, queue } = buildService(processingRow({ status: OcrStatus.PROCESSADO }));

    await expect(service.reprocess('empresa-1', 'ocr-1')).rejects.toBeInstanceOf(ConflictException);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('recusa a vigésima primeira tentativa em vez de deixar o CHECK do banco virar 500', async () => {
    const { service } = buildService(processingRow({ status: OcrStatus.ERRO, attempts: 20 }));

    await expect(service.reprocess('empresa-1', 'ocr-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa reprocessar leitura já validada', async () => {
    const { service } = buildService(processingRow({ status: OcrStatus.VALIDADO }));

    await expect(service.reprocess('empresa-1', 'ocr-1')).rejects.toBeInstanceOf(ConflictException);
  });
});
