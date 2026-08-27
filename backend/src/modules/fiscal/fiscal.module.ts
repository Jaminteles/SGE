import { Module } from '@nestjs/common';

import { FiscalDocumentsModule } from '../fiscal-documents/fiscal-documents.module';
import { DocumentTaxesService } from './document-taxes.service';
import { FiscalController } from './fiscal.controller';
import { FiscalEventsService } from './fiscal-events.service';
import { FiscalReportsService } from './fiscal-reports.service';
import { FiscalTransmissionService } from './fiscal-transmission.service';
import { FiscalJobsService } from './jobs/fiscal-jobs.service';
import { FiscalProviderResolver } from './providers/fiscal-provider-resolver.service';
import { HttpFiscalProvider } from './providers/http-fiscal.provider';
import { ManualFiscalProvider } from './providers/manual-fiscal.provider';
import { TaxClassificationsController } from './tax-classifications.controller';
import { TaxClassificationsService } from './tax-classifications.service';
import { TaxParametersController } from './tax-parameters.controller';
import { TaxParametersService } from './tax-parameters.service';
import { TaxRulesController } from './tax-rules.controller';
import { TaxRulesService } from './tax-rules.service';

/**
 * M12 — Fiscal (RF-088 a RF-094).
 *
 * Mantém os parâmetros fiscais da empresa (RF-088), as classificações de NCM,
 * CEST, CFOP e CST (RF-089), lê a tributação declarada nos documentos e a liga
 * ao cadastro (RF-090), resolve o tratamento esperado de cada operação
 * (RF-091), registra e transmite eventos fiscais (RF-092/RF-094) e apura o
 * movimento em relatório (RF-093).
 *
 * Importa `FiscalDocumentsModule` porque o cancelamento autorizado pelo fisco
 * precisa cancelar a nota — e pelo serviço do M07, que é onde estão as travas de
 * documento que já gerou estoque ou título. A direção é essa e só essa: o M12
 * lê a nota e a classifica, mas quem decide o que acontece com o documento é o
 * módulo dono dele.
 *
 * A auditoria vem do módulo global `AuditModule`; a fila, do `QueueModule`.
 */
@Module({
  imports: [FiscalDocumentsModule],
  controllers: [
    TaxParametersController,
    TaxClassificationsController,
    TaxRulesController,
    FiscalController,
  ],
  providers: [
    TaxParametersService,
    TaxClassificationsService,
    TaxRulesService,
    DocumentTaxesService,
    FiscalEventsService,
    FiscalReportsService,
    FiscalTransmissionService,
    FiscalProviderResolver,
    ManualFiscalProvider,
    HttpFiscalProvider,
    FiscalJobsService,
  ],
  exports: [TaxParametersService, TaxClassificationsService, TaxRulesService],
})
export class FiscalModule {}
