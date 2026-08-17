import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { GoodsReceiptsService } from './goods-receipts.service';
import { PurchaseHistoryService } from './purchase-history.service';
import { QueryGoodsReceiptDto } from './dto/query-goods-receipt.dto';
import { QueryPurchaseHistoryDto } from './dto/query-purchase-history.dto';

/**
 * Consulta de recebimentos e histórico de compras (RF-040/RF-042).
 *
 * Somente leitura: o recebimento é registrado sob o pedido que ele confere
 * (`POST /purchase-orders/:id/receipts`) e é append-only no banco (bd/11).
 */
@ApiTags('Compras — Recebimentos e Histórico')
@ApiBearerAuth()
@Controller()
export class GoodsReceiptsController {
  constructor(
    private readonly receipts: GoodsReceiptsService,
    private readonly history: PurchaseHistoryService,
  ) {}

  @Get('goods-receipts')
  @RequirePermissions(PERMISSIONS.GOODS_RECEIPTS_READ)
  @ApiOperation({ summary: 'Consultar recebimentos e divergências (RF-039/RF-040)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryGoodsReceiptDto) {
    return this.receipts.findAll(companyId, query);
  }

  @Get('goods-receipts/:id')
  @RequirePermissions(PERMISSIONS.GOODS_RECEIPTS_READ)
  @ApiOperation({ summary: 'Detalhar a conferência de uma entrega (RF-040)' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.findOne(companyId, id);
  }

  @Get('purchase-history')
  @RequirePermissions(PERMISSIONS.PURCHASE_HISTORY_READ)
  @ApiOperation({ summary: 'Histórico de compras e de preços por item/fornecedor (RF-042)' })
  purchaseHistory(@ActiveCompanyId() companyId: string, @Query() query: QueryPurchaseHistoryDto) {
    return this.history.findAll(companyId, query);
  }
}
