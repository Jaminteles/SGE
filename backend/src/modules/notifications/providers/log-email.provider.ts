import { Injectable, Logger } from '@nestjs/common';
import { EmailContext, EmailMessage, EmailProvider, EmailResult } from './email-provider.port';

/** Código em `gestao.provider.codigo` (bd/16 §9). */
export const LOG_EMAIL_PROVIDER_CODE = 'EMAIL_LOG';

/**
 * Adaptador da empresa que não contratou envio de e-mail (RF-120).
 *
 * Não manda nada, e é isso que ele precisa fazer: a notificação interna
 * (RF-119) continua valendo, e a tentativa de e-mail fica registrada como o que
 * é — uma entrega que não aconteceu. A alternativa seria recusar o canal EMAIL
 * até haver integração, o que deixaria as regras de automação sem o único canal
 * que alcança quem não está com o sistema aberto.
 *
 * `delivered: false` é deliberado: marcar como entregue o que não saiu
 * transformaria a caixa de saída em uma lista de mentiras verificáveis.
 */
@Injectable()
export class LogEmailProvider implements EmailProvider {
  readonly code = LOG_EMAIL_PROVIDER_CODE;
  readonly requiresCredentials = false;

  private readonly logger = new Logger(LogEmailProvider.name);

  send(message: EmailMessage, context: EmailContext): Promise<EmailResult> {
    // Só o id e o domínio: o endereço inteiro é dado pessoal, e log é o lugar
    // menos controlado do sistema (RNF-005).
    this.logger.log(
      `Notificação ${message.notificationId} (empresa ${context.companyId}) não enviada: ` +
        `empresa sem provedor de e-mail. Destino @${domainOf(message.to)}.`,
    );
    return Promise.resolve({ delivered: false });
  }
}

/** Domínio do endereço, para o log não carregar a caixa postal de ninguém. */
function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1) : 'desconhecido';
}
