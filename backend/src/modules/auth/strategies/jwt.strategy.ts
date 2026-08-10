import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  AccessTokenPayload,
  AuthenticatedUser,
} from '../../../common/authorization/authenticated-user';

/**
 * Valida o access token e confirma que o usuário continua ativo no banco
 * (revogação imediata de acesso ao inativar o usuário) — RNF-004.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        isSuperAdmin: true,
        isActive: true,
        passwordChangedAt: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuário inválido ou inativo.');
    }

    // Troca/redefinição de senha invalida os access tokens já emitidos: sem
    // isso o token anterior sobreviveria até expirar, mesmo com as sessões
    // revogadas (RF-009).
    if (user.passwordChangedAt && payload.iat !== undefined) {
      const changedAtSeconds = Math.floor(user.passwordChangedAt.getTime() / 1000);
      if (payload.iat < changedAtSeconds) {
        throw new UnauthorizedException('Credenciais alteradas. Faça login novamente.');
      }
    }

    // Identifica a sessão de banco: alimenta a auditoria (RN-010) e as
    // políticas de RLS que liberam as associações do próprio usuário.
    await this.prisma.setCurrentUser(user.id);

    return { id: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin };
  }
}
