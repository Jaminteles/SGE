import { Injectable } from '@nestjs/common';
import { ProviderCategory } from '@prisma/client';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  EmailCapabilities,
  EmailContext,
  EmailCredentials,
  EmailProvider,
  EmailProviderError,
} from './email-provider.port';
import { HttpEmailProvider } from './http-email.provider';
import { LOG_EMAIL_PROVIDER_CODE, LogEmailProvider } from './log-email.provider';

export interface ResolvedEmailProvider {
  providerId: string;
  provider: EmailProvider;
  context: EmailContext;
}

/**
 * Resolve o adaptador de e-mail da empresa (RF-120).
 *
 * Mesma forma do resolvedor do M13: o provedor da empresa é aquele para o qual
 * ela tem credencial ativa na categoria `EMAIL`. Sem credencial — ou com
 * credencial vencida — cai no adaptador que só registra, e o aviso interno
 * continua funcionando.
 *
 * A credencial é decifrada aqui e não sai deste objeto: nada dela vai para a
 * notificação, para log ou para resposta da API (RNF-003/RNF-005).
 */
@Injectable()
export class EmailProviderResolver {
  private readonly adapters: Map<string, EmailProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    log: LogEmailProvider,
    http: HttpEmailProvider,
  ) {
    this.adapters = new Map<string, EmailProvider>([
      [log.code, log],
      [http.code, http],
    ]);
  }

  async resolve(companyId: string): Promise<ResolvedEmailProvider> {
    const credential = await this.prisma.db.integrationCredential.findFirst({
      where: {
        companyId,
        isActive: true,
        provider: { category: ProviderCategory.EMAIL, isActive: true },
      },
      // Havendo mais de um ambiente, a de produção é a que vale — mesma ordem
      // dos resolvedores do M09 e do M13.
      orderBy: [{ environment: 'asc' }, { createdAt: 'desc' }],
      select: {
        secret: true,
        environment: true,
        expiresAt: true,
        provider: { select: { id: true, code: true, capabilities: true } },
      },
    });

    const usable =
      credential &&
      !(credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) &&
      this.adapters.has(credential.provider.code);

    if (!usable) {
      return this.logFallback(companyId);
    }

    return {
      providerId: credential.provider.id,
      provider: this.adapters.get(credential.provider.code)!,
      context: {
        companyId,
        providerCode: credential.provider.code,
        capabilities: (credential.provider.capabilities ?? {}) as EmailCapabilities,
        credentials: this.decode(credential.secret),
        environment: credential.environment,
      },
    };
  }

  private async logFallback(companyId: string): Promise<ResolvedEmailProvider> {
    const provider = await this.prisma.db.provider.findUnique({
      where: { code: LOG_EMAIL_PROVIDER_CODE },
      select: { id: true, capabilities: true },
    });
    if (!provider) {
      // Falha permanente: reexecutar o job não faz o catálogo aparecer.
      throw new EmailProviderError(
        'Catálogo de provedores de e-mail não inicializado (bd/16).',
        'CATALOGO_AUSENTE',
        false,
      );
    }
    return {
      providerId: provider.id,
      provider: this.adapters.get(LOG_EMAIL_PROVIDER_CODE)!,
      context: {
        companyId,
        providerCode: LOG_EMAIL_PROVIDER_CODE,
        capabilities: (provider.capabilities ?? {}) as EmailCapabilities,
        credentials: {},
        environment: 'PRODUCAO',
      },
    };
  }

  private decode(secret: Uint8Array): EmailCredentials {
    const parsed: unknown = JSON.parse(this.crypto.decrypt(Buffer.from(secret)));
    return parsed && typeof parsed === 'object' ? (parsed as EmailCredentials) : {};
  }
}
