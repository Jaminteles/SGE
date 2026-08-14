import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { FinancialEntriesService } from './financial-entries.service';
import { InstallmentsService } from './installments.service';
import { SettlementsService } from './settlements.service';
import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import { QueryFinancialEntryDto } from './dto/query-financial-entry.dto';
import {
  ApproveFinancialEntryDto,
  CancelFinancialEntryDto,
  RejectFinancialEntryDto,
} from './dto/review-financial-entry.dto';
import { UpdateInstallmentDto } from './dto/update-installment.dto';
import { CreateSettlementDto, ReverseSettlementDto } from './dto/create-settlement.dto';

/**
 * Contas a pagar e a receber (RF-051 a RF-057).
 *
 * Um recurso só para as duas carteiras, discriminado por `type` — como no
 * modelo. Não há `DELETE`: título emitido é documento, e o que existe é
 * cancelamento com motivo (`POST /:id/cancel`).
 */
@ApiTags('Financeiro — Contas a Pagar e Receber')
@ApiBearerAuth()
@Controller('financial-entries')
export class FinancialEntriesController {
  constructor(
    private readonly entries: FinancialEntriesService,
    private readonly installments: InstallmentsService,
    private readonly settlements: SettlementsService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCIAL_ENTRIES_CREATE)
  @ApiOperation({ summary: 'Lançar título a pagar ou a receber (RF-051/RF-052/RF-053)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Body() dto: CreateFinancialEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.entries.create(companyId, dto, user.id);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCIAL_ENTRIES_READ)
  @ApiOperation({ summary: 'Consultar títulos (paginado, com filtros)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryFinancialEntryDto) {
    return this.entries.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FINANCIAL_ENTRIES_READ)
  @ApiOperation({ summary: 'Detalhar título com parcelas e baixas' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.entries.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.FINANCIAL_ENTRIES_UPDATE)
  @ApiOperation({ summary: 'Editar classificação e valores do título (RF-054)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinancialEntryDto,
  ) {
    return this.entries.update(companyId, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.FINANCIAL_ENTRIES_DELETE)
  @ApiOperation({ summary: 'Cancelar título — exige motivo' })
  cancel(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelFinancialEntryDto,
  ) {
    return this.entries.cancel(companyId, id, dto);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.FINANCIAL_ENTRIES_UPDATE)
  @ApiOperation({ summary: 'Enviar o título para aprovação (RF-056)' })
  submit(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.entries.submitForApproval(companyId, id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.FINANCIAL_ENTRIES_APPROVE)
  @ApiOperation({ summary: 'Aprovar o título — exige alçada e não ser quem lançou (RF-056)' })
  approve(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveFinancialEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.entries.approve(companyId, id, dto, user);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.FINANCIAL_ENTRIES_APPROVE)
  @ApiOperation({ summary: 'Reprovar o título — exige motivo (RF-056)' })
  reject(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectFinancialEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.entries.reject(companyId, id, dto, user);
  }

  @Patch(':id/installments/:installmentId')
  @RequirePermissions(PERMISSIONS.FINANCIAL_ENTRIES_UPDATE)
  @ApiOperation({ summary: 'Prorrogar vencimento e ajustar encargos da parcela (RF-055)' })
  updateInstallment(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Body() dto: UpdateInstallmentDto,
  ) {
    return this.installments.update(companyId, id, installmentId, dto);
  }

  @Post(':id/installments/:installmentId/settlements')
  @RequirePermissions(PERMISSIONS.SETTLEMENTS_CREATE)
  @ApiOperation({ summary: 'Registrar pagamento ou recebimento, total ou parcial (RF-057)' })
  settle(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Body() dto: CreateSettlementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settlements.create(companyId, id, installmentId, dto, user.id);
  }

  @Post(':id/installments/:installmentId/settlements/:settlementId/reverse')
  @RequirePermissions(PERMISSIONS.SETTLEMENTS_DELETE)
  @ApiOperation({ summary: 'Estornar a baixa — lançamento contrário, nunca remoção (RF-057)' })
  reverse(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('installmentId', ParseUUIDPipe) installmentId: string,
    @Param('settlementId', ParseUUIDPipe) settlementId: string,
    @Body() dto: ReverseSettlementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settlements.reverse(companyId, id, installmentId, settlementId, dto, user.id);
  }
}
