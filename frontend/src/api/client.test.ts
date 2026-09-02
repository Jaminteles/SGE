import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activeCompanyStore } from '../company/active-company-store';
import { sessionStore } from '../auth/session-store';
import { api, request, setSessionExpiredHandler } from './client';
import { ApiError, NetworkError } from './errors';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function lastRequestHeaders(mock: ReturnType<typeof vi.fn>, call = 0): Headers {
  const init = mock.mock.calls[call][1] as RequestInit;
  return new Headers(init.headers);
}

describe('client HTTP', () => {
  beforeEach(() => {
    sessionStore.clear();
    activeCompanyStore.set(null);
    setSessionExpiredHandler(() => {});
  });

  it('envia Authorization e x-company-id da empresa ativa (RF-005)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    sessionStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    activeCompanyStore.set(COMPANY_A);

    await api.get('partners');

    const headers = lastRequestHeaders(fetchMock);
    expect(headers.get('Authorization')).toBe('Bearer access-1');
    expect(headers.get('x-company-id')).toBe(COMPANY_A);
  });

  it('passa a mandar a nova empresa assim que a ativa muda', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ data: [] })));
    vi.stubGlobal('fetch', fetchMock);
    sessionStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    activeCompanyStore.set(COMPANY_A);
    await api.get('partners');
    activeCompanyStore.set(COMPANY_B);
    await api.get('partners');

    expect(lastRequestHeaders(fetchMock, 0).get('x-company-id')).toBe(COMPANY_A);
    expect(lastRequestHeaders(fetchMock, 1).get('x-company-id')).toBe(COMPANY_B);
  });

  it('omite o cabeçalho de empresa nas rotas de plataforma', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'u1' }));
    vi.stubGlobal('fetch', fetchMock);
    sessionStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    activeCompanyStore.set(COMPANY_A);

    await request('auth/me', { withCompany: false });

    expect(lastRequestHeaders(fetchMock).has('x-company-id')).toBe(false);
  });

  it('não envia token em rota pública', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    sessionStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    await request('auth/login', { method: 'POST', auth: false, withCompany: false, body: {} });

    expect(lastRequestHeaders(fetchMock).has('Authorization')).toBe(false);
  });

  it('renova a sessão uma única vez quando várias chamadas tomam 401', async () => {
    sessionStore.set({ accessToken: 'expirado', refreshToken: 'refresh-1' });
    activeCompanyStore.set(COMPANY_A);

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith('/auth/refresh')) {
        return Promise.resolve(
          jsonResponse({ accessToken: 'novo', refreshToken: 'refresh-2', tokenType: 'Bearer' }),
        );
      }
      const headers = new Headers(init?.headers);
      return Promise.resolve(
        headers.get('Authorization') === 'Bearer novo'
          ? jsonResponse({ ok: true })
          : jsonResponse({ statusCode: 401, message: 'Token expirado.' }, 401),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await Promise.all([api.get('partners'), api.get('products')]);

    expect(results).toEqual([{ ok: true }, { ok: true }]);
    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
    expect(sessionStore.getRefreshToken()).toBe('refresh-2');
  });

  it('encerra a sessão quando a renovação falha', async () => {
    sessionStore.set({ accessToken: 'expirado', refreshToken: 'refresh-1' });
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);

    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        String(url).endsWith('/auth/refresh')
          ? jsonResponse({ statusCode: 401, message: 'Sessão inválida.' }, 401)
          : jsonResponse({ statusCode: 401, message: 'Token expirado.' }, 401),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('partners')).rejects.toBeInstanceOf(ApiError);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(sessionStore.getRefreshToken()).toBeNull();
    expect(sessionStore.getAccessToken()).toBeNull();
  });

  it('traduz o envelope de erro da API (UI-005)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            statusCode: 409,
            error: 'ConflictException',
            message: 'O CNPJ informado já existe nesta empresa.',
          },
          409,
        ),
      ),
    );
    sessionStore.set({ accessToken: 'a', refreshToken: 'r' });

    await expect(api.post('partners', {})).rejects.toMatchObject({
      status: 409,
      code: 'ConflictException',
      message: 'O CNPJ informado já existe nesta empresa.',
    });
  });

  it('mantém a lista de erros de validação', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { statusCode: 400, error: 'BadRequest', message: ['email inválido', 'senha curta'] },
            400,
          ),
        ),
    );
    sessionStore.set({ accessToken: 'a', refreshToken: 'r' });

    await expect(api.post('partners', {})).rejects.toMatchObject({
      status: 400,
      message: 'email inválido',
      details: ['email inválido', 'senha curta'],
    });
  });

  it('converte falha de rede em NetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.get('partners', { auth: false })).rejects.toBeInstanceOf(NetworkError);
  });

  it('monta a query string ignorando valores vazios', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await request('partners', { query: { page: 2, q: '', isActive: true, cursor: undefined } });

    expect(String(fetchMock.mock.calls[0][0])).toContain('partners?page=2&isActive=true');
  });
});
