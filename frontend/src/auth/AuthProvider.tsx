import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { authApi } from '../api/auth.api';
import { ensureRefreshed, setSessionExpiredHandler } from '../api/client';
import { activeCompanyStore } from '../company/active-company-store';
import type { UserProfile } from '../api/types';
import { AuthContext, type AuthContextValue } from './auth-context';
import { accessTokenExpiresAt, sessionStore } from './session-store';

/**
 * Sessão do usuário (UI-002).
 *
 * Na montagem tenta restaurar a sessão a partir do refresh token guardado na
 * aba; se a renovação falhar, o app simplesmente cai na tela de login.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const mounted = useRef(true);

  const syncExpiry = useCallback(() => {
    setExpiresAt(accessTokenExpiresAt(sessionStore.getAccessToken()));
  }, []);

  const clearSession = useCallback(() => {
    sessionStore.clear();
    activeCompanyStore.set(null);
    setUser(null);
    setExpiresAt(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // O cliente HTTP avisa quando não há mais como renovar a sessão.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      if (mounted.current) clearSession();
    });
    return () => setSessionExpiredHandler(() => {});
  }, [clearSession]);

  // Restaura a sessão da aba, se houver refresh token válido.
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!sessionStore.getRefreshToken()) {
        if (!cancelled) setStatus('anonymous');
        return;
      }
      const renewed = await ensureRefreshed();
      if (cancelled) return;
      if (!renewed) {
        clearSession();
        return;
      }
      try {
        const profile = await authApi.me();
        if (cancelled) return;
        setUser(profile);
        syncExpiry();
        setStatus('authenticated');
      } catch {
        if (!cancelled) clearSession();
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [clearSession, syncExpiry]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await authApi.login(email, password);
      sessionStore.set({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      setUser(result.user);
      syncExpiry();
      setStatus('authenticated');
      return result.user;
    },
    [syncExpiry],
  );

  const logout = useCallback(async () => {
    const refreshToken = sessionStore.getRefreshToken();
    // A sessão local cai mesmo se a API falhar — o usuário pediu para sair.
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        /* sessão já encerrada no servidor ou indisponível */
      }
    }
    clearSession();
  }, [clearSession]);

  const renew = useCallback(async () => {
    const renewed = await ensureRefreshed();
    if (!renewed) {
      clearSession();
      return false;
    }
    syncExpiry();
    return true;
  }, [clearSession, syncExpiry]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, expiresAt, login, logout, renew }),
    [user, status, expiresAt, login, logout, renew],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
