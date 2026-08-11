import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { CompensationService } from './compensation.service';
import { CreateCompensationDto } from './dto/create-compensation.dto';
import { UpdateCompensationDto } from './dto/update-compensation.dto';

@ApiTags('RH — Remuneração')
@ApiBearerAuth()
@Controller('employees/:employeeId/payroll-items')
export class CompensationController {
  constructor(private readonly compensation: CompensationService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.COMPENSATION_CREATE)
  @ApiOperation({ summary: 'Atribuir salário, benefício ou desconto ao funcionário (RF-017)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Param('employeeId') employeeId: string,
    @Body() dto: CreateCompensationDto,
  ) {
    return this.compensation.create(companyId, employeeId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.COMPENSATION_READ)
  @ApiOperation({ summary: 'Listar a remuneração do funcionário' })
  findAll(@ActiveCompanyId() companyId: string, @Param('employeeId') employeeId: string) {
    return this.compensation.findAll(companyId, employeeId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.COMPENSATION_UPDATE)
  @ApiOperation({ summary: 'Editar valor, percentual ou vigência' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('employeeId') employeeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCompensationDto,
  ) {
    return this.compensation.update(companyId, employeeId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.COMPENSATION_DELETE)
  @ApiOperation({ summary: 'Encerrar a vigência da verba (não remove o histórico)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD. Padrão: hoje.' })
  close(
    @ActiveCompanyId() companyId: string,
    @Param('employeeId') employeeId: string,
    @Param('id') id: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.compensation.close(companyId, employeeId, id, endDate);
  }
}
