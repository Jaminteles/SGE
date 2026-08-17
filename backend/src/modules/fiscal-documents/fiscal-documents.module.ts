import { Module } from '@nestjs/common';

import { StockModule } from '../stock/stock.module';
import { FinanceModule } from '../finance/finance.module';
import { FiscalDocumentsController } from './fiscal-documents.controller';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { FiscalPostingsService } from './fiscal-postings.service';
import { FiscalAttachmentsController } from './fiscal-attachments.controller';
import { FiscalAttachmentsService } from './fiscal-attachments.service';

/**
 * M07 — Documentos Fiscais (RF-043 a RF-050): importação de XML com conferência
 * da chave de acesso, armazenamento do original e dos metadados, processamento de
 * emitente, itens, valores e tributos, detecção de duplicidade, vínculo com
 * fornecedor, pedido, produtos, estoque e financeiro, anexo de DANFE/PDF,
 * controle de erros e reprocessamento, e coleta automática por integração.
 *
 * Importa estoque e financeiro porque a nota sem pedido é o próprio fato de
 * entrada (RF-047) — e pelas portas de sempre: o razão de `StockMovementsService`
 * e o título de `FinancialEntriesService`. Este módulo não monta movimento nem
 * parcelamento por conta própria.
 */
@Module({
  imports: [StockModule, FinanceModule],
  controllers: [FiscalDocumentsController, FiscalAttachmentsController],
  providers: [FiscalDocumentsService, FiscalPostingsService, FiscalAttachmentsService],
  exports: [FiscalDocumentsService],
})
export class FiscalDocumentsModule {}
