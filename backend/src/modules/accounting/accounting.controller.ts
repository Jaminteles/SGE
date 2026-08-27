import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AccountClassificationsService } from './account-classifications.service';
import { AccountingExportService } from './accounting-export.service';
import { AccountingPeriodsService } from './accounting-periods.service';
import { AccountingReportsService } from './accounting-reports.service';
import { ClassifiableSource } from './accounting.constants';
import {
  CloseAccountingPeriodDto,
  OpenAccountingYearDto,
  QueryAccountingPeriodDto,
  ReopenAccountingPeriodDto,
} from './dto/accounting-period.dto';
import {
  ExportAccountingDto,
  QueryIncomeStatementDto,
  QueryLedgerDto,
  QueryTrialBalanceDto,
} from './dto/accounting-report.dto';
import { AssignLedgerAccountDto, QueryClassificationDto } from './dto/classification.dto';
import { ParseClassifiableSourcePipe } from './parse-classifiable-source.pipe';

/**
 * Períodos, classificação, relatórios e exportação contábil
 * (RF-080, RF-083 a RF-087).
 *
 * As permissões separam por consequência:
 *
 *  - `accounting-periods:UPDATE` fecha e reabre. Reabrir um mês fechado é mexer
 *    em número já entregue ao contador, e por isso não acompanha a leitura;
 *  - `accounting-classifications:UPDATE` escolhe a conta de cada origem
 *    financeira. Quem a tem decide em que linha da DRE cada despesa cai — sem
 *    tocar em nenhum lançamento;
 *  - `accounting-reports:READ` lê razão, balancete e DRE: é o resultado inteiro
 *    da empresa, e não decorre de poder consultar títulos;
 *  - `accounting-reports:EXPORT` gera o arquivo para o contador. Separada da
 *    leitura porque tira o dado de dentro do sistema.
 *
 * Toda rota é escopada pela empresa ativa do header, e o id da URL é sempre
 * confrontado com ela na consulta.
 */
@ApiTags('Contabilidade')
@ApiBearerAuth()
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly periods: AccountingPeriodsService,
    private readonly classifications: AccountClassificationsService,
    private readonly reports: AccountingReportsService,
    private readonly exporter: AccountingExportService,
  ) {}

  // --- Períodos (RF-086) ---------------------------------------------------

  @Get('periods')
  @RequirePermissions(PERMISSIONS.ACCOUNTING_PERIODS_READ)
  @ApiOperation({ summary: 'Listar períodos contábeis e sua situação (RF-086)' })
  findPeriods(@ActiveCompanyId() companyId: string, @Query() query: QueryAccountingPeriodDto) {
    return this.periods.findAll(companyId, query);
  }

  @Post('periods')
  @RequirePermissions(PERMISSIONS.ACCOUNTING_PERIODS_UPDATE)
  @ApiOperation({ summary: 'Abrir os doze meses de um exercício (RF-086)' })
  openYear(@ActiveCompanyId() companyId: string, @Body() dto: OpenAccountingYearDto) {
    return this.periods.openYear(companyId, dto.year);
  }

  @Post('periods/:id/close')
  @RequirePermissions(PERMISSIONS.ACCOUNTING_PERIODS_UPDATE)
  @ApiOperation({ summary: 'Colocar em fechamento ou fechar o período (RF-086, RN-008)' })
  closePeriod(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseAccountingPeriodDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.periods.close(companyId, id, dto, userId);
  }

  @Post('periods/:id/reopen')
  @RequirePermissions(PERMISSIONS.ACCOUNTING_PERIODS_UPDATE)
  @ApiOperation({ summary: 'Reabrir um período fechado, com motivo (RF-086)' })
  reopenPeriod(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReopenAccountingPeriodDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.periods.reopen(companyId, id, dto, userId);
  }

  // --- Classificação (RF-080) ----------------------------------------------

  @Get('classifications/:source')
  @RequirePermissions(PERMISSIONS.ACCOUNTING_CLASSIFICATIONS_READ)
  @ApiOperation({
    summary: 'Origens financeiras e a conta contábil de cada uma (RF-080)',
    description: 'source: categories | payroll-items | bank-accounts',
  })
  findClassifications(
    @ActiveCompanyId() companyId: string,
    @Param('source', ParseClassifiableSourcePipe) source: ClassifiableSource,
    @Query() query: QueryClassificationDto,
  ) {
    return this.classifications.findAll(companyId, source, query);
  }

  @Put('classifications/:source/:id')
  @RequirePermissions(PERMISSIONS.ACCOUNTING_CLASSIFICATIONS_UPDATE)
  @ApiOperation({ summary: 'Classificar a origem financeira numa conta contábil (RF-080)' })
  assignClassification(
    @ActiveCompanyId() companyId: string,
    @Param('source', ParseClassifiableSourcePipe) source: ClassifiableSource,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignLedgerAccountDto,
  ) {
    return this.classifications.assign(companyId, source, id, dto);
  }

  // --- Relatórios (RF-083 a RF-085) ----------------------------------------

  @Get('reports/ledger')
  @RequirePermissions(PERMISSIONS.ACCOUNTING_REPORTS_READ)
  @ApiOperation({ summary: 'Razão de uma conta, com saldo anterior e corrido (RF-083)' })
  ledger(@ActiveCompanyId() companyId: string, @Query() query: QueryLedgerDto) {
    return this.reports.ledger(companyId, query);
  }

  @Get('reports/trial-balance')
  @RequirePermissions(PERMISSIONS.ACCOUNTING_REPORTS_READ)
  @ApiOperation({ summary: 'Balancete de verificação do período (RF-084)' })
  trialBalance(@ActiveCompanyId() companyId: string, @Query() query: QueryTrialBalanceDto) {
    return this.reports.trialBalance(companyId, query);
  }

  @Get('reports/income-statement')
  @RequirePermissions(PERMISSIONS.ACCOUNTING_REPORTS_READ)
  @ApiOperation({ summary: 'DRE do período, por conta de resultado (RF-085)' })
  incomeStatement(@ActiveCompanyId() companyId: string, @Query() query: QueryIncomeStatementDto) {
    return this.reports.incomeStatement(companyId, query);
  }

  // --- Exportação (RF-087) -------------------------------------------------

  @Post('export')
  @RequirePermissions(PERMISSIONS.ACCOUNTING_REPORTS_EXPORT)
  @ApiOperation({ summary: 'Exportar lançamentos para o sistema contábil (RF-087)' })
  async export(
    @ActiveCompanyId() companyId: string,
    @Body() dto: ExportAccountingDto,
    @CurrentUser('id') userId: string,
    @Res() response: Response,
  ) {
    const result = await this.exporter.export(companyId, dto, userId);

    // `attachment`: o conteúdo é dado da empresa e nunca é renderizado no
    // contexto da aplicação. O nome é gerado aqui, não vem do cliente.
    response.setHeader('Content-Type', result.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    response.setHeader('X-Total-Entries', String(result.entries));
    response.setHeader('X-Total-Lines', String(result.lines));
    response.send(result.content);
  }
}
