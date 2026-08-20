import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { CompanyAccountsService } from './company-accounts.service';
import { CreateCompanyAccountDto } from './dto/create-company-account.dto';
import { UpdateCompanyAccountDto } from './dto/update-company-account.dto';
import { QueryCompanyAccountDto } from './dto/query-company-account.dto';

/**
 * Contas bancárias da empresa (RF-059).
 *
 * Não há `DELETE`: a conta é referenciada por ordens, extratos e baixas já
 * lançados. `PATCH { "isActive": false }` encerra a conta — o banco tira dela o
 * papel de padrão e a permissão de movimentar (bd/13 §3).
 */
@ApiTags('Bancos — Contas')
@ApiBearerAuth()
@Controller('banking/accounts')
export class CompanyAccountsController {
  constructor(private readonly accounts: CompanyAccountsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.COMPANY_BANK_ACCOUNTS_CREATE)
  @ApiOperation({ summary: 'Cadastrar conta bancária da empresa (RF-059)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateCompanyAccountDto) {
    return this.accounts.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.COMPANY_BANK_ACCOUNTS_READ)
  @ApiOperation({ summary: 'Listar contas bancárias (paginado, com filtros)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryCompanyAccountDto) {
    return this.accounts.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.COMPANY_BANK_ACCOUNTS_READ)
  @ApiOperation({ summary: 'Detalhar conta bancária, com saldo do último extrato' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.COMPANY_BANK_ACCOUNTS_UPDATE)
  @ApiOperation({
    summary: 'Alterar conta bancária — banco, agência e conta são imutáveis (RF-059)',
  })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyAccountDto,
  ) {
    return this.accounts.update(companyId, id, dto);
  }
}
