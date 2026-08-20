import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { PaymentMethodType, TransactionDirection } from '@prisma/client';
import { HttpBankProvider } from './http-bank.provider';
import { PaymentOrder, ProviderContext, ProviderError } from './payment-provider.port';

function providerWith(env: Record<string, unknown> = {}): HttpBankProvider {
  const config = {
    get: (key: string) =>
      ({
        NODE_ENV: 'production',
        INTEGRATION_HTTP_TIMEOUT_MS: 5_000,
        INTEGRATION_CIRCUIT_THRESHOLD: 2,
        INTEGRATION_CIRCUIT_OPEN_MS: 60_000,
        ...env,
      })[key],
  } as unknown as ConfigService;
  return new HttpBankProvider(config);
}

function context(baseUrl: string, extra: Record<string, unknown> = {}): ProviderContext {
  return {
    companyId: 'empresa-1',
    providerCode: 'SANDBOX',
    capabilities: { pix: true, cancelamento: true, consulta: true },
    credentials: { baseUrl, apiKey: 'chave', webhookSecret: 'segredo', ...extra },
    environment: 'PRODUCAO',
  };
}

const ORDER: PaymentOrder = {
  transactionId: 'tx-1',
  idempotencyKey: 'chave-idem-1',
  direction: TransactionDirection.DEBITO,
  method: PaymentMethodType.PIX,
  amount: '1000.00',
  account: { id: 'conta-1', bankCode: '341', agency: '1234', account: '567890' },
  payee: { pixKey: 'chave@pix' },
};

describe('HttpBankProvider — destino da integração (SSRF)', () => {
  const cases: [string, string][] = [
    ['loopback', 'https://127.0.0.1/api'],
    ['localhost', 'https://localhost/api'],
    ['metadata da nuvem', 'https://169.254.169.254/latest'],
    ['rede privada 10/8', 'https://10.0.0.5/api'],
    ['rede privada 192.168', 'https://192.168.1.10/api'],
    ['rede privada 172.16', 'https://172.20.0.3/api'],
    ['sufixo interno', 'https://banco.internal/api'],
  ];

  it.each(cases)('recusa endereço %s', async (_label, baseUrl) => {
    const provider = providerWith();

    await expect(provider.send(ORDER, context(baseUrl))).rejects.toMatchObject({
      code: 'DESTINO_INVALIDO',
      retryable: false,
    });
  });

  it('exige HTTPS em produção', async () => {
    const provider = providerWith();

    await expect(provider.send(ORDER, context('http://api.banco.example'))).rejects.toMatchObject({
      code: 'DESTINO_INVALIDO',
    });
  });

  it('recusa host fora da allowlist quando ela está configurada', async () => {
    const provider = providerWith({ INTEGRATION_ALLOWED_HOSTS: 'api.banco.example' });

    await expect(
      provider.send(ORDER, context('https://outro.banco.example')),
    ).rejects.toMatchObject({ code: 'DESTINO_NAO_PERMITIDO' });
  });

  it('recusa credencial sem URL', async () => {
    const provider = providerWith();
    const ctx = context('https://api.banco.example');
    delete ctx.credentials.baseUrl;

    await expect(provider.send(ORDER, ctx)).rejects.toMatchObject({
      code: 'CREDENCIAL_INCOMPLETA',
    });
  });
});

describe('HttpBankProvider — chamada e resposta', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(status: number, body: unknown) {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('repassa a chave de idempotência ao provedor (RF-067)', async () => {
    const fetchMock = mockFetch(200, { id: 'ext-1', status: 'ACCEPTED' });
    const provider = providerWith({ INTEGRATION_ALLOWED_HOSTS: 'api.banco.example' });

    const result = await provider.send(ORDER, context('https://api.banco.example'));

    expect(result).toMatchObject({ status: 'ENVIADA', externalId: 'ext-1' });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('chave-idem-1');
  });

  it('manda o valor como texto decimal, nunca como número', async () => {
    const fetchMock = mockFetch(200, { id: 'ext-1', status: 'ACCEPTED' });
    const provider = providerWith({ INTEGRATION_ALLOWED_HOSTS: 'api.banco.example' });

    await provider.send(ORDER, context('https://api.banco.example'));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { amount: unknown };
    expect(body.amount).toBe('1000.00');
  });

  it('classifica 503 como retentável e 400 como definitivo (RF-070)', async () => {
    const provider = providerWith({ INTEGRATION_ALLOWED_HOSTS: 'api.banco.example' });

    mockFetch(503, {});
    await expect(provider.send(ORDER, context('https://api.banco.example'))).rejects.toMatchObject({
      retryable: true,
    });

    mockFetch(400, { errorCode: 'CHAVE_INVALIDA', message: 'Chave PIX inexistente' });
    await expect(provider.send(ORDER, context('https://api.banco.example'))).rejects.toMatchObject({
      retryable: false,
      code: 'CHAVE_INVALIDA',
    });
  });

  it('recusa resposta com situação desconhecida em vez de assumir sucesso', async () => {
    mockFetch(200, { id: 'ext-1', status: 'QUEM_SABE' });
    const provider = providerWith({ INTEGRATION_ALLOWED_HOSTS: 'api.banco.example' });

    await expect(provider.send(ORDER, context('https://api.banco.example'))).rejects.toMatchObject({
      code: 'RESPOSTA_INVALIDA',
    });
  });

  it('abre o disjuntor depois de falhas seguidas', async () => {
    mockFetch(503, {});
    const provider = providerWith({ INTEGRATION_ALLOWED_HOSTS: 'api.banco.example' });
    const ctx = context('https://api.banco.example');

    await expect(provider.send(ORDER, ctx)).rejects.toBeInstanceOf(ProviderError);
    await expect(provider.send(ORDER, ctx)).rejects.toBeInstanceOf(ProviderError);

    await expect(provider.send(ORDER, ctx)).rejects.toMatchObject({
      code: 'CIRCUITO_ABERTO',
      retryable: true,
    });
  });

  it('recusa cancelar quando o provedor não declara a capacidade (RF-065)', async () => {
    const provider = providerWith({ INTEGRATION_ALLOWED_HOSTS: 'api.banco.example' });
    const ctx = context('https://api.banco.example');
    ctx.capabilities = { cancelamento: false };

    await expect(provider.cancel('ext-1', 'motivo', ctx)).rejects.toMatchObject({
      code: 'CANCELAMENTO_NAO_SUPORTADO',
    });
  });
});

describe('HttpBankProvider — assinatura do webhook (RF-066)', () => {
  const body = Buffer.from('{"eventId":"e1","status":"SETTLED"}', 'utf8');

  it('aceita a assinatura calculada sobre o corpo cru', () => {
    const provider = providerWith();
    const signature = createHmac('sha256', 'segredo').update(body).digest('hex');

    expect(
      provider.verifyWebhookSignature(body, `sha256=${signature}`, context('https://x.example')),
    ).toBe(true);
  });

  it('recusa assinatura de outro corpo — reordenar o JSON invalida', () => {
    const provider = providerWith();
    const signature = createHmac('sha256', 'segredo')
      .update(Buffer.from('{"status":"SETTLED","eventId":"e1"}'))
      .digest('hex');

    expect(provider.verifyWebhookSignature(body, signature, context('https://x.example'))).toBe(
      false,
    );
  });

  it('recusa quando não há assinatura ou não há segredo', () => {
    const provider = providerWith();

    expect(provider.verifyWebhookSignature(body, undefined, context('https://x.example'))).toBe(
      false,
    );

    const ctx = context('https://x.example');
    delete ctx.credentials.webhookSecret;
    expect(provider.verifyWebhookSignature(body, 'sha256=abcd', ctx)).toBe(false);
  });

  it('traduz o evento para o vocabulário do domínio, e ignora o que não é pagamento', () => {
    const provider = providerWith();

    expect(
      provider.parseWebhookEvent({ eventId: 'e1', paymentId: 'ext-1', status: 'SETTLED' }),
    ).toMatchObject({ eventId: 'e1', externalId: 'ext-1', result: { status: 'CONFIRMADA' } });
    expect(provider.parseWebhookEvent({ event: 'account.updated' })).toBeNull();
  });
});
