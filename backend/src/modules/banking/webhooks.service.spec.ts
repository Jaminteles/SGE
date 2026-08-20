import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { ProviderResolver } from './providers/provider-resolver.service';
import { WebhooksService } from './webhooks.service';

interface Scenario {
  valid?: boolean;
  duplicate?: { id: string } | null;
  parsed?: { eventId?: string; eventType: string } | null;
}

function buildService(scenario: Scenario = {}) {
  const created: Record<string, unknown>[] = [];
  const enqueued: Record<string, unknown>[] = [];

  const prisma = {
    runAsSystem: jest.fn(
      (_context: unknown, fn: () => Promise<unknown>) => fn() as Promise<unknown>,
    ),
    db: {
      webhookEvent: {
        findFirst: jest.fn().mockResolvedValue(scenario.duplicate ?? null),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ id: 'evt-1' });
        }),
      },
    },
  } as unknown as PrismaService;

  const providers = {
    resolveByCode: jest.fn().mockResolvedValue({
      providerId: 'prov-1',
      provider: {
        verifyWebhookSignature: jest.fn().mockReturnValue(scenario.valid ?? true),
        parseWebhookEvent: jest
          .fn()
          .mockReturnValue(
            scenario.parsed === undefined
              ? { eventId: 'evento-123', eventType: 'payment.settled' }
              : scenario.parsed,
          ),
      },
    }),
  } as unknown as ProviderResolver;

  const queue = {
    enqueue: jest.fn((params: Record<string, unknown>) => {
      enqueued.push(params);
      return Promise.resolve('job-1');
    }),
  } as unknown as JobQueueService;

  return { service: new WebhooksService(prisma, providers, queue), created, enqueued, prisma };
}

function request(body = '{"eventId":"evento-123","status":"SETTLED"}') {
  return {
    providerCode: 'SANDBOX',
    companyId: 'empresa-1',
    rawBody: Buffer.from(body, 'utf8'),
    signature: 'sha256=abc',
    headers: { 'content-type': 'application/json', authorization: 'Bearer segredo' },
  };
}

describe('WebhooksService', () => {
  it('registra o evento e enfileira o processamento', async () => {
    const { service, created, enqueued } = buildService();

    const receipt = await service.receive(request());

    expect(receipt).toEqual({ eventId: 'evt-1', duplicated: false });
    expect(created[0]).toMatchObject({
      companyId: 'empresa-1',
      externalId: 'evento-123',
      status: 'PENDENTE',
      signatureValid: true,
    });
    expect(enqueued[0]).toMatchObject({ name: 'webhook.process' });
  });

  it('não repassa cabeçalho de credencial para o registro', async () => {
    const { service, created } = buildService();

    await service.receive(request());

    expect(created[0].headers).not.toHaveProperty('authorization');
    expect(created[0].headers).toHaveProperty('content-type');
  });

  it('guarda o evento de assinatura inválida e responde 401 sem enfileirar', async () => {
    const { service, created, enqueued } = buildService({ valid: false });

    await expect(service.receive(request())).rejects.toBeInstanceOf(UnauthorizedException);

    expect(created[0]).toMatchObject({ signatureValid: false, status: 'FALHA' });
    expect(enqueued).toHaveLength(0);
  });

  it('reconhece reentrega e não cria segundo evento (RN-005)', async () => {
    const { service, created, enqueued } = buildService({ duplicate: { id: 'evt-anterior' } });

    const receipt = await service.receive(request());

    expect(receipt).toEqual({ eventId: 'evt-anterior', duplicated: true });
    expect(created).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it('deduplica pelo hash do corpo quando o provedor não manda id de evento', async () => {
    const { service, prisma } = buildService({ parsed: { eventType: 'payment.settled' } });

    await service.receive(request());

    const findFirst = prisma.db.webhookEvent.findFirst as jest.Mock;
    const where = findFirst.mock.calls[0][0].where as Record<string, unknown>;
    expect(where).toHaveProperty('payloadHash');
    expect(where).toHaveProperty('externalId', null);
  });

  it('registra corpo ilegível em vez de derrubar a recepção', async () => {
    const { service, created } = buildService();

    await service.receive(request('isto não é json'));

    expect(created[0].payload).toMatchObject({ _raw: 'isto não é json' });
  });

  it('abre contexto de sistema com a empresa da URL (bd/13 §10)', async () => {
    const { service, prisma } = buildService();

    await service.receive(request());

    const runAsSystem = prisma.runAsSystem as unknown as jest.Mock;
    expect(runAsSystem.mock.calls[0][0]).toEqual({ origin: 'WEBHOOK', companyId: 'empresa-1' });
  });
});
