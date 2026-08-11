import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@ApiTags('RH — Departamentos')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_CREATE)
  @ApiOperation({ summary: 'Cadastrar departamento (RF-014)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateDepartmentDto) {
    return this.departments.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_READ)
  @ApiOperation({ summary: 'Listar departamentos (paginado)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.departments.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_READ)
  @ApiOperation({ summary: 'Detalhar departamento' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.departments.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_UPDATE)
  @ApiOperation({ summary: 'Editar departamento (RF-014)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departments.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DEPARTMENTS_DELETE)
  @ApiOperation({ summary: 'Inativar departamento' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.departments.remove(companyId, id);
  }
}
