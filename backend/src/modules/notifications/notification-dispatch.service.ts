import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { PermanentJobError } from '../../common/queue/job.types';
import { PrismaService } from '../../prisma/prisma.service';
import { MAX_DELIVERY_ATTEMPTS } from './notifications.constants';
import { EmailProviderError } from './providers/email-provider.port';
import { EmailProviderResolver } from './providers/email-provider-resolver.service';

/**
 * Entrega das notificações de canal externo (RF-120).
 *
 * Roda no worker, um job por notificação. Três propriedades importam:
 *
 *  1. **entrega única** — a reivindicação é um `updateMany` condicionado a
 *     `PENDENTE`. Dois workers que peguem o mesmo aviso (retry da fila + job
 *     duplicado) disputam essa linha, e só um sai com `count = 1`; o outro
 *     encerra sem chamar o provedor. Sem isso, o destinatário recebe o mesmo
 *     e-mail duas vezes, e um aviso repetido de pagamento falho faz alguém pagar
 *     duas vezes por fora;
 *  2. **falha classificada** — provedor fora volta para a fila com backoff
 *     (RF-070); endereço recusado encerra em FALHA na hora. Insistir num
 *     endereço inválido gasta as tentativas de todos os outros avisos;
 *  3. **teto de tentativas** — passado `MAX_DELIVERY_ATTEMPTS`, o aviso para em
 *     FALHA. A notificação interna correspondente continua na caixa de entrada:
 *     o conteúdo nunca depende do e-mail ter saído.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailProviderResolver,
  ) {}

  async dispatch(companyId: string, notificationId: string): Promise<void> {
    const notification = await this.prisma.db.notification.findFirst({
      where: { id: notificationId, companyId },
      select: {
        id: true,
        channel: true,
        status: true,
        attempts: true,
        title: true,
        message: true,
        recipientEmail: true,
        link: true,
      },
    });

    if (!notification) {
      // Id que não existe nesta empresa não melhora com repetição.
      throw new PermanentJobError('Notificação não encontrada para despacho.');
    }
    if (notification.status !== NotificationStatus.PENDENTE) {
      // Já entregue, já lida ou cancelada: nada a fazer, e não é erro.
      return;
    }
    if (notification.channel !== NotificationChannel.EMAIL) {
      throw new PermanentJobError(
        `Canal ${notification.channel} não tem adaptador de entrega (RF-120).`,
      );
    }
    if (!notification.recipientEmail) {
      await this.fail(notification.id, 'Notificação de e-mail sem destinatário.');
      return;
    }
    if (notification.attempts >= MAX_DELIVERY_ATTEMPTS) {
      await this.fail(notification.id, 'Teto de tentativas de entrega atingido.');
      return;
    }

    const claimed = await this.claim(companyId, notification.id);
    if (!claimed) {
      // Outro worker levou este aviso. Encerrar em silêncio é o correto.
      return;
    }

    const { provider, context } = await this.email.resolve(companyId);

    try {
      const result = await provider.send(
        {
          notificationId: notification.id,
          to: notification.recipientEmail,
          subject: notification.title,
          body: notification.link
            ? `${notification.message}\n\n${notification.link}`
            : notification.message,
        },
        context,
      );

      if (!result.delivered) {
        // Adaptador que não envia (empresa sem integração): a tentativa fica
        // registrada como o que é, e o aviso interno já está entregue.
        await this.fail(
          notification.id,
          'Empresa sem provedor de e-mail: o aviso permanece apenas na caixa interna.',
        );
        return;
      }

      await this.prisma.db.notification.updateMany({
        where: { id: notification.id, status: NotificationStatus.PENDENTE },
        data: { status: NotificationStatus.ENVIADA, sentAt: new Date(), error: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = error instanceof EmailProviderError ? error.retryable : true;
      const exhausted = notification.attempts + 1 >= MAX_DELIVERY_ATTEMPTS;

      if (!retryable || exhausted) {
        await this.fail(notification.id, message);
        return;
      }

      // Volta para a fila: `PENDENTE` com a tentativa consumida registrada. O
      // backoff é do runner (RF-070), não daqui.
      await this.prisma.db.notification.updateMany({
        where: { id: notification.id },
        data: { error: message.slice(0, 2000) },
      });
      this.logger.warn(`Entrega da notificação ${notification.id} falhou: ${message}`);
      throw error;
    }
  }

  /**
   * Reivindica a notificação incrementando a tentativa.
   *
   * `updateMany` condicionado ao estado: é a única instrução, e o `count` diz
   * se este processo é quem vai chamar o provedor.
   */
  private async claim(companyId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.db.notification.updateMany({
      where: { id, companyId, status: NotificationStatus.PENDENTE },
      data: { attempts: { increment: 1 } },
    });
    return count === 1;
  }

  /** Encerra a entrega em FALHA. O aviso interno correspondente permanece. */
  private async fail(id: string, message: string): Promise<void> {
    await this.prisma.db.notification.updateMany({
      where: { id, status: NotificationStatus.PENDENTE },
      data: { status: NotificationStatus.FALHA, error: message.slice(0, 2000) },
    });
  }
}
