import { Injectable } from '@nestjs/common';
import { ProviderCategory } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { HttpOcrProvider } from './http-ocr.provider';
import { ManualOcrProvider, MANUAL_OCR_PROVIDER_CODE } from './manual-ocr.provider';
import {
  OcrCapabilities,
  OcrContext,
  OcrCredentials,
  OcrProvider,
  OcrProviderError,
} from './ocr-provider.port';

export interface ResolvedOcrProvider {
  providerId: string;
  provider: OcrProvider;
  context: OcrContext;
}

/**
 * Resolve o adaptador de OCR da empresa (RF-096).
 *
 * Diferente do M09, onde o provedor vem da conta bancária, aqui não há cadastro
 * intermediário: o provedor de OCR da empresa é aquele para o qual ela tem
 * credencial ativa na categoria `OCR`. Sem credencial, cai no adaptador manual
 * — o caso da empresa que ainda digita tudo, e que precisa poder usar o módulo
 * mesmo assim.
 *
 * A credencial é decifrada aqui e não sai deste objeto: nada dela vai para
 * `payload_bruto`, para log ou para resposta da API (RNF-003/RNF-005).
 */
@Injectable()
export class OcrProviderResolver {
  private readonly adapters: Map<string, OcrProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    manual: ManualOcrProvider,
    http: HttpOcrProvider,
  ) {
    this.adapters = new Map<string, OcrProvider>([
      [manual.code, manual],
      [http.code, http],
    ]);
  }

  async resolve(companyId: string): Promise<ResolvedOcrProvider> {
    const credential = await this.prisma.db.integrationCredential.findFirst({
      where: {
        companyId,
        isActive: true,
        provider: { category: ProviderCategory.OCR, isActive: true },
      },
      // Havendo mais de um ambiente, a de produção é a que vale — mesma ordem
      // do resolvedor do M09.
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
        capabilities: (credential.provider.capabilities ?? {}) as OcrCapabilities,
        credentials: this.decode(credential.secret),
        environment: credential.environment,
      },
    };
  }

  private async manualFallback(companyId: string): Promise<ResolvedOcrProvider> {
    const provider = await this.prisma.db.provider.findUnique({
      where: { code: MANUAL_OCR_PROVIDER_CODE },
      select: { id: true, capabilities: true },
    });
    if (!provider) {
      // Falha permanente: reexecutar o job não faz o catálogo aparecer.
      throw new OcrProviderError(
        'Catálogo de provedores de OCR não inicializado (bd/15).',
        'CATALOGO_AUSENTE',
        false,
      );
    }
    return {
      providerId: provider.id,
      provider: this.adapters.get(MANUAL_OCR_PROVIDER_CODE)!,
      context: {
        companyId,
        providerCode: MANUAL_OCR_PROVIDER_CODE,
        capabilities: (provider.capabilities ?? {}) as OcrCapabilities,
        credentials: {},
        environment: 'PRODUCAO',
      },
    };
  }

  private decode(secret: Uint8Array): OcrCredentials {
    const parsed: unknown = JSON.parse(this.crypto.decrypt(Buffer.from(secret)));
    return parsed && typeof parsed === 'object' ? (parsed as OcrCredentials) : {};
  }
}
