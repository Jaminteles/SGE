import { Injectable } from '@nestjs/common';
import { PaymentTransactionStatus, Prisma } from '@prisma/client';
import { PERMISSIONS } from '../../../common/authorization/permission-catalog';
import { PrismaService } from '../../../prisma/prisma.service';
import { AutomationConditionsDto } from '../dto/automation-rule.dto';
import { LOOKBACK_DAYS, NOTIFICATION_TYPES, SCAN_BATCH_LIMIT } from '../notifications.constants';
import { AlertNotification, AlertRunnerService } from './alert-runner.service';

const DAY_MS = 86_400_000;

/** A ordem como o alerta precisa dela. */
interface PaymentFact {
  id: string;
  status: PaymentTransactionStatus;
  amount: Prisma.Decimal;
  description: string | null;
  payeeName: string | null;
  errorMessage: string | null;
}

/**
 * Alerta de pagamento processado ou falho (RF-122).
 *
 * São dois gatilhos e não um, porque são duas urgências diferentes: a ordem
 * confirmada é informação (o dinheiro saiu, o título baixou); a ordem que falhou
 * é trabalho parado — o fornecedor continua sem receber e ninguém percebe
 * olhando o extrato, porque não há lançamento nenhum lá.
 *
 * A falha entra com prioridade 1: é o único fato deste módulo em que o silêncio
 * significa que uma obrigação da empresa deixou de ser cumprida.
 *
 * A mensagem nunca carrega o motivo bruto devolvido pelo provedor — só o texto
 * de erro já tratado que a ordem guarda. Payload de integração pode conter
 * identificador de credencial, e notificação é o dado que mais circula
 * (RNF-005).
 */
@Injectable()
export class PaymentAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AlertRunnerService,
  ) {}

  /** Roda os dois gatilhos. Devolve o total de avisos criados. */
  async run(companyId: string): Promise<number> {
    const settled = await this.runner.run<PaymentFact>(companyId, {
      trigger: 'PAGAMENTO_PROCESSADO',
      defaultPermission: PERMISSIONS.PAYMENTS_READ,
      collect: (conditions) =>
        this.collect(companyId, conditions, [PaymentTransactionStatus.CONFIRMADA]),
      build: (payment) => this.buildSettled(payment),
    });

    const failed = await this.runner.run<PaymentFact>(companyId, {
      trigger: 'PAGAMENTO_FALHOU',
      defaultPermission: PERMISSIONS.PAYMENTS_READ,
      collect: (conditions) =>
        this.collect(companyId, conditions, [
          PaymentTransactionStatus.FALHA,
          PaymentTransactionStatus.EXPIRADA,
        ]),
      build: (payment) => this.buildFailed(payment),
    });

    return settled + failed;
  }

  private collect(
    companyId: string,
    conditions: AutomationConditionsDto,
    statuses: PaymentTransactionStatus[],
  ): Promise<PaymentFact[]> {
    return this.prisma.db.paymentTransaction.findMany({
      where: {
        companyId,
        status: { in: statuses },
        // A janela evita reavisar o histórico inteiro na primeira varredura
        // depois de um deploy; o dedupe evita reavisar dentro dela.
        updatedAt: { gte: new Date(Date.now() - LOOKBACK_DAYS * DAY_MS) },
        ...(conditions.minAmount
          ? { amount: { gte: new Prisma.Decimal(conditions.minAmount) } }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: SCAN_BATCH_LIMIT,
      select: {
        id: true,
        status: true,
        amount: true,
        description: true,
        payeeName: true,
        errorMessage: true,
      },
    });
  }

  private buildSettled(payment: PaymentFact): AlertNotification {
    return {
      type: NOTIFICATION_TYPES.PAYMENT_SETTLED,
      title: 'Pagamento confirmado pelo banco',
      message:
        `Ordem de R$ ${payment.amount.toFixed(2)} confirmada` +
        `${payment.payeeName ? ` para ${payment.payeeName}` : ''}` +
        `${payment.description ? `: ${payment.description}` : '.'}`,
      priority: 3,
      entity: 'transacao_pagamento',
      entityId: payment.id,
      dedupeKey: `PAGAMENTO:${payment.id}:${payment.status}`,
    };
  }

  private buildFailed(payment: PaymentFact): AlertNotification {
    return {
      type: NOTIFICATION_TYPES.PAYMENT_FAILED,
      title: 'Pagamento não foi processado',
      message:
        `Ordem de R$ ${payment.amount.toFixed(2)}` +
        `${payment.payeeName ? ` para ${payment.payeeName}` : ''} terminou em ` +
        `${payment.status}${payment.errorMessage ? `: ${payment.errorMessage}` : '.'}`,
      priority: 1,
      entity: 'transacao_pagamento',
      entityId: payment.id,
      dedupeKey: `PAGAMENTO:${payment.id}:${payment.status}`,
    };
  }
}
