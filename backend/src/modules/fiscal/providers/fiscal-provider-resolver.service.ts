import { Injectable } from '@nestjs/common';
import { ProviderCategory } from '@prisma/client';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  FiscalCapabilities,
  FiscalContext,
  FiscalCredentials,
  FiscalProvider,
  FiscalProviderError,
} from './fiscal-provider.port';
import { HttpFiscalProvider } from './http-fiscal.provider';
import { ManualFiscalProvider, MANUAL_FISCAL_PROVIDER_CODE } from './manual-fiscal.provider';

export interface ResolvedFiscalProvider {
  providerId: string;
  provider: FiscalProvider;
  context: FiscalContext;
}

/**
 * Resolve o adaptador fiscal da empresa (RF-094).
 *
 * Mesmo desenho do M13: o provedor da empresa é aquele para o qual ela tem
 * credencial ativa na categoria `FISCAL`. Sem credencial, cai no adaptador
 * manual — o caso da empresa que transmite pelo emissor da contabilidade, que
 * precisa poder usar o módulo mesmo assim.
 *
 * A credencial é decifrada aqui e não sai deste objeto: nada dela vai para
 * `retorno`, para log ou para resposta da API (RNF-003/RNF-005).
 */
@Injectable()
export class FiscalProviderResolver {
  private readonly adapters: Map<string, FiscalProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    manual: ManualFiscalProvider,
    http: HttpFiscalProvider,
  ) {
    this.adapters = new Map<string, FiscalProvider>([
      [manual.code, manual],
      [http.code, http],
    ]);
  }

  async resolve(companyId: string): Promise<ResolvedFiscalProvider> {
    const credential = await this.prisma.db.integrationCredential.findFirst({
      where: {
        companyId,
        isActive: true,
        provider: { category: ProviderCategory.FISCAL, isActive: true },
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
      return this.manualFallback(companyId);
    }

    return {
      providerId: credential.provider.id,
      provider: this.adapters.get(credential.provider.code)!,
      context: {
        companyId,
        providerCode: credential.provider.code,
        capabilities: (credential.provider.capabilities ?? {}) as FiscalCapabilities,
        credentials: this.decode(credential.secret),
        environment: credential.environment,
      },
    };
  }

  private async manualFallback(companyId: string): Promise<ResolvedFiscalProvider> {
    const provider = await this.prisma.db.provider.findUnique({
      where: { code: MANUAL_FISCAL_PROVIDER_CODE },
      select: { id: true, capabilities: true },
    });
    if (!provider) {
      // Falha permanente: reexecutar não faz o catálogo aparecer.
      throw new FiscalProviderError(
        'Catálogo de provedores fiscais não inicializado (bd/18).',
        'CATALOGO_AUSENTE',
        false,
      );
    }
    return {
      providerId: provider.id,
      provider: this.adapters.get(MANUAL_FISCAL_PROVIDER_CODE)!,
      context: {
        companyId,
        providerCode: MANUAL_FISCAL_PROVIDER_CODE,
        capabilities: (provider.capabilities ?? {}) as FiscalCapabilities,
        credentials: {},
        environment: 'PRODUCAO',
      },
    };
  }

  private decode(secret: Uint8Array): FiscalCredentials {
    const parsed: unknown = JSON.parse(this.crypto.decrypt(Buffer.from(secret)));
    return parsed && typeof parsed === 'object' ? (parsed as FiscalCredentials) : {};
  }
}
