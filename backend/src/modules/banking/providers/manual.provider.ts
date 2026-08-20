import { Injectable } from '@nestjs/common';
import {
  ParsedWebhookEvent,
  PaymentOrder,
  PaymentProvider,
  ProviderContext,
  ProviderError,
  ProviderResult,
} from './payment-provider.port';

/** Código em `gestao.provider.codigo`. */
export const MANUAL_PROVIDER_CODE = 'MANUAL';

/**
 * Provedor "sem provedor" (RF-061).
 *
 * A empresa que ainda paga pelo internet banking também precisa que a ordem
 * exista no sistema: é ela que dá baixa no título, entra no fluxo de caixa e
 * aparece na conciliação. Este adaptador registra a ordem como enviada e para
 * aí — a confirmação vem de uma pessoa, pelo endpoint `POST /:id/confirm`, que
 * exige permissão própria.
 *
 * Não consulta e não cancela depois de enviado, e é isso que suas capacidades
 * declaram: um `cancelamento: false` honesto vale mais que um cancelamento que
 * finge ter acontecido.
 */
@Injectable()
export class ManualPaymentProvider implements PaymentProvider {
  readonly code = MANUAL_PROVIDER_CODE;
  readonly requiresCredentials = false;

  send(_order: PaymentOrder, _context: ProviderContext): Promise<ProviderResult> {
    return Promise.resolve({ status: 'ENVIADA' });
  }

  query(_externalId: string, _context: ProviderContext): Promise<ProviderResult> {
    return Promise.reject(
      new ProviderError(
        'Pagamento manual não é consultado: a confirmação é registrada por um operador.',
        'CONSULTA_NAO_SUPORTADA',
        false,
      ),
    );
  }

  cancel(_externalId: string, _reason: string, _context: ProviderContext): Promise<ProviderResult> {
    return Promise.reject(
      new ProviderError(
        'Pagamento manual já enviado não é cancelado pelo sistema.',
        'CANCELAMENTO_NAO_SUPORTADO',
        false,
      ),
    );
  }

  verifyWebhookSignature(): boolean {
    // Não há webhook manual: aceitar um seria aceitar confirmação sem origem.
    return false;
  }

  parseWebhookEvent(): ParsedWebhookEvent | null {
    return null;
  }
}
