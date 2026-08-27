import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DashboardService } from './dashboard.service';
import { ExportReportDto, ReportFilterDto } from './dto/report-filter.dto';
import { ReportGenerationService } from './report-generation.service';
import { StatementReportsService } from './statement-reports.service';

/**
 * Painéis e relatórios gerenciais (RF-106 a RF-113).
 *
 * A empresa vem sempre do header e nunca do filtro; o guard a valida contra as
 * associações do usuário antes de qualquer consulta, e a RLS a aplica no banco.
 *
 * As permissões seguem a consequência de cada rota:
 *
 *  - painel é `dashboards:READ`: número agregado, sem a linha individual;
 *  - relatório é `reports:READ`, e o contábil e o fiscal exigem **também** a
 *    leitura do módulo de origem — o M15 não é atalho para o que a permissão do
 *    M11 ou do M12 nega;
 *  - exportar é `reports:EXPORT`, separado da leitura porque tira o dado de
 *    dentro do sistema, e auditado por isso.
 */
@ApiTags('Relatórios e Dashboards')
@ApiBearerAuth()
@Controller('reports')
export class ReportingController {
  constructor(
    private readonly dashboards: DashboardService,
    private readonly statements: StatementReportsService,
    private readonly reports: ReportGenerationService,
  ) {}

  // --- RF-106 a RF-110: painéis ---------------------------------------------

  @Get('dashboard/financial')
  @RequirePermissions(PERMISSIONS.DASHBOARDS_READ)
  @ApiOperation({ summary: 'Dashboard financeiro: carteira, realizado e saldo (RF-106)' })
  financial(@ActiveCompanyId() companyId: string, @Query() query: ReportFilterDto) {
    return this.dashboards.financial(companyId, query);
  }

  @Get('dashboard/portfolio')
  @RequirePermissions(PERMISSIONS.DASHBOARDS_READ)
  @ApiOperation({ summary: 'Contas a pagar e a receber, com aging (RF-107)' })
  portfolio(@ActiveCompanyId() companyId: string, @Query() query: ReportFilterDto) {
    return this.dashboards.portfolio(companyId, query);
  }

  @Get('dashboard/cash-flow')
  @RequirePermissions(PERMISSIONS.DASHBOARDS_READ)
  @ApiOperation({ summary: 'Fluxo de caixa realizado e resultado do período (RF-108)' })
  cashFlow(@ActiveCompanyId() companyId: string, @Query() query: ReportFilterDto) {
    return this.dashboards.cashFlow(companyId, query);
  }

  @Get('dashboard/purchasing')
  @RequirePermissions(PERMISSIONS.DASHBOARDS_READ)
  @ApiOperation({ summary: 'Indicadores de compras, estoque e fornecedores (RF-109)' })
  purchasing(@ActiveCompanyId() companyId: string, @Query() query: ReportFilterDto) {
    return this.dashboards.purchasing(companyId, query);
  }

  @Get('dashboard/workforce')
  @RequirePermissions(PERMISSIONS.DASHBOARDS_READ)
  @ApiOperation({ summary: 'Indicadores de funcionários e centros de custo (RF-110)' })
  workforce(@ActiveCompanyId() companyId: string, @Query() query: ReportFilterDto) {
    return this.dashboards.workforce(companyId, query);
  }

  // --- RF-111: relatórios contábeis e fiscais -------------------------------

  @Get('accounting')
  @RequirePermissions(PERMISSIONS.REPORTS_READ, PERMISSIONS.ACCOUNTING_REPORTS_READ)
  @ApiOperation({ summary: 'Balancete e DRE do período (RF-111)' })
  accounting(@ActiveCompanyId() companyId: string, @Query() query: ReportFilterDto) {
    return this.statements.accountingStatement(companyId, query);
  }

  @Get('fiscal')
  @RequirePermissions(PERMISSIONS.REPORTS_READ, PERMISSIONS.FISCAL_REPORTS_READ)
  @ApiOperation({ summary: 'Apuração e livro fiscal do período (RF-111)' })
  fiscal(@ActiveCompanyId() companyId: string, @Query() query: ReportFilterDto) {
    return this.statements.fiscalStatement(companyId, query);
  }

  // --- RF-113: exportação ---------------------------------------------------

  @Post('export')
  @RequirePermissions(PERMISSIONS.REPORTS_EXPORT)
  @ApiOperation({ summary: 'Exportar um relatório em PDF, XLSX ou CSV (RF-113)' })
  async export(
    @ActiveCompanyId() companyId: string,
    @Body() dto: ExportReportDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ) {
    const rendered = await this.reports.export(companyId, dto, user);

    // `attachment`: o conteúdo é dado da empresa e nunca é renderizado no
    // contexto da aplicação. O nome é gerado no servidor, não vem do cliente.
    response.setHeader('Content-Type', rendered.contentType);
    response.setHeader('Content-Disposition', `attachment; filename="${rendered.filename}"`);
    response.send(rendered.content);
  }
}
