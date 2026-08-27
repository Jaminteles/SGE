import { ConflictException, NotFoundException } from '@nestjs/common';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { PermanentJobError } from '../../common/queue/job.types';
import { FiscalEventStatus, FiscalEventType } from '../../common/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { FiscalEventsService } from './fiscal-events.service';
import { FiscalTransmissionService } from './fiscal-transmission.service';
import { FiscalProviderError } from './providers/fiscal-provider.port';
import { FiscalProviderResolver } from './providers/fiscal-provider-resolver.service';

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    type: FiscalEventType.CANCELAMENTO,
    sequence: 1,
    status: FiscalEventStatus.REGISTRADO,
    justification: 'Nota emitida em duplicidade para o mesmo pedido',
    xmlContent: null,
    document: { accessKey: '3'.repeat(44), number: '1234' },
    ...overrides,
  };
}

function buildService(
  options: {
    row?: Record<string, unknown> | null;
    canTransmit?: boolean;
    transmit?: () => Promise<unknown>;
  } = {},
) {
  const updateManyCalls: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const queries: Record<string, unknown>[] = [];

  const prisma = {
    db: {
      fiscalEvent: {
        findFirst: jest.fn((args: { where: Record<string, unknown> }) => {
          queries.push(args.where);
          return Promise.resolve(options.row === undefined ? event() : options.row);
        }),
        updateMany: jest.fn(
          (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            updateManyCalls.push(args);
            return Promise.resolve({ count: 1 });
          },
        ),
      },
    },
  } as unknown as PrismaService;

  const queue = { enqueue: jest.fn().mockResolvedValue('job-1') } as unknown as JobQueueService;

  const events = {
    applyResult: jest.fn().mockResolvedValue(event({ status: FiscalEventStatus.AUTORIZADO })),
  } as unknown as FiscalEventsService;

  const transmit =
    options.transmit ??
    jest.fn().mockResolvedValue({
      status: FiscalEventStatus.AUTORIZADO,
      protocol: '135260000123456',
      raw: { ok: true },
    });

  const resolver = {
    resolve: jest.fn().mockResolvedValue({
      providerId: 'prov-1',
      provider: { code: 'SEFAZ_GENERICO', canTransmit: options.canTransmit ?? true, transmit },
      context: { companyId: 'empresa-1', providerCode: 'SEFAZ_GENERICO', credentials: {} },
    }),
  } as unknown as FiscalProviderResolver;

  return {
    service: new FiscalTransmissionService(prisma, queue, events, resolver),
    queue,
    events,
    transmit,
    updateManyCalls,
    queries,
  };
}

describe('FiscalTransmissionService.request', () => {
  it('enfileira com chave de idempotência por evento (RF-094)', async () => {
    const { service, queue } = buildService();

    const result = await service.request('empresa-1', 'evt-1');

    expect(result).toEqual({ jobId: 'job-1' });
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'empresa-1',
        payload: { eventId: 'evt-1' },
        idempotencyKey: 'fiscal.transmitir-evento:evt-1',
      }),
    );
  });

  it('recusa transmitir sem integração ativa em vez de criar job condenado', async () => {
    const { service, queue } = buildService({ canTransmit: false });

    await expect(service.request('empresa-1', 'evt-1')).rejects.toBeInstanceOf(ConflictException);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('recusa retransmitir evento que já teve resposta do fisco', async () => {
    const { service, queue } = buildService({
      row: event({ status: FiscalEventStatus.AUTORIZADO }),
    });

    await expect(service.request('empresa-1', 'evt-1')).rejects.toBeInstanceOf(ConflictException);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('devolve 404 para evento de outra empresa: id na rota não atravessa tenant', async () => {
    const { service, queries } = buildService({ row: null });

    await expect(service.request('empresa-1', 'evt-de-outra')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(queries[0]).toMatchObject({ id: 'evt-de-outra', companyId: 'empresa-1' });
  });
});

describe('FiscalTransmissionService.run', () => {
  it('grava o retorno do provedor pelo caminho único de aplicação (RF-094)', async () => {
    const { service, events, transmit } = buildService();

    await service.run('empresa-1', 'evt-1');

    expect(transmit).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt-1', accessKey: '3'.repeat(44) }),
      expect.anything(),
    );
    expect(events.applyResult).toHaveBeenCalledWith(
      'empresa-1',
      'evt-1',
      expect.objectContaining({
        status: FiscalEventStatus.AUTORIZADO,
        protocol: '135260000123456',
      }),
    );
  });

  it('não retransmite o evento que já saiu do transporte: o retry chegou depois do retorno', async () => {
    const { service, transmit, events } = buildService({
      row: event({ status: FiscalEventStatus.AUTORIZADO }),
    });

    await service.run('empresa-1', 'evt-1');

    expect(transmit).not.toHaveBeenCalled();
    expect(events.applyResult).not.toHaveBeenCalled();
  });

  it('falha permanente não vira REJEITADO: a recusa foi da integração, não do fisco', async () => {
    const { service, events, updateManyCalls } = buildService({
      transmit: jest
        .fn()
        .mockRejectedValue(new FiscalProviderError('Destino inválido', 'URL_INVALIDA', false)),
    });

    await expect(service.run('empresa-1', 'evt-1')).rejects.toBeInstanceOf(PermanentJobError);
    expect(events.applyResult).not.toHaveBeenCalled();
    expect(updateManyCalls[0].data).toMatchObject({
      response: expect.objectContaining({ erro: 'URL_INVALIDA' }),
    });
  });

  it('falha temporária sobe para a fila repetir com backoff', async () => {
    const { service } = buildService({
      transmit: jest
        .fn()
        .mockRejectedValue(new FiscalProviderError('Fora do ar', 'INDISPONIVEL', true)),
    });

    await expect(service.run('empresa-1', 'evt-1')).rejects.toBeInstanceOf(FiscalProviderError);
  });
});
