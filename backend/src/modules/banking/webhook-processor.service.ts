import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JobContext, PermanentJobError } from '../../common/queue/job.types';
import { PaymentTransactionsService } from './payment-transactions.service';
import { ProviderResolver } from './providers/provider-resolver.service';

export const WEBHOOK_JOBS = {
  PROCESS: 'webhook.process',
} as const;

/**
 * Processamento assíncrono do webhook já recebido (RF-066, RN-005).
 *
 * Roda no worker, dentro da transação do job: aplicar o efeito e fechar o evento
 * acontecem no mesmo commit. Se o efeito falhar, o evento continua PENDENTE e a
 * fila reagenda — nunca fica marcado como processado sem ter processado.
 *
 * A idempotência é dupla e vale a redundância: o evento já processado sai daqui
 * na primeira linha, e a confirmação que ele carrega passa por `applyResult`,
 * que só gera baixa uma vez (RN-004). Um provedor que reenvia o mesmo evento
 * três vezes não paga a mesma parcela três vezes.
 */
@Injectable()
export class WebhookProcessorService {
  private readonly logger = new Logger(WebhookProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderResolver,
    private readonly payments: PaymentTransactionsService,
  ) {}

  async process(eventId: string, context: JobContext): Promise<void> {
    const event = await this.prisma.db.webhookEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        companyId: true,
        providerId: true,
        payload: true,
        status: true,
        signatureValid: true,
      },
    });

    if (!event) {
      throw new PermanentJobError(`Evento de webhook ${eventId} não encontrado.`);
    }
    if (event.status === 'CONCLUIDO') {
      return;
    }
    if (event.signatureValid === false) {
      // Não deveria chegar aqui (não é enfileirado), mas confirmar de novo é
      // barato e o custo de errar é aceitar confirmação forjada.
      throw new PermanentJobError('Evento com assinatura inválida não é processado.');
    }
    if (!event.companyId || !event.providerId) {
      throw new PermanentJobError('Evento sem empresa ou provedor identificado.');
    }

    const provider = await this.prisma.db.provider.findUnique({
      where: { id: event.providerId },
      select: { code: true },
    });
    if (!provider) {
      throw new PermanentJobError('Provedor do evento não existe mais.');
    }

    const resolved = await this.providers.resolveByCode(event.companyId, provider.code);
    const parsed = resolved.provider.parseWebhookEvent(
      (event.payload ?? {}) as Record<string, unknown>,
    );

    if (!parsed) {
      // Evento legítimo que não diz respeito a pagamento: encerra sem efeito.
      await this.close(event.id, null, 'Evento sem correspondência com ordem de pagamento.');
      return;
    }

    const transaction = await this.findTransaction(event.companyId, event.providerId, parsed);
    if (!transaction) {
      // Pode ser corrida: a confirmação chegando antes de o envio ter gravado o
      // identificador externo. Erro comum e transitório — a fila retenta.
      throw new Error(
        `Nenhuma ordem encontrada para o evento ${eventId} (tentativa ${context.attempt}).`,
      );
    }

    await this.payments.applyResult(transaction, parsed.result);
    await this.close(event.id, transaction.id, null);
  }

  /**
   * Localiza a ordem pelo identificador externo (RF-068) ou pela chave de
   * idempotência que o provedor ecoa (RF-067).
   */
  private async findTransaction(
    companyId: string,
    providerId: string,
    parsed: { externalId?: string; idempotencyKey?: string },
  ) {
    if (parsed.externalId) {
      const byExternal = await this.prisma.db.paymentTransaction.findFirst({
        where: { companyId, providerId, externalId: parsed.externalId },
        select: { id: true },
      });
      if (byExternal) {
        return this.payments.load(companyId, byExternal.id);
      }
    }
    if (parsed.idempotencyKey) {
      const byKey = await this.prisma.db.paymentTransaction.findFirst({
        where: { companyId, idempotencyKey: parsed.idempotencyKey },
        select: { id: true },
      });
      if (byKey) {
        return this.payments.load(companyId, byKey.id);
      }
    }
    return null;
  }

  private async close(
    eventId: string,
    transactionId: string | null,
    note: string | null,
  ): Promise<void> {
    await this.prisma.db.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: 'CONCLUIDO',
        processedAt: new Date(),
        transactionId: transactionId ?? undefined,
        error: note ?? null,
      },
    });
  }
}
