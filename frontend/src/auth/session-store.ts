/**
 * Guarda dos tokens da sessão (UI-002).
 *
 * O access token fica **só em memória**: é o que trafega em toda requisição e
 * não precisa sobreviver a um reload. O refresh token vai para `sessionStorage`
 * — some ao fechar a aba e não é compartilhado entre abas — porque a API não
 * oferece cookie httpOnly; assim a janela de exposição fica menor do que em
 * `localStorage`. Nenhum token é gravado em log.
 */

const REFRESH_KEY = 'sge.refreshToken';

let accessToken: string | null = null;
function safeSession(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export const sessionStore = {
  getAccessToken(): string | null {
    return accessToken;
  },

  getRefreshToken(): string | null {
    return safeSession()?.getItem(REFRESH_KEY) ?? null;
  },

  set(tokens: { accessToken: string; refreshToken: string }): void {
    accessToken = tokens.accessToken;
    safeSession()?.setItem(REFRESH_KEY, tokens.refreshToken);
  },

  clear(): void {
    accessToken = null;
    safeSession()?.removeItem(REFRESH_KEY);
  },
};

/**
 * Instante de expiração (ms) lido do próprio access token. A leitura do payload
 * serve apenas para avisar o usuário antes da hora (UI-005) — a validade de
 * verdade continua sendo verificada pelo backend a cada requisição.
 */
export function accessTokenExpiresAt(token: string | null): number | null {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(json) as { exp?: number };
    return typeof parsed.exp === 'number' ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}
