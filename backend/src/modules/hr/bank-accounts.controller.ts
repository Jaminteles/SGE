import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { BankAccountsService } from './bank-accounts.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';

@ApiTags('RH — Dados bancários')
@ApiBearerAuth()
@Controller('employees/:employeeId/bank-accounts')
export class BankAccountsController {
  constructor(private readonly accounts: BankAccountsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.BANK_ACCOUNTS_CREATE)
  @ApiOperation({ summary: 'Cadastrar dado bancário do funcionário (RF-013)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Param('employeeId') employeeId: string,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.accounts.create(companyId, employeeId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.BANK_ACCOUNTS_READ)
  @ApiOperation({ summary: 'Listar dados bancários do funcionário' })
  findAll(@ActiveCompanyId() companyId: string, @Param('employeeId') employeeId: string) {
    return this.accounts.findAll(companyId, employeeId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BANK_ACCOUNTS_UPDATE)
  @ApiOperation({ summary: 'Editar dado bancário do funcionário' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('employeeId') employeeId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.accounts.update(companyId, employeeId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BANK_ACCOUNTS_DELETE)
  @ApiOperation({ summary: 'Inativar dado bancário do funcionário' })
  remove(
    @ActiveCompanyId() companyId: string,
    @Param('employeeId') employeeId: string,
    @Param('id') id: string,
  ) {
    return this.accounts.remove(companyId, employeeId, id);
  }
}
