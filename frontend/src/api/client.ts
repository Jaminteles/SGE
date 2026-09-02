import { config } from '../lib/config';
import { activeCompanyStore } from '../company/active-company-store';
import { sessionStore } from '../auth/session-store';
import { NetworkError, toApiError } from './errors';

/**
 * Cliente HTTP único do app (UI-003 / UI-005).
 *
 * Responsabilidades:
 *  - anexar `Authorization: Bearer` e `x-company-id` (RF-005) em toda chamada;
 *  - renovar o access token uma única vez por 401, com as demais requisições
 *    aguardando a mesma renovação (evita N chamadas concorrentes a /auth/refresh);
 *  - normalizar erro de rede e envelope de erro da API num `ApiError`.
 */

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Corpo JSON. Decimais devem vir como string (RN-012). */
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  /** Rotas públicas (login, refresh, recuperação de senha) não mandam token. */
  auth?: boolean;
  /** Rotas de plataforma (ex.: /auth/me) não são escopadas por empresa. */
  withCompany?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Chamado quando a sessão não pode mais ser renovada — o AuthProvider assina. */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler = () => {};

export function setSessionExpiredHandler(handler: SessionExpiredHandler): void {
  onSessionExpired = handler;
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  const base = config.apiUrl.replace(/\/$/, '');
  const url = `${base}/${path.replace(/^\//, '')}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs === '' ? url : `${url}?${qs}`;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Renovação em andamento — todas as requisições que tomaram 401 esperam nela. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const refreshToken = sessionStore.getRefreshToken();
  if (!refreshToken) return false;

  const response = await fetch(buildUrl('auth/refresh', undefined), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  }).catch(() => null);

  if (!response || !response.ok) return false;

  const body = (await readBody(response)) as {
    accessToken?: string;
    refreshToken?: string;
  } | null;
  if (!body?.accessToken || !body.refreshToken) return false;

  sessionStore.set({ accessToken: body.accessToken, refreshToken: body.refreshToken });
  return true;
}

/** Garante uma única renovação concorrente. */
export function ensureRefreshed(): Promise<boolean> {
  refreshInFlight ??= refreshSession().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', body, query, auth = true, withCompany = true } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const token = sessionStore.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (withCompany) {
    const companyId = activeCompanyStore.get();
    if (companyId) headers[config.companyHeader] = companyId;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    return await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await send(path, options);
  } catch {
    throw new NetworkError();
  }

  // 401 numa rota autenticada: tenta renovar uma vez e repete a requisição.
  if (response.status === 401 && options.auth !== false) {
    const renewed = await ensureRefreshed();
    if (!renewed) {
      sessionStore.clear();
      onSessionExpired();
      throw toApiError(401, await readBody(response));
    }
    try {
      response = await send(path, options);
    } catch {
      throw new NetworkError();
    }
    if (response.status === 401) {
      sessionStore.clear();
      onSessionExpired();
    }
  }

  const payload = await readBody(response);
  if (!response.ok) throw toApiError(response.status, payload);
  return payload as T;
}

export const api = {
  get: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
