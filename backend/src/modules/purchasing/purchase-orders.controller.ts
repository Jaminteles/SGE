import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PurchaseOrdersService } from './purchase-orders.service';
import { GoodsReceiptsService } from './goods-receipts.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import {
  ApprovePurchaseOrderDto,
  CancelPurchaseOrderDto,
  RejectPurchaseOrderDto,
} from './dto/review-purchase-order.dto';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { QueryGoodsReceiptDto } from './dto/query-goods-receipt.dto';

/**
 * Pedidos de compra (RF-036 a RF-041).
 *
 * Não há `DELETE`: pedido emitido é documento, e o que existe é cancelamento com
 * motivo (`POST /:id/cancel`). O recebimento entra por baixo do pedido porque é
 * dele que a conferência depende — mas com permissão própria, porque quem
 * compra não é quem recebe (RN-003).
 */
@ApiTags('Compras — Pedidos e Recebimento')
@ApiBearerAuth()
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly orders: PurchaseOrdersService,
    private readonly receipts: GoodsReceiptsService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_CREATE)
  @ApiOperation({ summary: 'Criar pedido de compra com itens (RF-036/RF-037)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.create(companyId, dto, user.id);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_READ)
  @ApiOperation({ summary: 'Acompanhar pedidos (paginado, com filtros) — RF-036' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryPurchaseOrderDto) {
    return this.orders.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_READ)
  @ApiOperation({ summary: 'Detalhar pedido com itens e recebimentos' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_UPDATE)
  @ApiOperation({ summary: 'Editar o pedido em rascunho — `items` substitui a lista (RF-037)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.orders.update(companyId, id, dto);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_UPDATE)
  @ApiOperation({ summary: 'Fechar o rascunho: aprova na hora ou envia à alçada (RF-038)' })
  submit(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.submitForApproval(companyId, id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_APPROVE)
  @ApiOperation({ summary: 'Aprovar o pedido — exige alçada e não ser quem pediu (RF-038)' })
  approve(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovePurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.approve(companyId, id, dto, user);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_APPROVE)
  @ApiOperation({ summary: 'Reprovar o pedido — exige motivo (RF-038)' })
  reject(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPurchaseOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.reject(companyId, id, dto, user);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_DELETE)
  @ApiOperation({ summary: 'Cancelar o pedido — exige motivo e nenhuma entrega registrada' })
  cancel(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPurchaseOrderDto,
  ) {
    return this.orders.cancel(companyId, id, dto);
  }

  @Post(':id/receipts')
  @RequirePermissions(PERMISSIONS.GOODS_RECEIPTS_CREATE)
  @ApiOperation({
    summary: 'Registrar recebimento total ou parcial, com conferência (RF-039 a RF-041)',
  })
  receive(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGoodsReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.receipts.create(companyId, id, dto, user.id);
  }

  @Get(':id/receipts')
  @RequirePermissions(PERMISSIONS.GOODS_RECEIPTS_READ)
  @ApiOperation({ summary: 'Entregas registradas para o pedido (RF-039)' })
  listReceipts(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryGoodsReceiptDto,
  ) {
    query.orderId = id;
    return this.receipts.findAll(companyId, query);
  }
}
