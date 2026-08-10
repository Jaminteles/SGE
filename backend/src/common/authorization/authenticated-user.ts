/** Usuário autenticado anexado à request pelo JwtStrategy. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  isSuperAdmin: boolean;
}

/** Payload assinado no access token. */
export interface AccessTokenPayload {
  sub: string; // userId
  email: string;
  isSuperAdmin: boolean;
  iat?: number; // emitido em (segundos) — preenchido pelo próprio JWT
}

/** Payload assinado no refresh token. */
export interface RefreshTokenPayload {
  sub: string; // userId
  sid: string; // sessionId
}
