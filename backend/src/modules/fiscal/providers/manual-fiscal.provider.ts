import { Injectable } from '@nestjs/common';
import {
  FiscalProvider,
  FiscalProviderError,
  FiscalTransmissionResult,
} from './fiscal-provider.port';

/** Código em `gestao.provider.codigo` (bd/18 §8). */
export const MANUAL_FISCAL_PROVIDER_CODE = 'FISCAL_MANUAL';

/**
 * Empresa sem integração fiscal contratada (RF-094).
 *
 * É o estado inicial de toda empresa, e um estado legítimo: quem transmite pelo
 * emissor da contabilidade registra o evento aqui (RF-092) e lança o protocolo
 * pela baixa manual. O adaptador existe para que o módulo funcione assim —
 * sem ele, registrar um evento dependeria de ter integração.
 *
 * `transmit` é inalcançável pelo caminho normal: `canTransmit` é falso e o
 * serviço recusa a transmissão antes de enfileirar. A implementação lança erro
 * permanente para o caso de alguém enfileirar por outro caminho — um job que
 * nunca pode dar certo não deve gastar as tentativas.
 */
@Injectable()
export class ManualFiscalProvider implements FiscalProvider {
  readonly code = MANUAL_FISCAL_PROVIDER_CODE;
  readonly requiresCredentials = false;
  readonly canTransmit = false;

  transmit(): Promise<FiscalTransmissionResult> {
    return Promise.reject(
      new FiscalProviderError(
        'Empresa sem integração fiscal: registre o retorno do fisco pela baixa manual do evento.',
        'SEM_INTEGRACAO',
        false,
      ),
    );
  }
}
