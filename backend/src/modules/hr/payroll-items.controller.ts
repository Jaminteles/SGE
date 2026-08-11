import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PayrollItemType } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PayrollItemsService } from './payroll-items.service';
import { CreatePayrollItemDto } from './dto/create-payroll-item.dto';
import { UpdatePayrollItemDto } from './dto/update-payroll-item.dto';

@ApiTags('RH — Verbas')
@ApiBearerAuth()
@Controller('payroll-items')
export class PayrollItemsController {
  constructor(private readonly payrollItems: PayrollItemsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.PAYROLL_ITEMS_CREATE)
  @ApiOperation({ summary: 'Cadastrar verba de salário, benefício ou desconto (RF-017)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreatePayrollItemDto) {
    return this.payrollItems.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PAYROLL_ITEMS_READ)
  @ApiOperation({ summary: 'Listar verbas (paginado)' })
  @ApiQuery({ name: 'type', enum: PayrollItemType, required: false })
  findAll(
    @ActiveCompanyId() companyId: string,
    @Query() query: PaginationQueryDto,
    @Query('type') type?: PayrollItemType,
  ) {
    return this.payrollItems.findAll(companyId, query, type);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PAYROLL_ITEMS_READ)
  @ApiOperation({ summary: 'Detalhar verba' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.payrollItems.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PAYROLL_ITEMS_UPDATE)
  @ApiOperation({ summary: 'Editar verba (RF-017)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePayrollItemDto,
  ) {
    return this.payrollItems.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PAYROLL_ITEMS_DELETE)
  @ApiOperation({ summary: 'Inativar verba' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.payrollItems.remove(companyId, id);
  }
}
