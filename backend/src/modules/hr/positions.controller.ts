import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PositionsService } from './positions.service';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';

@ApiTags('RH — Cargos')
@ApiBearerAuth()
@Controller('positions')
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.POSITIONS_CREATE)
  @ApiOperation({ summary: 'Cadastrar cargo (RF-014)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreatePositionDto) {
    return this.positions.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.POSITIONS_READ)
  @ApiOperation({ summary: 'Listar cargos (paginado)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.positions.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.POSITIONS_READ)
  @ApiOperation({ summary: 'Detalhar cargo' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.positions.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.POSITIONS_UPDATE)
  @ApiOperation({ summary: 'Editar cargo (RF-014)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePositionDto,
  ) {
    return this.positions.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.POSITIONS_DELETE)
  @ApiOperation({ summary: 'Inativar cargo' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.positions.remove(companyId, id);
  }
}
