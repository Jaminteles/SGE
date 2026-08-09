import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CostCentersService } from './cost-centers.service';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';

@ApiTags('Centros de Custo')
@ApiBearerAuth()
@Controller('cost-centers')
export class CostCentersController {
  constructor(private readonly costCenters: CostCentersService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.COST_CENTERS_CREATE)
  @ApiOperation({ summary: 'Cadastrar centro de custo (RF-006)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateCostCenterDto) {
    return this.costCenters.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.COST_CENTERS_READ)
  @ApiOperation({ summary: 'Listar centros de custo (paginado)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.costCenters.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.COST_CENTERS_READ)
  @ApiOperation({ summary: 'Detalhar centro de custo' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.costCenters.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.COST_CENTERS_UPDATE)
  @ApiOperation({ summary: 'Editar centro de custo (RF-006)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCostCenterDto,
  ) {
    return this.costCenters.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.COST_CENTERS_DELETE)
  @ApiOperation({ summary: 'Inativar centro de custo (RF-006)' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.costCenters.remove(companyId, id);
  }
}
