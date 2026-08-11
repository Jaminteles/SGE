import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { QueryEmployeeDto } from './dto/query-employee.dto';
import { TerminateEmployeeDto } from './dto/terminate-employee.dto';

@ApiTags('RH — Funcionários')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.EMPLOYEES_CREATE)
  @ApiOperation({ summary: 'Cadastrar funcionário e registrar a admissão (RF-013/RF-015)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Body() dto: CreateEmployeeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.employees.create(companyId, dto, userId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.EMPLOYEES_READ)
  @ApiOperation({ summary: 'Listar funcionários (paginado, com filtros)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryEmployeeDto) {
    return this.employees.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_READ)
  @ApiOperation({ summary: 'Detalhar funcionário' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.employees.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_UPDATE)
  @ApiOperation({ summary: 'Editar dados cadastrais e profissionais (RF-013/RF-016)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(companyId, id, dto);
  }

  @Post(':id/terminate')
  @RequirePermissions(PERMISSIONS.EMPLOYEES_DELETE)
  @ApiOperation({ summary: 'Registrar desligamento (RF-015)' })
  terminate(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: TerminateEmployeeDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.employees.terminate(companyId, id, dto, userId);
  }
}
