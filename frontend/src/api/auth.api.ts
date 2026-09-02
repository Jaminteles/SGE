import { api } from './client';
import type { LoginResponse, MessageResponse, UserProfile } from './types';

/** Rotas de autenticação (RF-008 / RF-009). Nenhuma delas é escopada por empresa. */
export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('auth/login', { email, password }, { auth: false, withCompany: false }),

  logout: (refreshToken: string) =>
    api.post<void>('auth/logout', { refreshToken }, { auth: false, withCompany: false }),

  me: () => api.get<UserProfile>('auth/me', { withCompany: false }),

  forgotPassword: (email: string) =>
    api.post<MessageResponse>(
      'auth/forgot-password',
      { email },
      { auth: false, withCompany: false },
    ),

  resetPassword: (token: string, newPassword: string) =>
    api.post<MessageResponse>(
      'auth/reset-password',
      { token, newPassword },
      { auth: false, withCompany: false },
    ),
};
