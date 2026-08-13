import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { StockMovementsService } from './stock-movements.service';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { QueryStockMovementDto } from './dto/query-stock-movement.dto';

/**
 * Razão do estoque (RF-032).
 *
 * Só há POST e GET: o lançamento é append-only (bd/08), e por isso não existe
 * `PATCH` nem `DELETE` — estornar é lançar o movimento contrário.
 */
@ApiTags('Estoque — Movimentação')
@ApiBearerAuth()
@Controller('stock')
export class StockMovementsController {
  constructor(private readonly movements: StockMovementsService) {}

  @Post('movements')
  @RequirePermissions(PERMISSIONS.STOCK_MOVEMENTS_CREATE)
  @ApiOperation({ summary: 'Registrar entrada, saída ou ajuste (RF-032/RF-034)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Body() dto: CreateStockMovementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.movements.create(companyId, dto, user.id);
  }

  @Post('transfers')
  @RequirePermissions(PERMISSIONS.STOCK_MOVEMENTS_CREATE)
  @ApiOperation({ summary: 'Transferir entre locais — duas pernas atômicas (RF-032)' })
  transfer(
    @ActiveCompanyId() companyId: string,
    @Body() dto: CreateStockTransferDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.movements.transfer(companyId, dto, user.id);
  }

  @Get('movements')
  @RequirePermissions(PERMISSIONS.STOCK_MOVEMENTS_READ)
  @ApiOperation({ summary: 'Consultar a movimentação (paginado, com filtros)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryStockMovementDto) {
    return this.movements.findAll(companyId, query);
  }
}
