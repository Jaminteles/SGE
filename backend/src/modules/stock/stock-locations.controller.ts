import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { StockLocationsService } from './stock-locations.service';
import { CreateStockLocationDto } from './dto/create-stock-location.dto';
import { UpdateStockLocationDto } from './dto/update-stock-location.dto';

@ApiTags('Estoque — Locais')
@ApiBearerAuth()
@Controller('stock-locations')
export class StockLocationsController {
  constructor(private readonly locations: StockLocationsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.STOCK_LOCATIONS_CREATE)
  @ApiOperation({ summary: 'Cadastrar local de estoque de uma filial (RF-031)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateStockLocationDto) {
    return this.locations.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.STOCK_LOCATIONS_READ)
  @ApiOperation({ summary: 'Listar locais de estoque (paginado, com filtros)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.locations.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.STOCK_LOCATIONS_READ)
  @ApiOperation({ summary: 'Detalhar local de estoque' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.locations.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.STOCK_LOCATIONS_UPDATE)
  @ApiOperation({ summary: 'Editar local de estoque' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStockLocationDto,
  ) {
    return this.locations.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.STOCK_LOCATIONS_DELETE)
  @ApiOperation({ summary: 'Inativar local de estoque (recusado se houver saldo)' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.locations.remove(companyId, id);
  }
}
