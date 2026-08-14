import { Module } from '@nestjs/common';

import { ApprovalsModule } from '../approvals/approvals.module';
import { FinancialEntriesController } from './financial-entries.controller';
import { FinancialEntriesService } from './financial-entries.service';
import { InstallmentsService } from './installments.service';
import { SettlementsService } from './settlements.service';
import { DelinquencyService } from './delinquency.service';
import { PortfolioController } from './portfolio.controller';
import { RecurrencesController } from './recurrences.controller';
import { RecurrencesService } from './recurrences.service';

/**
 * M08 — Contas a Pagar e Receber (RF-051 a RF-058): títulos das duas carteiras,
 * parcelamento e recorrências, aprovação por alçada, baixas e estornos,
 * posição da carteira e inadimplência.
 *
 * `FinancialEntriesService` é exportado porque o título também nasce de outros
 * processos: reembolso aprovado (M03), pedido de compra (M06) e documento
 * fiscal (M07). A porta é sempre a mesma — quem cria por fora não monta o
 * parcelamento nem a numeração por conta própria.
 */
@Module({
  imports: [ApprovalsModule],
  controllers: [FinancialEntriesController, PortfolioController, RecurrencesController],
  providers: [
    FinancialEntriesService,
    InstallmentsService,
    SettlementsService,
    DelinquencyService,
    RecurrencesService,
  ],
  exports: [FinancialEntriesService],
})
export class FinanceModule {}
