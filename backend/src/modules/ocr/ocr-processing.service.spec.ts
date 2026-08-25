import { OcrStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PermanentJobError } from '../../common/queue/job.types';
import { FileStorageService } from '../../common/storage/file-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OcrExtractionService } from './ocr-extraction.service';
import { OcrProcessingService } from './ocr-processing.service';
import { OcrSuggestionsService } from './ocr-suggestions.service';
import { OcrProviderError, OcrResult } from './providers/ocr-provider.port';
import { OcrProviderResolver } from './providers/ocr-provider-resolver.service';

interface Options {
  existing?: Record<string, unknown> | null;
  extract?: () => Promise<OcrResult>;
  providerCode?: string;
}

function buildService(options: Options = {}) {
  const updates: Record<string, unknown>[] = [];
  const existing =
    options.existing === undefined
      ? {
          id: 'ocr-1',
          companyId: 'empresa-1',
          status: OcrStatus.PENDENTE,
          document: {
            fileName: 'cupom.png',
            mimeType: 'image/png',
            storageKey: 'empresa-1/ocr/2026/uuid.png',
          },
        }
      : options.existing;

  const prisma = {
    db: {
      ocrProcessing: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return Promise.resolve({ id: 'ocr-1', ...data });
        }),
      },
    },
  } as unknown as PrismaService;

  const storage = {
    read: jest.fn().mockResolvedValue(Buffer.from('binario')),
  } as unknown as FileStorageService;

  const extract =
    options.extract ??
    (() => Promise.resolve<OcrResult>({ text: 'MERCADO X\nTOTAL 120,00', confidence: '91.50' }));

  const resolver = {
    resolve: jest.fn().mockResolvedValue({
      providerId: 'provider-1',
      provider: { code: options.providerCode ?? 'OCR_GENERICO', extract: jest.fn(extract) },
      context: {
        companyId: 'empresa-1',
        providerCode: options.providerCode ?? 'OCR_GENERICO',
        capabilities: {},
        credentials: {},
        environment: 'PRODUCAO',
      },
    }),
  } as unknown as OcrProviderResolver;

  const suggestions = {
    suggest: jest.fn().mockResolvedValue({ partnerId: 'parceiro-1', reasons: ['motivo'] }),
  } as unknown as OcrSuggestionsService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  const service = new OcrProcessingService(
    prisma,
    storage,
    resolver,
    new OcrExtractionService(),
    suggestions,
    audit,
  );

  return { service, updates, prisma, storage, resolver, audit };
}

describe('OcrProcessingService.run', () => {
  it('marca a tentativa antes de chamar o provedor e grava o resultado (RF-096/RF-097)', async () => {
    const { service, updates, audit } = buildService();

    await service.run('empresa-1', 'ocr-1');

    expect(updates[0]).toMatchObject({
      status: OcrStatus.PROCESSANDO,
      providerId: 'provider-1',
      attempts: { increment: 1 },
    });
    expect(updates[1]).toMatchObject({
      status: OcrStatus.PROCESSADO,
      merchantName: 'MERCADO X',
      suggestedPartnerId: 'parceiro-1',
    });
    expect(updates[1].amount?.toString()).toBe('120');
    expect(updates[1].confidence?.toString()).toBe('91.5');
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('sai sem chamar o provedor quando o job repete sobre leitura já concluída', async () => {
    const { service, updates, resolver, storage } = buildService({
      existing: { id: 'ocr-1', companyId: 'empresa-1', status: OcrStatus.VALIDADO, document: {} },
    });

    await service.run('empresa-1', 'ocr-1');

    expect(updates).toHaveLength(0);
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('recusa de forma permanente o processamento que não existe mais', async () => {
    const { service } = buildService({ existing: null });

    await expect(service.run('empresa-1', 'ocr-1')).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('marca ERRO e devolve a falha à fila quando o provedor está fora (RF-070)', async () => {
    const { service, updates } = buildService({
      extract: () =>
        Promise.reject(new OcrProviderError('Provedor não respondeu.', 'INDISPONIVEL', true)),
    });

    await expect(service.run('empresa-1', 'ocr-1')).rejects.toBeInstanceOf(OcrProviderError);
    expect(updates[1]).toMatchObject({ status: OcrStatus.ERRO });
    expect(updates[1].error).toContain('INDISPONIVEL');
  });

  it('encerra em ERRO, sem reagendar, quando a falha não melhora com repetição', async () => {
    const { service, updates } = buildService({
      extract: () =>
        Promise.reject(new OcrProviderError('Arquivo recusado.', 'RESPOSTA_INVALIDA', false)),
    });

    await expect(service.run('empresa-1', 'ocr-1')).resolves.toBeUndefined();
    expect(updates[1]).toMatchObject({ status: OcrStatus.ERRO });
  });

  it('aceita a leitura vazia do provedor manual: o documento vai para a pessoa (RF-099)', async () => {
    const { service, updates } = buildService({
      providerCode: 'OCR_MANUAL',
      extract: () => Promise.resolve<OcrResult>({ text: '', raw: { automatic: false } }),
    });

    await service.run('empresa-1', 'ocr-1');

    expect(updates[1]).toMatchObject({
      status: OcrStatus.PROCESSADO,
      extractedText: null,
      confidence: null,
    });
  });
});
