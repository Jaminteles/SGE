import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { parseDurationMs } from '../../common/utils/duration';
import {
  AccessTokenPayload,
  RefreshTokenPayload,
} from '../../common/authorization/authenticated-user';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
}

interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

interface UserForToken {
  id: string;
  email: string;
  isSuperAdmin: boolean;
}

/**
 * Emissão, rotação e revogação de tokens de acesso/refresh e sessões (RF-008).
 * O refresh token é um JWT cujo hash SHA-256 fica guardado na sessão, permitindo
 * revogação server-side e detecção de reuso (rotação de tokens).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async issueTokens(user: UserForToken, meta: SessionMeta = {}): Promise<IssuedTokens> {
    const refreshTtl = this.config.getOrThrow<string>('JWT_REFRESH_TTL');
    const expiresAt = new Date(Date.now() + parseDurationMs(refreshTtl));

    const session = await this.prisma.db.session.create({
      data: {
        userId: user.id,
        tokenHash: randomBytes(32).toString('hex'), // placeholder até assinar
        expiresAt,
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
    });

    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.signRefreshToken(user.id, session.id, refreshTtl);

    await this.prisma.db.session.update({
      where: { id: session.id },
      data: { tokenHash: this.hashToken(refreshToken) },
    });

    return { accessToken, refreshToken, tokenType: 'Bearer' };
  }

  async rotate(refreshToken: string, meta: SessionMeta = {}): Promise<IssuedTokens> {
    const payload = await this.verifyRefreshToken(refreshToken);

    const session = await this.prisma.db.session.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    // Detecção de reuso: token não confere com o hash da sessão -> revoga tudo.
    if (session.tokenHash !== this.hashToken(refreshToken)) {
      await this.revokeAllForUser(session.userId);
      throw new UnauthorizedException('Reuso de token detectado. Sessões encerradas.');
    }

    if (!session.user.isActive) {
      throw new UnauthorizedException('Usuário inativo.');
    }

    // Rotação: revoga a sessão atual e emite uma nova.
    await this.prisma.db.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(
      {
        id: session.user.id,
        email: session.user.email,
        isSuperAdmin: session.user.isSuperAdmin,
      },
      meta,
    );
  }

  /**
   * Revoga a sessão do refresh token. Devolve a sessão efetivamente encerrada,
   * ou `null` quando não havia o que encerrar — o logout é idempotente, e quem
   * audita precisa saber se algo de fato mudou.
   */
  async revokeByRefreshToken(
    refreshToken: string,
  ): Promise<{ userId: string; sessionId: string } | null> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.verifyRefreshToken(refreshToken);
    } catch {
      return null; // logout idempotente
    }
    const { count } = await this.prisma.db.session.updateMany({
      where: { id: payload.sid, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count > 0 ? { userId: payload.sub, sessionId: payload.sid } : null;
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private signAccessToken(user: UserForToken): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
    };
    return this.jwt.signAsync(
      payload,
      this.signOptions(
        this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        this.config.getOrThrow<string>('JWT_ACCESS_TTL'),
      ),
    );
  }

  private signRefreshToken(userId: string, sessionId: string, ttl: string): Promise<string> {
    const payload: RefreshTokenPayload = { sub: userId, sid: sessionId };
    return this.jwt.signAsync(
      payload,
      this.signOptions(this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), ttl),
    );
  }

  private signOptions(secret: string, expiresIn: string): JwtSignOptions {
    return { secret, expiresIn: expiresIn as JwtSignOptions['expiresIn'] };
  }

  private async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido.');
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
