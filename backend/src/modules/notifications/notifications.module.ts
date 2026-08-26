import { Module } from '@nestjs/common';

import { AlertRunnerService } from './alerts/alert-runner.service';
import { ApprovalAlertsService } from './alerts/approval-alerts.service';
import { DivergenceAlertsService } from './alerts/divergence-alerts.service';
import { DueDateAlertsService } from './alerts/due-date-alerts.service';
import { PaymentAlertsService } from './alerts/payment-alerts.service';
import { AutomationRulesController } from './automation-rules.controller';
import { AutomationRulesService } from './automation-rules.service';
import { NotificationJobsService } from './jobs/notification-jobs.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationScanService } from './notification-scan.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailProviderResolver } from './providers/email-provider-resolver.service';
import { HttpEmailProvider } from './providers/http-email.provider';
import { LogEmailProvider } from './providers/log-email.provider';

/**
 * M17 — Notificações e Automação (RF-119 a RF-125).
 *
 * Avisa quem precisa decidir: gera a notificação interna (RF-119), entrega por
 * e-mail (RF-120) e observa quatro fatos — vencimento (RF-121), pagamento
 * processado ou falho (RF-122), aprovação parada (RF-123) e divergência de
 * conciliação (RF-124). As regras (RF-125) dizem quando avisar e quem avisar.
 *
 * Não importa `FinanceModule`, `BankingModule`, `PurchasingModule` nem
 * `ReconciliationModule`, e isso é deliberado: este módulo **só lê**. As
 * varreduras consultam `titulo_parcela`, `transacao_pagamento`, `pedido_compra`
 * e `conciliacao` e escrevem apenas em `notificacao`, `regra_automacao` e
 * `regra_automacao_execucao`. Depender daqueles serviços criaria um caminho
 * pelo qual uma regra de aviso mal configurada prorrogaria parcela, cancelaria
 * ordem ou confirmaria conciliação — e o erro de configuração viraria dinheiro
 * movimentado sem ninguém ter decidido nada.
 *
 * A fila, a criptografia e a auditoria vêm dos módulos globais `QueueModule`,
 * `CryptoModule` e `AuditModule`.
 */
@Module({
  controllers: [NotificationsController, AutomationRulesController],
  providers: [
    NotificationsService,
    NotificationScanService,
    NotificationDispatchService,
    AutomationRulesService,
    AlertRunnerService,
    DueDateAlertsService,
    PaymentAlertsService,
    ApprovalAlertsService,
    DivergenceAlertsService,
    NotificationJobsService,
    EmailProviderResolver,
    LogEmailProvider,
    HttpEmailProvider,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
