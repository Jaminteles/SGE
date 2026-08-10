import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from './password.service';
import { IssuedTokens, TokenService } from './token.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
  ) {}

  /** Autentica o usuário e emite tokens + lista de empresas acessíveis (RF-008). */
  async login(dto: LoginDto, meta: RequestMeta): Promise<IssuedTokens & { user: unknown }> {
    const user = await this.prisma.db.user.findUnique({ where: { email: dto.email } });

    // Verificação em tempo ~constante para evitar enumeração de usuários.
    const validPassword = user
      ? await this.password.verify(user.passwordHash, dto.password)
      : await this.password.verify(await this.getDummyHash(), dto.password);

    if (!user || !validPassword || !user.isActive) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    // A partir daqui a sessão de banco tem dono: a RLS libera as associações
    // do próprio usuário (bd/04, pol_usuario_empresa_proprio).
    await this.prisma.setCurrentUser(user.id);

    await this.prisma.db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const issued = await this.tokens.issueTokens(user, meta);
    return { ...issued, user: await this.profile(user.id) };
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<IssuedTokens> {
    return this.tokens.rotate(refreshToken, meta);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revokeByRefreshToken(refreshToken);
  }

  /**
   * Inicia a recuperação de senha (RF-009). Sempre responde de forma genérica
   * para não revelar se o e-mail existe. O envio do e-mail pertence ao módulo
   * de notificações (M17); aqui o token é gerado e registrado.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.db.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.isActive) {
      return;
    }

    const rawToken = randomBytes(32).toString('base64url');
    const ttlMinutes = this.config.getOrThrow<number>('PASSWORD_RESET_TTL_MINUTES');

    await this.prisma.db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
    });

    // TODO(M17): enviar por e-mail. Enquanto isso, disponível apenas em log.
    this.logger.debug(`Token de recuperação para ${user.email}: ${rawToken}`);
  }

  /** Redefine a senha via token e encerra todas as sessões (RF-009). */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const record = await this.prisma.db.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(dto.token) },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Token de recuperação inválido ou expirado.');
    }

    const passwordHash = await this.password.hash(dto.newPassword);

    await this.prisma.transaction(async (tx) => {
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      await tx.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  /** Altera a própria senha (RF-009) e encerra as demais sessões. */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado.');
    }

    const valid = await this.password.verify(user.passwordHash, dto.currentPassword);
    if (!valid) {
      throw new UnauthorizedException('Senha atual incorreta.');
    }

    const passwordHash = await this.password.hash(dto.newPassword);
    await this.prisma.transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  /** Perfil do usuário autenticado com as empresas às quais tem acesso. */
  async profile(userId: string) {
    const user = await this.prisma.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        isSuperAdmin: true,
        isActive: true,
        memberships: {
          where: { isActive: true },
          select: {
            companyId: true,
            branchId: true,
            isDefault: true,
            company: { select: { legalName: true, tradeName: true } },
            role: { select: { id: true, name: true } },
          },
        },
      },
    });
    return user;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = this.password.hash(randomBytes(16).toString('hex'));
    }
    return this.dummyHash;
  }
}
