import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateLedgerAccountDto,
  QueryLedgerAccountDto,
  UpdateLedgerAccountDto,
} from './dto/ledger-account.dto';
import { LedgerAccountsService } from './ledger-accounts.service';

/**
 * Plano de contas (RF-078/RF-079).
 *
 * As permissões separam por consequência: consultar (`:READ`), cadastrar
 * (`:CREATE`), editar nome e classificação (`:UPDATE`) e inativar (`:DELETE`).
 * A escrita é a que importa — mudar o plano reclassifica retroativamente todo
 * saldo já apurado, e o balancete de um mês fechado muda sem que nenhum
 * lançamento tenha sido tocado. Toda alteração vai para a trilha (bd/17 §8).
 *
 * `DELETE` inativa, nunca apaga: o razão de um período fechado não pode passar
 * a apontar para uma conta que deixou de existir.
 */
@ApiTags('Contabilidade')
@ApiBearerAuth()
@Controller('ledger-accounts')
export class LedgerAccountsController {
  constructor(private readonly accounts: LedgerAccountsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.LEDGER_ACCOUNTS_CREATE)
  @ApiOperation({ summary: 'Cadastrar conta do plano de contas (RF-078/RF-079)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateLedgerAccountDto) {
    return this.accounts.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.LEDGER_ACCOUNTS_READ)
  @ApiOperation({ summary: 'Listar contas, com filtro por tipo e por analítica (RF-078)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryLedgerAccountDto) {
    return this.accounts.findAll(companyId, query);
  }

  @Get('tree')
  @RequirePermissions(PERMISSIONS.LEDGER_ACCOUNTS_READ)
  @ApiOperation({ summary: 'Plano de contas aninhado, do grupo à conta analítica (RF-078)' })
  tree(@ActiveCompanyId() companyId: string) {
    return this.accounts.tree(companyId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.LEDGER_ACCOUNTS_READ)
  @ApiOperation({ summary: 'Consultar uma conta contábil (RF-078)' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.LEDGER_ACCOUNTS_UPDATE)
  @ApiOperation({ summary: 'Editar nome, código reduzido e classificação SPED (RF-078)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLedgerAccountDto,
  ) {
    return this.accounts.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.LEDGER_ACCOUNTS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Inativar a conta; o histórico dela permanece (RF-078)' })
  deactivate(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.deactivate(companyId, id);
  }
}
