import { PrismaService } from '../../prisma/prisma.service';
import { INTEGRATION_EVENT_TYPE, IntegrationEventsService } from './integration-events.service';

function buildService(createImpl?: jest.Mock) {
  const create = createImpl ?? jest.fn().mockResolvedValue({ id: 'evento-1' });
  const prisma = {
    root: { integrationEvent: { create } },
    currentRequestMetadata: { origin: 'API', correlationId: 'corr-1' },
  } as unknown as PrismaService;
  return { service: new IntegrationEventsService(prisma), create };
}

const base = {
  companyId: 'empresa-1',
  integrationId: 'integracao-1',
  type: INTEGRATION_EVENT_TYPE.ERROR,
  message: 'falhou',
};

describe('IntegrationEventsService.redact', () => {
  it('esconde o valor de toda chave com nome de segredo, em qualquer nível', () => {
    const { service } = buildService();

    const result = service.redact({
      baseUrl: 'https://banco.example',
      headers: { Authorization: 'Bearer abc', 'x-api-key': 'k' },
      body: { nested: { client_secret: 's', conta: '123' } },
    }) as Record<string, Record<string, unknown>>;

    expect(result.baseUrl).toBe('https://banco.example');
    expect(result.headers.Authorization).toBe('[REDIGIDO]');
    expect(result.headers['x-api-key']).toBe('[REDIGIDO]');
    expect((result.body.nested as Record<string, unknown>).client_secret).toBe('[REDIGIDO]');
    expect((result.body.nested as Record<string, unknown>).conta).toBe('123');
  });

  it('corta a recursão em vez de travar com payload profundo ou cíclico', () => {
    const { service } = buildService();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => service.redact(cyclic)).not.toThrow();
    expect(JSON.stringify(service.redact(cyclic))).toContain('[PROFUNDO]');
  });
});

describe('IntegrationEventsService.record', () => {
  it('grava fora da transação da requisição, para o evento sobreviver ao rollback', async () => {
    const { service, create } = buildService();

    const id = await service.record({ ...base, detail: { token: 'abc', rota: '/pix' } });

    expect(id).toBe('evento-1');
    const data = create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.correlationId).toBe('corr-1');
    expect((data.detail as Record<string, unknown>).token).toBe('[REDIGIDO]');
    expect((data.detail as Record<string, unknown>).rota).toBe('/pix');
  });

  it('substitui o detalhe grande por um marcador em vez de gravá-lo inteiro', async () => {
    const { service, create } = buildService();

    await service.record({ ...base, detail: { corpo: 'x'.repeat(50_000) } });

    const detail = (create.mock.calls[0][0].data as Record<string, unknown>).detail as Record<
      string,
      unknown
    >;
    // A string longa já é cortada em 500 na redação; o marcador cobre o caso de
    // muitas chaves somando acima do teto.
    expect(JSON.stringify(detail).length).toBeLessThan(9_000);
  });

  it('não propaga exceção: registrar o erro não pode substituir o erro', async () => {
    const { service } = buildService(jest.fn().mockRejectedValue(new Error('banco fora')));

    await expect(service.record(base)).resolves.toBeNull();
  });
});
