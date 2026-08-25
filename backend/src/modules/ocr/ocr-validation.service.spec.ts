import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditEvent, OcrStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { ReferencesService } from '../../common/references/references.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OcrValidationService } from './ocr-validation.service';

function buildService(existing: Record<string, unknown> | null, referencesFail = false) {
  const updates: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];

  const prisma = {
    db: {
      ocrProcessing: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return Promise.resolve({
            ...existing,
            ...data,
            document: { fileName: 'cupom.png' },
          });
        }),
      },
    },
    transaction: <T>(fn: () => Promise<T>) => fn(),
  } as unknown as PrismaService;

  const references = {
    assert: jest.fn(() =>
      referencesFail
        ? Promise.reject(
            new BadRequestException('Categoria financeira inválida para esta empresa.'),
          )
        : Promise.resolve(),
    ),
  } as unknown as ReferencesService;

  const audit = {
    record: jest.fn((event: Record<string, unknown>) => {
      events.push(event);
      return Promise.resolve();
    }),
  } as unknown as AuditService;

  return {
    service: new OcrValidationService(prisma, references, audit),
    references,
    updates,
    events,
  };
}

function processed(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ocr-1',
    companyId: 'empresa-1',
    documentId: 'doc-1',
    status: OcrStatus.PROCESSADO,
    extractedText: 'MERCADO X\nTOTAL 120,00',
    amount: new Prisma.Decimal('120.00'),
    issueDate: new Date('2026-09-07T00:00:00Z'),
    merchantName: 'MERCADO X',
    merchantDocument: null,
    documentNumber: null,
    suggestedCategoryId: 'categoria-sugerida',
    suggestedCostCenterId: null,
    suggestedPartnerId: null,
    attempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('OcrValidationService.validate', () => {
  it('registra a decisão e quem a tomou (RF-099)', async () => {
    const { service, updates, events } = buildService(processed());

    const result = await service.validate('empresa-1', 'ocr-1', {}, 'usuario-1');

    expect(updates[0]).toMatchObject({
      status: OcrStatus.VALIDADO,
      validatedById: 'usuario-1',
    });
    expect(updates[0].validatedAt).toBeInstanceOf(Date);
    expect(events[0]).toMatchObject({ event: AuditEvent.APROVACAO });
    expect(result.status).toBe(OcrStatus.VALIDADO);
  });

  it('guarda a correção ao lado do que a máquina leu, sem sobrescrever (RF-100)', async () => {
    const { service, updates } = buildService(processed());

    await service.validate(
      'empresa-1',
      'ocr-1',
      { amount: '150.00', categoryId: 'categoria-escolhida', note: 'valor estava borrado' },
      'usuario-1',
    );

    expect(updates[0].corrections).toEqual({
      fields: { amount: '150.00', categoryId: 'categoria-escolhida' },
      note: 'valor estava borrado',
    });
    // Nada dos campos extraídos é tocado: o texto e os valores lidos continuam
    // exatamente como o provedor os devolveu.
    expect(updates[0]).not.toHaveProperty('amount');
    expect(updates[0]).not.toHaveProperty('extractedText');
    expect(updates[0]).not.toHaveProperty('suggestedCategoryId');
  });

  it('valida a categoria corrigida dentro da empresa ativa (RN-001)', async () => {
    const { service, references } = buildService(processed());

    await service.validate('empresa-1', 'ocr-1', { costCenterId: 'cc-1' }, 'usuario-1');

    expect(references.assert).toHaveBeenCalledWith(
      'empresa-1',
      expect.objectContaining({ costCenterId: 'cc-1' }),
    );
  });

  it('recusa a correção que aponta para cadastro de outra empresa', async () => {
    const { service, updates } = buildService(processed(), true);

    await expect(
      service.validate('empresa-1', 'ocr-1', { categoryId: 'de-outra-empresa' }, 'usuario-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updates).toHaveLength(0);
  });

  it('recusa validar o que ainda não foi lido', async () => {
    const { service } = buildService(processed({ status: OcrStatus.PENDENTE }));

    await expect(service.validate('empresa-1', 'ocr-1', {}, 'usuario-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('recusa revalidar: sobrescreveria a assinatura de quem decidiu antes', async () => {
    const { service } = buildService(processed({ status: OcrStatus.VALIDADO }));

    await expect(service.validate('empresa-1', 'ocr-1', {}, 'usuario-2')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('não alcança processamento de outra empresa', async () => {
    const { service } = buildService(null);

    await expect(service.validate('empresa-1', 'ocr-1', {}, 'usuario-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('OcrValidationService.reject', () => {
  it('rejeita com motivo e registra a reprovação (RF-099)', async () => {
    const { service, updates, events } = buildService(processed());

    const result = await service.reject(
      'empresa-1',
      'ocr-1',
      { reason: 'foto ilegível' },
      'usuario-1',
    );

    expect(updates[0]).toMatchObject({
      status: OcrStatus.REJEITADO,
      validatedById: 'usuario-1',
      corrections: { rejectedReason: 'foto ilegível' },
    });
    expect(events[0]).toMatchObject({ event: AuditEvent.REPROVACAO });
    expect(result.status).toBe(OcrStatus.REJEITADO);
  });

  it('recusa rejeitar o que já foi rejeitado', async () => {
    const { service } = buildService(processed({ status: OcrStatus.REJEITADO }));

    await expect(
      service.reject('empresa-1', 'ocr-1', { reason: 'de novo' }, 'usuario-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
