import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FiscalEventStatus, FiscalEventType } from '../../common/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { FiscalDocumentsService } from '../fiscal-documents/fiscal-documents.service';
import { FiscalEventsService } from './fiscal-events.service';

const JUSTIFICATION = 'Nota emitida em duplicidade para o mesmo pedido';

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    documentId: 'doc-1',
    type: FiscalEventType.CANCELAMENTO,
    protocol: null,
    sequence: 1,
    occurredAt: new Date('2026-06-10T00:00:00.000Z'),
    justification: JUSTIFICATION,
    status: FiscalEventStatus.REGISTRADO,
    response: null,
    createdAt: new Date('2026-06-10T00:00:00.000Z'),
    ...overrides,
  };
}

function buildService(
  options: {
    /** Respostas de `findFirst`, na ordem em que o serviço as consome. */
    findFirst?: (Record<string, unknown> | null)[];
    updatedCount?: number;
    documentFound?: boolean;
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const updateManyCalls: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const queries: Record<string, unknown>[] = [];
  const answers = [...(options.findFirst ?? [])];

  const prisma = {
    db: {
      fiscalEvent: {
        findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
          queries.push(args.where);
          return Promise.resolve(answers.length ? (answers.shift() ?? null) : event());
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ ...event(), ...data });
        }),
        updateMany: jest.fn(
          (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            updateManyCalls.push(args);
            return Promise.resolve({ count: options.updatedCount ?? 1 });
          },
        ),
      },
    },
    transaction: jest.fn((fn: () => Promise<unknown>) => fn()),
  } as unknown as PrismaService;

  const documents = {
    findOne: jest.fn(() =>
      options.documentFound === false
        ? Promise.reject(new NotFoundException('Documento fiscal não encontrado.'))
        : Promise.resolve({ id: 'doc-1', number: '1234' }),
    ),
    cancel: jest.fn().mockResolvedValue({ id: 'doc-1' }),
  } as unknown as FiscalDocumentsService;

  return {
    service: new FiscalEventsService(prisma, documents),
    created,
    updateManyCalls,
    queries,
    documents,
  };
}

describe('FiscalEventsService.create', () => {
  it('registra o evento sem protocolo e com a próxima sequência livre (RF-092)', async () => {
    const { service, created } = buildService({ findFirst: [event({ sequence: 2 })] });

    await service.create('empresa-1', {
      type: FiscalEventType.CANCELAMENTO,
      documentId: 'doc-1',
      justification: JUSTIFICATION,
    });

    expect(created[0]).toMatchObject({
      companyId: 'empresa-1',
      documentId: 'doc-1',
      sequence: 3,
      status: FiscalEventStatus.REGISTRADO,
    });
    expect(created[0]).not.toHaveProperty('protocol');
  });

  it('recusa cancelamento sem justificativa: é a única resposta que sobra depois', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', {
        type: FiscalEventType.CANCELAMENTO,
        documentId: 'doc-1',
        justification: 'curta',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa evento de documento sem informar o documento', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', { type: FiscalEventType.MANIFESTACAO }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa inutilização amarrada a documento: ela é de faixa de numeração', async () => {
    const { service } = buildService();

    await expect(
      service.create('empresa-1', {
        type: FiscalEventType.INUTILIZACAO,
        documentId: 'doc-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('não registra evento sobre documento de outra empresa', async () => {
    const { service } = buildService({ documentFound: false });

    await expect(
      service.create('empresa-1', {
        type: FiscalEventType.MANIFESTACAO,
        documentId: 'doc-de-outra',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FiscalEventsService.settle', () => {
  it('grava o protocolo e cancela a nota quando o cancelamento é autorizado (RF-092)', async () => {
    const { service, updateManyCalls, documents } = buildService({
      findFirst: [
        event(),
        event({ status: FiscalEventStatus.AUTORIZADO, protocol: '135260000123456' }),
      ],
    });

    await service.settle('empresa-1', 'evt-1', {
      status: FiscalEventStatus.AUTORIZADO,
      protocol: '135260000123456',
    });

    expect(updateManyCalls[0].data).toMatchObject({
      status: FiscalEventStatus.AUTORIZADO,
      protocol: '135260000123456',
    });
    expect(documents.cancel).toHaveBeenCalledWith(
      'empresa-1',
      'doc-1',
      expect.objectContaining({ reason: expect.stringContaining('135260000123456') }),
    );
  });

  it('não cancela nota nenhuma quando o fisco rejeita', async () => {
    const { service, documents } = buildService({
      findFirst: [event(), event({ status: FiscalEventStatus.REJEITADO, protocol: '999' })],
    });

    await service.settle('empresa-1', 'evt-1', {
      status: FiscalEventStatus.REJEITADO,
      protocol: '999',
    });

    expect(documents.cancel).not.toHaveBeenCalled();
  });

  it('recusa evento que já teve resposta do fisco', async () => {
    const { service } = buildService({
      findFirst: [event({ status: FiscalEventStatus.AUTORIZADO, protocol: '123' })],
    });

    await expect(
      service.settle('empresa-1', 'evt-1', {
        status: FiscalEventStatus.AUTORIZADO,
        protocol: '456',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa "resposta" que não é resposta do fisco', async () => {
    const { service } = buildService();

    await expect(
      service.settle('empresa-1', 'evt-1', {
        status: FiscalEventStatus.TRANSMITIDO,
        protocol: '123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('FiscalEventsService.applyResult', () => {
  it('é idempotente: a segunda chegada do mesmo retorno não reescreve o evento', async () => {
    const { service } = buildService({ updatedCount: 0 });

    await expect(
      service.applyResult('empresa-1', 'evt-1', {
        status: FiscalEventStatus.AUTORIZADO,
        protocol: '123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('só grava sobre evento da empresa e ainda em transporte', async () => {
    const { service, updateManyCalls } = buildService({
      findFirst: [event({ status: FiscalEventStatus.TRANSMITIDO })],
    });

    await service.applyResult('empresa-1', 'evt-1', {
      status: FiscalEventStatus.TRANSMITIDO,
    });

    expect(updateManyCalls[0].where).toMatchObject({
      id: 'evt-1',
      companyId: 'empresa-1',
      status: { in: [FiscalEventStatus.REGISTRADO, FiscalEventStatus.TRANSMITIDO] },
    });
  });
});

describe('FiscalEventsService.findOne', () => {
  it('devolve 404 para evento de outra empresa: id na rota não atravessa tenant', async () => {
    const { service, queries } = buildService({ findFirst: [null] });

    await expect(service.findOne('empresa-1', 'evt-de-outra')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(queries[0]).toMatchObject({ id: 'evt-de-outra', companyId: 'empresa-1' });
  });
});
