import { Module } from '@nestjs/common';

import { ApprovalsModule } from '../approvals/approvals.module';
import { StockModule } from '../stock/stock.module';
import { FinanceModule } from '../finance/finance.module';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { GoodsReceiptsController } from './goods-receipts.controller';
import { GoodsReceiptsService } from './goods-receipts.service';
import { PurchaseHistoryService } from './purchase-history.service';

/**
 * M06 — Compras (RF-036 a RF-042): pedidos com itens e despesas rateadas,
 * aprovação por alçada, recebimento total ou parcial com conferência de
 * quantidade e preço, vínculo com estoque e financeiro, e histórico de preços.
 *
 * Importa estoque e financeiro porque a entrega produz os dois efeitos (RF-041)
 * — e pelas portas de sempre: o razão de `StockMovementsService` e o título de
 * `FinancialEntriesService`. Compras não monta movimento nem parcelamento por
 * conta própria.
 */
@Module({
  imports: [ApprovalsModule, StockModule, FinanceModule],
  controllers: [PurchaseOrdersController, GoodsReceiptsController],
  providers: [PurchaseOrdersService, GoodsReceiptsService, PurchaseHistoryService],
  exports: [PurchaseOrdersService],
})
export class PurchasingModule {}
