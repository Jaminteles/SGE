import { Injectable, Logger } from '@nestjs/common';
import { ApprovalAlertsService } from './alerts/approval-alerts.service';
import { DivergenceAlertsService } from './alerts/divergence-alerts.service';
import { DueDateAlertsService } from './alerts/due-date-alerts.service';
import { PaymentAlertsService } from './alerts/payment-alerts.service';

/** O que uma varredura produziu, por alerta. */
export interface ScanResult {
  dueDates: number;
  payments: number;
  approvals: number;
  divergences: number;
  total: number;
}

/**
 * Varredura periódica dos alertas de uma empresa (RF-121 a RF-124).
 *
 * Roda os quatro alertas em sequência e não em paralelo: todos leem as mesmas
 * tabelas dentro da transação do job, e disparar quatro consultas concorrentes
 * na mesma conexão só troca latência por contenção.
 *
 * O resultado é devolvido em vez de logado por alerta porque quem precisa dele
 * é o job — é ele que decide entre "rodada silenciosa" e "rodada com trabalho",
 * e é no registro do job que a resposta fica para depois.
 */
@Injectable()
export class NotificationScanService {
  private readonly logger = new Logger(NotificationScanService.name);

  constructor(
    private readonly dueDates: DueDateAlertsService,
    private readonly payments: PaymentAlertsService,
    private readonly approvals: ApprovalAlertsService,
    private readonly divergences: DivergenceAlertsService,
  ) {}

  async run(companyId: string): Promise<ScanResult> {
    const dueDates = await this.dueDates.run(companyId);
    const payments = await this.payments.run(companyId);
    const approvals = await this.approvals.run(companyId);
    const divergences = await this.divergences.run(companyId);

    const result: ScanResult = {
      dueDates,
      payments,
      approvals,
      divergences,
      total: dueDates + payments + approvals + divergences,
    };

    if (result.total > 0) {
      this.logger.log(
        `Varredura da empresa ${companyId}: ${result.total} notificações ` +
          `(vencimentos ${dueDates}, pagamentos ${payments}, aprovações ${approvals}, ` +
          `divergências ${divergences}).`,
      );
    }

    return result;
  }
}
