import { ForbiddenException, Injectable } from '@nestjs/common';
import { AUDIT_ENTITY, AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { permissionCode } from '../../common/authorization/permission-catalog';
import { ReportExportService } from '../../common/export/report-export.service';
import { RenderedReport, ReportDocument, ReportSection } from '../../common/export/report-document';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardService } from './dashboard.service';
import { ExportReportDto, ReportFilterDto } from './dto/report-filter.dto';
import { REPORT_SOURCE_PERMISSION, REPORT_TITLES, ReportKey } from './report.constants';
import { StatementReportsService } from './statement-reports.service';

/**
 * Montagem e exportação dos relatórios do M15 (RF-111/RF-113).
 *
 * O documento sai das **mesmas** consultas que alimentam os painéis. É o que
 * garante que o PDF entregue na reunião e a tela aberta na mesma hora mostrem o
 * mesmo número — uma segunda consulta "otimizada para exportar" é como as duas
 * versões começam a divergir.
 *
 * A exportação é auditada: ela tira dado da empresa de dentro do sistema, e a
 * trilha precisa dizer quem tirou, o quê e sob que recorte. O conteúdo do
 * arquivo não vai para a trilha — auditar o relatório inteiro seria guardar uma
 * segunda cópia do dado no lugar mais difícil de expurgar.
 */
@Injectable()
export class ReportGenerationService {
  constructor(
    private readonly dashboards: DashboardService,
    private readonly statements: StatementReportsService,
    private readonly exporter: ReportExportService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async export(
    companyId: string,
    dto: ExportReportDto,
    user: AuthenticatedUser,
  ): Promise<RenderedReport> {
    await this.assertSourcePermission(companyId, user, dto.report);

    const document = await this.build(companyId, dto.report, dto);
    const rendered = this.exporter.render(document, dto.format);

    await this.audit.record({
      event: 'EXPORTACAO',
      entity: AUDIT_ENTITY.REPORT,
      userId: user.id,
      note:
        `Exportação do relatório "${dto.report}" em ${dto.format} ` +
        `(${dto.from}..${dto.to}); ${document.sections.reduce((total, section) => total + section.rows.length, 0)} linhas.`,
    });

    return rendered;
  }

  /**
   * Exige a permissão do módulo de origem antes de exportar (RF-111).
   *
   * A rota de exportação recebe o relatório no corpo, e o guard decide pela
   * rota — então `reports:EXPORT` sozinho abriria o balancete e a apuração
   * fiscal para quem tem permissão de exportar qualquer coisa. A verificação
   * precisa acontecer depois de conhecer o relatório pedido, e é aqui.
   *
   * Super admin passa direto, como no guard: é o mesmo critério, e divergir
   * dele criaria uma rota em que o administrador de plataforma é mais restrito
   * que um usuário comum.
   */
  private async assertSourcePermission(
    companyId: string,
    user: AuthenticatedUser,
    report: ReportKey,
  ): Promise<void> {
    const required = REPORT_SOURCE_PERMISSION[report];
    if (!required || user.isSuperAdmin) return;

    const membership = await this.prisma.db.membership.findFirst({
      where: { userId: user.id, companyId, isActive: true },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    const granted = new Set(
      membership?.role.permissions.map((link) =>
        permissionCode(link.permission.resource, link.permission.action),
      ) ?? [],
    );

    if (!granted.has(required)) {
      throw new ForbiddenException(`Permissão insuficiente: ${required}.`);
    }
  }

  /** Monta o documento de um relatório do catálogo (RF-111/RF-113). */
  async build(
    companyId: string,
    report: ReportKey,
    filter: ReportFilterDto,
  ): Promise<ReportDocument> {
    const base = {
      title: `${REPORT_TITLES[report]} ${filter.from} a ${filter.to}`,
      subtitle: REPORT_TITLES[report],
      filters: this.describeFilters(filter),
      generatedAt: new Date(),
    };

    return { ...base, sections: await this.sections(companyId, report, filter) };
  }

  private async sections(
    companyId: string,
    report: ReportKey,
    filter: ReportFilterDto,
  ): Promise<ReportSection[]> {
    switch (report) {
      case 'financeiro':
        return this.financialSections(companyId, filter);
      case 'carteira':
        return this.portfolioSections(companyId, filter);
      case 'fluxo-caixa':
        return this.cashFlowSections(companyId, filter);
      case 'compras-estoque':
        return this.purchasingSections(companyId, filter);
      case 'pessoal':
        return this.workforceSections(companyId, filter);
      case 'contabil':
        return this.accountingSections(companyId, filter);
      case 'fiscal':
        return this.fiscalSections(companyId, filter);
    }
  }

  private async financialSections(
    companyId: string,
    filter: ReportFilterDto,
  ): Promise<ReportSection[]> {
    const data = await this.dashboards.financial(companyId, filter);

    return [
      {
        title: 'Resumo financeiro',
        columns: [
          { key: 'indicador', label: 'Indicador' },
          { key: 'valor', label: 'Valor', numeric: true },
        ],
        rows: [
          { indicador: 'A receber em aberto', valor: data.openPortfolio.receivable },
          { indicador: 'A pagar em aberto', valor: data.openPortfolio.payable },
          { indicador: 'A receber vencido', valor: data.openPortfolio.overdueReceivable },
          { indicador: 'A pagar vencido', valor: data.openPortfolio.overduePayable },
          { indicador: 'Recebido no período', valor: data.realized.inflow },
          { indicador: 'Pago no período', valor: data.realized.outflow },
          { indicador: 'Saldo do período', valor: data.realized.net },
          { indicador: 'Juros e multa recebidos', valor: data.realized.interest },
          { indicador: 'Descontos concedidos', valor: data.realized.discount },
        ],
      },
      {
        title: 'Realizado por competência',
        columns: [
          { key: 'competence', label: 'Competência' },
          { key: 'inflow', label: 'Entradas', numeric: true },
          { key: 'outflow', label: 'Saídas', numeric: true },
          { key: 'net', label: 'Saldo', numeric: true },
        ],
        rows: data.byMonth,
      },
    ];
  }

  private async portfolioSections(
    companyId: string,
    filter: ReportFilterDto,
  ): Promise<ReportSection[]> {
    const data = await this.dashboards.portfolio(companyId, filter);

    return [
      {
        title: 'Vencimentos no período',
        columns: [
          { key: 'competence', label: 'Competência' },
          { key: 'type', label: 'Tipo' },
          { key: 'agingBand', label: 'Faixa' },
          { key: 'installments', label: 'Parcelas', numeric: true },
          { key: 'balance', label: 'Saldo', numeric: true },
          { key: 'charges', label: 'Encargos', numeric: true },
          { key: 'updatedAmount', label: 'Atualizado', numeric: true },
        ],
        rows: data.dueInPeriod,
      },
      {
        title: 'Aging da carteira',
        columns: [
          { key: 'band', label: 'Faixa' },
          { key: 'installments', label: 'Parcelas', numeric: true },
          { key: 'receivable', label: 'A receber', numeric: true },
          { key: 'payable', label: 'A pagar', numeric: true },
        ],
        rows: data.aging,
      },
    ];
  }

  private async cashFlowSections(
    companyId: string,
    filter: ReportFilterDto,
  ): Promise<ReportSection[]> {
    const data = await this.dashboards.cashFlow(companyId, filter);

    return [
      {
        title: 'Fluxo de caixa diário',
        columns: [
          { key: 'date', label: 'Data' },
          { key: 'status', label: 'Situação' },
          { key: 'inflow', label: 'Entradas', numeric: true },
          { key: 'outflow', label: 'Saídas', numeric: true },
          { key: 'movements', label: 'Movimentos', numeric: true },
        ],
        rows: data.cash.days,
      },
      {
        title: 'Resultado por conta (DRE)',
        columns: [
          { key: 'competence', label: 'Competência' },
          { key: 'accountCode', label: 'Conta' },
          { key: 'accountName', label: 'Descrição' },
          { key: 'type', label: 'Tipo' },
          { key: 'amount', label: 'Valor', numeric: true },
        ],
        rows: data.result.lines,
        totals: { amount: data.result.net },
      },
    ];
  }

  private async purchasingSections(
    companyId: string,
    filter: ReportFilterDto,
  ): Promise<ReportSection[]> {
    const data = await this.dashboards.purchasing(companyId, filter);

    return [
      {
        title: 'Compras por competência',
        columns: [
          { key: 'competence', label: 'Competência' },
          { key: 'status', label: 'Situação' },
          { key: 'orders', label: 'Pedidos', numeric: true },
          { key: 'productsAmount', label: 'Produtos', numeric: true },
          { key: 'freightAmount', label: 'Frete', numeric: true },
          { key: 'totalAmount', label: 'Total', numeric: true },
        ],
        rows: data.orders,
        totals: { totalAmount: data.totals.purchased },
      },
      {
        title: 'Fornecedores',
        columns: [
          { key: 'partnerName', label: 'Fornecedor' },
          { key: 'orders', label: 'Pedidos', numeric: true },
          { key: 'totalAmount', label: 'Comprado', numeric: true },
          { key: 'receipts', label: 'Recebimentos', numeric: true },
          { key: 'divergentReceipts', label: 'Divergentes', numeric: true },
          { key: 'averageLeadTimeDays', label: 'Prazo médio (d)', numeric: true },
          { key: 'worstDeliveryDelayDays', label: 'Pior atraso (d)', numeric: true },
        ],
        rows: data.suppliers,
      },
      {
        title: 'Estoque valorizado (posição atual)',
        columns: [
          { key: 'locationName', label: 'Local' },
          { key: 'items', label: 'Itens', numeric: true },
          { key: 'quantity', label: 'Quantidade', numeric: true },
          { key: 'totalAmount', label: 'Valor', numeric: true },
          { key: 'itemsBelowMinimum', label: 'Abaixo do mínimo', numeric: true },
        ],
        rows: data.stock,
        totals: {
          totalAmount: data.totals.stockValue,
          itemsBelowMinimum: data.totals.itemsBelowMinimum,
        },
      },
    ];
  }

  private async workforceSections(
    companyId: string,
    filter: ReportFilterDto,
  ): Promise<ReportSection[]> {
    const data = await this.dashboards.workforce(companyId, filter);

    return [
      {
        title: 'Quadro de pessoal (posição atual)',
        columns: [
          { key: 'departmentName', label: 'Departamento' },
          { key: 'status', label: 'Situação' },
          { key: 'employees', label: 'Funcionários', numeric: true },
          { key: 'employeesWithSalary', label: 'Com salário', numeric: true },
          { key: 'baseSalaryTotal', label: 'Salário base', numeric: true },
        ],
        rows: data.headcount,
        totals: { baseSalaryTotal: data.totals.activeBaseSalary },
      },
      {
        title: 'Movimentação de pessoal',
        columns: [
          { key: 'competence', label: 'Competência' },
          { key: 'hires', label: 'Admissões', numeric: true },
          { key: 'terminations', label: 'Desligamentos', numeric: true },
        ],
        rows: data.movement,
        totals: { hires: data.totals.hires, terminations: data.totals.terminations },
      },
      {
        title: 'Centros de custo',
        columns: [
          { key: 'competence', label: 'Competência' },
          { key: 'costCenterName', label: 'Centro de custo' },
          { key: 'type', label: 'Tipo' },
          { key: 'budgetedAmount', label: 'Provisionado', numeric: true },
          { key: 'realizedAmount', label: 'Realizado', numeric: true },
        ],
        rows: data.costCenters,
      },
    ];
  }

  private async accountingSections(
    companyId: string,
    filter: ReportFilterDto,
  ): Promise<ReportSection[]> {
    const data = await this.statements.accountingStatement(companyId, filter);

    return [
      {
        title: 'Balancete de verificação',
        columns: [
          { key: 'code', label: 'Conta' },
          { key: 'name', label: 'Descrição' },
          { key: 'openingBalance', label: 'Saldo anterior', numeric: true },
          { key: 'debit', label: 'Débito', numeric: true },
          { key: 'credit', label: 'Crédito', numeric: true },
          { key: 'closingBalance', label: 'Saldo', numeric: true },
        ],
        rows: data.trialBalance.rows.map((row) => ({
          code: row.code,
          name: row.name,
          openingBalance: row.openingBalance,
          debit: row.debit,
          credit: row.credit,
          closingBalance: row.closingBalance,
        })),
        totals: {
          debit: data.trialBalance.totalDebit,
          credit: data.trialBalance.totalCredit,
        },
      },
      {
        title: 'Demonstração do resultado',
        columns: [
          { key: 'code', label: 'Conta' },
          { key: 'name', label: 'Descrição' },
          { key: 'type', label: 'Tipo' },
          { key: 'amount', label: 'Valor', numeric: true },
        ],
        rows: [
          ...data.incomeStatement.revenue.lines,
          ...data.incomeStatement.cost.lines,
          ...data.incomeStatement.expense.lines,
        ].map((line) => ({
          code: line.code,
          name: line.name,
          type: line.type,
          amount: line.amount,
        })),
        totals: { amount: data.incomeStatement.netResult },
      },
    ];
  }

  private async fiscalSections(
    companyId: string,
    filter: ReportFilterDto,
  ): Promise<ReportSection[]> {
    const data = await this.statements.fiscalStatement(companyId, filter);

    return [
      {
        title: 'Apuração fiscal',
        columns: [
          { key: 'competence', label: 'Competência' },
          { key: 'direction', label: 'Sentido' },
          { key: 'model', label: 'Modelo' },
          { key: 'documents', label: 'Documentos', numeric: true },
          { key: 'totalAmount', label: 'Total', numeric: true },
          { key: 'icmsAmount', label: 'ICMS', numeric: true },
          { key: 'ipiAmount', label: 'IPI', numeric: true },
          { key: 'pisAmount', label: 'PIS', numeric: true },
          { key: 'cofinsAmount', label: 'COFINS', numeric: true },
          { key: 'issAmount', label: 'ISS', numeric: true },
        ],
        rows: data.assessment.rows,
      },
      {
        title: 'Livro fiscal por CFOP',
        columns: [
          { key: 'competence', label: 'Competência' },
          { key: 'direction', label: 'Sentido' },
          { key: 'cfop', label: 'CFOP' },
          { key: 'ncm', label: 'NCM' },
          { key: 'items', label: 'Itens', numeric: true },
          { key: 'totalAmount', label: 'Total', numeric: true },
          { key: 'icmsBase', label: 'Base ICMS', numeric: true },
          { key: 'icmsAmount', label: 'ICMS', numeric: true },
        ],
        rows: data.ledger.rows,
      },
    ];
  }

  /**
   * Descreve o recorte no cabeçalho do documento.
   *
   * Só ids: resolver o nome de cada filtro custaria uma consulta por dimensão
   * para uma linha de cabeçalho. O que importa aqui é que o relatório impresso
   * não seja confundido com o total da empresa — e para isso basta dizer que
   * havia filtro, e qual.
   */
  private describeFilters(filter: ReportFilterDto): { label: string; value: string }[] {
    const filters = [{ label: 'Período', value: `${filter.from} a ${filter.to}` }];
    const optional: [string, string | undefined][] = [
      ['Filial', filter.branchId],
      ['Categoria', filter.categoryId],
      ['Centro de custo', filter.costCenterId],
      ['Conta bancária', filter.bankAccountId],
      ['Parceiro', filter.partnerId],
    ];

    for (const [label, value] of optional) {
      if (value) filters.push({ label, value });
    }

    return filters;
  }
}
