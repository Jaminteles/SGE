import { Module } from '@nestjs/common';

import { ReportExportService } from '../../common/export/report-export.service';
import { AccountingModule } from '../accounting/accounting.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { DashboardService } from './dashboard.service';
import { ReportGenerationService } from './report-generation.service';
import { ReportingController } from './reporting.controller';
import { StatementReportsService } from './statement-reports.service';

/**
 * M15 — Relatórios e Dashboards (RF-106 a RF-113).
 *
 * O módulo é só leitura: não tem tabela, não escreve em nenhuma e não define
 * regra de negócio. Os painéis saem das views de bd/19, e os relatórios
 * contábil e fiscal (RF-111) vêm dos serviços do M11 e do M12 — daí os dois
 * imports.
 *
 * A direção da dependência é essa e só essa: o M15 conhece a contabilidade e o
 * fiscal, e nenhum dos dois sabe que o M15 existe. Inverter isso faria cada
 * módulo de origem carregar a responsabilidade de se apresentar num painel.
 *
 * A auditoria vem do módulo global `AuditModule`.
 */
@Module({
  imports: [AccountingModule, FiscalModule],
  controllers: [ReportingController],
  providers: [
    DashboardService,
    StatementReportsService,
    ReportGenerationService,
    ReportExportService,
  ],
})
export class ReportingModule {}
