import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { InventoriesService } from './inventories.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { CountInventoryDto } from './dto/count-inventory.dto';
import { CancelInventoryDto } from './dto/cancel-inventory.dto';
import { QueryInventoryDto } from './dto/query-inventory.dto';

@ApiTags('Estoque — Inventário')
@ApiBearerAuth()
@Controller('inventories')
export class InventoriesController {
  constructor(private readonly inventories: InventoriesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.INVENTORIES_CREATE)
  @ApiOperation({ summary: 'Abrir inventário com a fotografia dos saldos (RF-033)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Body() dto: CreateInventoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventories.create(companyId, dto, user.id);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORIES_READ)
  @ApiOperation({ summary: 'Listar inventários (paginado, com filtros)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryInventoryDto) {
    return this.inventories.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.INVENTORIES_READ)
  @ApiOperation({ summary: 'Detalhar inventário com itens e diferenças' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.inventories.findOne(companyId, id);
  }

  @Post(':id/start')
  @RequirePermissions(PERMISSIONS.INVENTORIES_UPDATE)
  @ApiOperation({ summary: 'Liberar a contagem' })
  start(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.inventories.startCount(companyId, id);
  }

  @Patch(':id/counts')
  @RequirePermissions(PERMISSIONS.INVENTORIES_UPDATE)
  @ApiOperation({ summary: 'Lançar as quantidades contadas (RF-033)' })
  count(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: CountInventoryDto,
  ) {
    return this.inventories.count(companyId, id, dto);
  }

  @Post(':id/close')
  @RequirePermissions(PERMISSIONS.INVENTORIES_APPROVE)
  @ApiOperation({ summary: 'Concluir a contagem e ajustar o estoque (RF-033/RN-003)' })
  close(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventories.close(companyId, id, user);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.INVENTORIES_DELETE)
  @ApiOperation({ summary: 'Cancelar a contagem com motivo (o registro é preservado — RN-009)' })
  cancel(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: CancelInventoryDto,
  ) {
    return this.inventories.cancel(companyId, id, dto);
  }
}
