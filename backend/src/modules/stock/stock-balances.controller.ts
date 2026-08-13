import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { StockBalancesService } from './stock-balances.service';
import { QueryStockBalanceDto } from './dto/query-stock-balance.dto';

@ApiTags('Estoque — Saldos e alertas')
@ApiBearerAuth()
@Controller('stock')
export class StockBalancesController {
  constructor(private readonly balances: StockBalancesService) {}

  @Get('balances')
  @RequirePermissions(PERMISSIONS.STOCK_READ)
  @ApiOperation({ summary: 'Saldos por produto e local (RF-031)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryStockBalanceDto) {
    return this.balances.findAll(companyId, query);
  }

  @Get('alerts')
  @RequirePermissions(PERMISSIONS.STOCK_READ)
  @ApiOperation({ summary: 'Itens no ou abaixo do estoque mínimo (RF-035)' })
  @ApiQuery({ name: 'locationId', required: false })
  alerts(@ActiveCompanyId() companyId: string, @Query('locationId') locationId?: string) {
    return this.balances.alerts(companyId, locationId);
  }

  @Get('valuation')
  @RequirePermissions(PERMISSIONS.STOCK_VALUATION_READ)
  @ApiOperation({ summary: 'Valorização do estoque a custo médio (RF-034)' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'locationId', required: false })
  valuation(
    @ActiveCompanyId() companyId: string,
    @Query('branchId') branchId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.balances.valuation(companyId, branchId, locationId);
  }

  @Get('products/:productId')
  @RequirePermissions(PERMISSIONS.STOCK_READ)
  @ApiOperation({ summary: 'Posição de um item: saldo por local e total na empresa (RF-031)' })
  findByProduct(@ActiveCompanyId() companyId: string, @Param('productId') productId: string) {
    return this.balances.findByProduct(companyId, productId);
  }
}
