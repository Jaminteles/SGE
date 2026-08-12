import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { UnitsService } from './units.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

@ApiTags('Catálogo — Unidades de medida')
@ApiBearerAuth()
@Controller('units-of-measure')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.UNITS_OF_MEASURE_CREATE)
  @ApiOperation({ summary: 'Cadastrar unidade de medida (RF-029)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateUnitDto) {
    return this.units.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.UNITS_OF_MEASURE_READ)
  @ApiOperation({ summary: 'Listar unidades de medida (paginado)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.units.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.UNITS_OF_MEASURE_READ)
  @ApiOperation({ summary: 'Detalhar unidade de medida' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.units.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.UNITS_OF_MEASURE_UPDATE)
  @ApiOperation({ summary: 'Editar unidade de medida' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.units.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.UNITS_OF_MEASURE_DELETE)
  @ApiOperation({ summary: 'Inativar unidade de medida' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.units.remove(companyId, id);
  }
}
