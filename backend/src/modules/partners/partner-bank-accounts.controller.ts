import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { CreateBankAccountDto } from '../../common/banking/dto/create-bank-account.dto';
import { UpdateBankAccountDto } from '../../common/banking/dto/update-bank-account.dto';
import { PartnerBankAccountsService } from './partner-bank-accounts.service';

@ApiTags('Parceiros — Dados bancários')
@ApiBearerAuth()
@Controller('partners/:partnerId/bank-accounts')
export class PartnerBankAccountsController {
  constructor(private readonly accounts: PartnerBankAccountsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.PARTNER_BANK_ACCOUNTS_CREATE)
  @ApiOperation({ summary: 'Cadastrar dado bancário do parceiro (RF-024)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Param('partnerId') partnerId: string,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.accounts.create(companyId, partnerId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PARTNER_BANK_ACCOUNTS_READ)
  @ApiOperation({ summary: 'Listar dados bancários do parceiro' })
  findAll(@ActiveCompanyId() companyId: string, @Param('partnerId') partnerId: string) {
    return this.accounts.findAll(companyId, partnerId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PARTNER_BANK_ACCOUNTS_UPDATE)
  @ApiOperation({ summary: 'Editar dado bancário do parceiro' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('partnerId') partnerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.accounts.update(companyId, partnerId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PARTNER_BANK_ACCOUNTS_DELETE)
  @ApiOperation({ summary: 'Inativar dado bancário do parceiro' })
  remove(
    @ActiveCompanyId() companyId: string,
    @Param('partnerId') partnerId: string,
    @Param('id') id: string,
  ) {
    return this.accounts.remove(companyId, partnerId, id);
  }
}
