import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { HttpBankProvider } from './http-bank.provider';
import { ManualPaymentProvider, MANUAL_PROVIDER_CODE } from './manual.provider';
import {
  PaymentProvider,
  ProviderCapabilities,
  ProviderContext,
  ProviderCredentials,
} from './payment-provider.port';

export interface ResolvedProvider {
  providerId: string;
  provider: PaymentProvider;
  context: ProviderContext;
}

/**
 * Resolve o adaptador e o contexto de um provedor (RF-061).
 *
 * A conta bancária aponta para o provedor e para a credencial; daqui sai o par
 * (adaptador, contexto) que o serviço de pagamento usa sem saber com quem está
 * falando. Conta sem provedor cai no adaptador manual — o caso da empresa que
 * ainda paga pelo internet banking.
 *
 * A credencial é decifrada aqui e não sai deste objeto: nada dela vai para
 * `payload_envio`, para log ou para resposta da API (RNF-003/RNF-005).
 */
@Injectable()
export class ProviderResolver {
  private readonly adapters: Map<string, PaymentProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    manual: ManualPaymentProvider,
    http: HttpBankProvider,
  ) {
    this.adapters = new Map<string, PaymentProvider>([
      [manual.code, manual],
      [http.code, http],
    ]);
  }

  /** Provedor da conta bancária informada. */
  async resolveForAccount(
    companyId: string,
    account: { id: string; providerId: string | null; credentialId: string | null },
  ): Promise<ResolvedProvider> {
    if (!account.providerId) {
      return this.manualFallback(companyId);
    }

    const provider = await this.prisma.db.provider.findUnique({
      where: { id: account.providerId },
      select: { id: true, code: true, capabilities: true, isActive: true },
    });
    if (!provider || !provider.isActive) {
      throw new BadRequestException('A conta bancária aponta para um provedor inativo.');
    }

    const adapter = this.adapters.get(provider.code);
    if (!adapter) {
      throw new BadRequestException(
        `Não há adaptador implementado para o provedor ${provider.code}.`,
      );
    }

    const credentials = await this.loadCredentials(
      companyId,
      account.credentialId,
      adapter.requiresCredentials,
    );

    return {
      providerId: provider.id,
      provider: adapter,
      context: {
        companyId,
        providerCode: provider.code,
        capabilities: (provider.capabilities ?? {}) as ProviderCapabilities,
        credentials: credentials.secret,
        environment: credentials.environment,
      },
    };
  }

  /** Provedor por código — usado pela recepção de webhook (RF-066). */
  async resolveByCode(companyId: string, code: string): Promise<ResolvedProvider> {
    const provider = await this.prisma.db.provider.findUnique({
      where: { code },
      select: { id: true, code: true, capabilities: true, isActive: true },
    });
    if (!provider || !provider.isActive) {
      throw new NotFoundException('Provedor não encontrado.');
    }

    const adapter = this.adapters.get(provider.code);
    if (!adapter) {
      throw new NotFoundException('Provedor não encontrado.');
    }

    // A credencial ativa da empresa para aquele provedor é a que assina o
    // webhook. Havendo mais de um ambiente, a de produção é a que vale.
    const credential = await this.prisma.db.integrationCredential.findFirst({
      where: { companyId, providerId: provider.id, isActive: true },
      orderBy: [{ environment: 'asc' }, { createdAt: 'desc' }],
      select: { secret: true, environment: true, expiresAt: true },
    });

    return {
      providerId: provider.id,
      provider: adapter,
      context: {
        companyId,
        providerCode: provider.code,
        capabilities: (provider.capabilities ?? {}) as ProviderCapabilities,
        credentials: credential ? this.decode(credential.secret) : {},
        environment: credential?.environment ?? 'PRODUCAO',
      },
    };
  }

  private async manualFallback(companyId: string): Promise<ResolvedProvider> {
    const provider = await this.prisma.db.provider.findUnique({
      where: { code: MANUAL_PROVIDER_CODE },
      select: { id: true, capabilities: true },
    });
    if (!provider) {
      throw new BadRequestException('Catálogo de provedores não inicializado (bd/03).');
    }
    return {
      providerId: provider.id,
      provider: this.adapters.get(MANUAL_PROVIDER_CODE)!,
      context: {
        companyId,
        providerCode: MANUAL_PROVIDER_CODE,
        capabilities: (provider.capabilities ?? {}) as ProviderCapabilities,
        credentials: {},
        environment: 'PRODUCAO',
      },
    };
  }

  private async loadCredentials(
    companyId: string,
    credentialId: string | null,
    required: boolean,
  ): Promise<{ secret: ProviderCredentials; environment: string }> {
    if (!credentialId) {
      // O adaptador manual não fala com ninguém: cobrar credencial dele
      // impediria a empresa de registrar pagamentos antes de contratar uma
      // integração bancária.
      if (!required) {
        return { secret: {}, environment: 'PRODUCAO' };
      }
      throw new BadRequestException(
        'A conta bancária não tem credencial de integração associada (RF-061).',
      );
    }

    const credential = await this.prisma.db.integrationCredential.findFirst({
      where: { id: credentialId, companyId },
      select: { secret: true, environment: true, isActive: true, expiresAt: true },
    });
    if (!credential || !credential.isActive) {
      throw new BadRequestException('A credencial de integração está inativa.');
    }
    if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('A credencial de integração está vencida.');
    }

    return { secret: this.decode(credential.secret), environment: credential.environment };
  }

  private decode(secret: Uint8Array): ProviderCredentials {
    const parsed: unknown = JSON.parse(this.crypto.decrypt(Buffer.from(secret)));
    return parsed && typeof parsed === 'object' ? (parsed as ProviderCredentials) : {};
  }
}
