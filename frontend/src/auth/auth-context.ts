import { createContext, useContext } from 'react';
import type { UserProfile } from '../api/types';

export interface AuthContextValue {
  user: UserProfile | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  /** Momento (ms) em que o access token expira, quando conhecido (UI-005). */
  expiresAt: number | null;
  login: (email: string, password: string) => Promise<UserProfile>;
  logout: () => Promise<void>;
  /** Renova o access token sob demanda (botão do aviso de expiração). */
  renew: () => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  return context;
}
