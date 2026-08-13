import { Module } from '@nestjs/common';

import { StockLocationsController } from './stock-locations.controller';
import { StockLocationsService } from './stock-locations.service';
import { StockBalancesController } from './stock-balances.controller';
import { StockBalancesService } from './stock-balances.service';
import { StockMovementsController } from './stock-movements.controller';
import { StockMovementsService } from './stock-movements.service';
import { InventoriesController } from './inventories.controller';
import { InventoriesService } from './inventories.service';

/**
 * M05 — Estoque (RF-031 a RF-035): locais por filial, saldos e custo médio,
 * movimentação, transferências, inventário e alerta de estoque mínimo.
 *
 * `StockMovementsService` é exportado porque a entrada de estoque também nasce
 * do recebimento (M06) e da nota fiscal (M07): a porta é sempre o razão.
 */
@Module({
  controllers: [
    StockLocationsController,
    StockBalancesController,
    StockMovementsController,
    InventoriesController,
  ],
  providers: [
    StockLocationsService,
    StockBalancesService,
    StockMovementsService,
    InventoriesService,
  ],
  exports: [StockMovementsService],
})
export class StockModule {}
