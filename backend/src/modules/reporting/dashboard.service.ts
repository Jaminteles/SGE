import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatDateOnly, toDateOnly } from '../../common/utils/date-only';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportFilterDto } from './dto/report-filter.dto';
import { MAX_REPORT_ROWS } from './report.constants';

const ZERO = new Prisma.Decimal(0);

interface PortfolioRow {
  tipo: string;
  faixa_atraso: string;
  competencia: Date;
  parcelas: number;
  saldo: Prisma.Decimal;
  encargos: Prisma.Decimal;
  valor_atualizado: Prisma.Decimal;
}

interface RealizedRow {
  tipo: string;
  competencia: Date;
  baixas: number;
  valor_principal: Prisma.Decimal;
  valor_juros: Prisma.Decimal;
  valor_multa: Prisma.Decimal;
  valor_desconto: Prisma.Decimal;
  valor_total: Prisma.Decimal;
}

interface DailyCashRow {
  data_referencia: Date;
  situacao: string;
  entradas: Prisma.Decimal;
  saidas: Prisma.Decimal;
  movimentos: number;
}

interface IncomeRow {
  competencia: Date;
  tipo: string;
  codigo: string;
  nome: string;
  valor: Prisma.Decimal;
}

interface PurchaseRow {
  competencia: Date;
  status: string;
  pedidos: number;
  valor_produtos: Prisma.Decimal;
  valor_frete: Prisma.Decimal;
  valor_total: Prisma.Decimal;
}

interface SupplierRow {
  parceiro_id: string;
  parceiro_nome: string;
  pedidos: number;
  valor_total: Prisma.Decimal;
  recebimentos: number;
  recebimentos_divergentes: number;
  prazo_medio_dias: Prisma.Decimal | null;
  maior_atraso_entrega: number | null;
}

interface StockRow {
  local_estoque_id: string;
  local_nome: string;
  categoria_produto_id: string | null;
  itens: number;
  quantidade: Prisma.Decimal;
  valor_total: Prisma.Decimal;
  itens_abaixo_minimo: number;
}

interface HeadcountRow {
  departamento_id: string | null;
  departamento_nome: string | null;
  cargo_id: string | null;
  centro_custo_id: string | null;
  status: string;
  funcionarios: number;
  funcionarios_com_salario: number;
  salario_base_total: Prisma.Decimal;
}

interface HeadcountMovementRow {
  competencia: Date;
  departamento_id: string | null;
  admissoes: number;
  desligamentos: number;
}

interface CostCenterRow {
  competencia: Date;
  centro_custo_id: string | null;
  centro_custo_nome: string | null;
  tipo: string;
  valor_provisionado: Prisma.Decimal;
  valor_realizado: Prisma.Decimal;
}

/**
 * Painéis gerenciais (RF-106 a RF-110, RF-112).
 *
 * Cinco leituras sobre as views de bd/19, e nenhuma regra de negócio nova: o
 * dashboard não decide o que é atraso, o que é caixa realizado ou o que entra na
 * apuração — quem decide isso é o módulo dono do dado, e a view é onde essa
 * decisão já mora. Um painel que recalcula por conta própria é um painel que
 * começa a discordar do sistema no mês seguinte.
 *
 * Duas distinções atravessam todas as consultas:
 *
 *  1. **posição não tem período**. Carteira em aberto, estoque valorizado e
 *     quadro de pessoal são fotos do agora; filtrá-los por `from`/`to` daria um
 *     saldo de estoque "de janeiro" que não existe. Onde o período se aplica —
 *     vencimento, baixa, pedido, admissão — ele é aplicado e dito no retorno;
 *  2. **previsto não é realizado**. As duas metades sobem em campos separados;
 *     somá-las produziria um caixa que ainda não aconteceu.
 *
 * O isolamento é da RLS: as views de bd/19 têm `security_invoker`, e a sessão
 * traz `app.empresa_id`. O `empresa_id` no `WHERE` é defesa em profundidade —
 * sem a RLS ele sozinho não bastaria, e com ela nenhum filtro do cliente pode
 * alcançar outra empresa. Todo filtro entra como parâmetro do template do
 * Prisma; nada de query é concatenado em SQL.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Visão financeira consolidada: carteira, realizado e resultado (RF-106). */
  async financial(companyId: string, filter: ReportFilterDto) {
    const { from, to } = this.range(filter);
    const [portfolio, realized] = await Promise.all([
      this.portfolioRows(companyId, filter, null),
      this.realizedRows(companyId, filter, from, to),
    ]);

    const openByType = this.sumBy(portfolio, (row) => row.tipo, 'valor_atualizado');
    const overdue = this.sumBy(
      portfolio.filter((row) => row.faixa_atraso !== 'A_VENCER'),
      (row) => row.tipo,
      'valor_atualizado',
    );
    const realizedByType = this.sumBy(realized, (row) => row.tipo, 'valor_total');

    const inflow = realizedByType.RECEBER ?? ZERO;
    const outflow = realizedByType.PAGAR ?? ZERO;

    return {
      period: { from: formatDateOnly(from), to: formatDateOnly(to) },
      openPortfolio: {
        receivable: openByType.RECEBER ?? ZERO,
        payable: openByType.PAGAR ?? ZERO,
        overdueReceivable: overdue.RECEBER ?? ZERO,
        overduePayable: overdue.PAGAR ?? ZERO,
        installments: portfolio.reduce((total, row) => total + row.parcelas, 0),
      },
      realized: {
        inflow,
        outflow,
        net: inflow.minus(outflow),
        settlements: realized.reduce((total, row) => total + row.baixas, 0),
        interest: this.sum(realized, 'valor_juros').plus(this.sum(realized, 'valor_multa')),
        discount: this.sum(realized, 'valor_desconto'),
      },
      byMonth: this.groupMonths(realized),
    };
  }

  /**
   * Contas a pagar e a receber (RF-107).
   *
   * O recorte é por **vencimento**: "o que vence em março" é a pergunta que a
   * tela faz. O aging vem junto e sobre a carteira inteira, não só sobre a
   * janela — atraso de 120 dias não deixa de existir porque o filtro é do mês
   * que vem, e é exatamente o número que precisa aparecer.
   */
  async portfolio(companyId: string, filter: ReportFilterDto) {
    const { from, to } = this.range(filter);
    const [window, everything] = await Promise.all([
      this.portfolioRows(companyId, filter, { from, to }),
      this.portfolioRows(companyId, filter, null),
    ]);

    return {
      period: { from: formatDateOnly(from), to: formatDateOnly(to) },
      dueInPeriod: window.map((row) => ({
        type: row.tipo,
        agingBand: row.faixa_atraso,
        competence: formatDateOnly(row.competencia),
        installments: row.parcelas,
        balance: row.saldo,
        charges: row.encargos,
        updatedAmount: row.valor_atualizado,
      })),
      aging: this.aging(everything),
      totals: {
        receivable: this.sumBy(window, (row) => row.tipo, 'valor_atualizado').RECEBER ?? ZERO,
        payable: this.sumBy(window, (row) => row.tipo, 'valor_atualizado').PAGAR ?? ZERO,
      },
    };
  }

  /**
   * Fluxo de caixa e resultado (RF-108).
   *
   * O caixa vem de `vw_fluxo_caixa_diario` (bd/10) com `cenario_id IS NULL`:
   * cenário é hipótese digitada, e hipótese no painel do mês vira compromisso
   * na cabeça de quem lê. O resultado vem da DRE contábil (bd/17), que é o
   * regime de competência — as duas respostas convivem porque são perguntas
   * diferentes, e o retorno as mantém separadas.
   */
  async cashFlow(companyId: string, filter: ReportFilterDto) {
    const { from, to } = this.range(filter);
    const scope = this.scope(companyId, filter, { branch: true, category: true, costCenter: true });

    const daily = await this.prisma.db.$queryRaw<DailyCashRow[]>`
      SELECT f.data_referencia,
             f.situacao::text          AS situacao,
             sum(f.entradas)           AS entradas,
             sum(f.saidas)             AS saidas,
             sum(f.movimentos)::int    AS movimentos
        FROM vw_fluxo_caixa_diario f
       WHERE ${Prisma.join(
         [
           ...scope,
           Prisma.sql`f.cenario_id IS NULL`,
           Prisma.sql`f.data_referencia BETWEEN ${formatDateOnly(from)}::date AND ${formatDateOnly(to)}::date`,
         ],
         ' AND ',
       )}
       GROUP BY f.data_referencia, f.situacao
       ORDER BY f.data_referencia
       LIMIT ${MAX_REPORT_ROWS}
    `;

    const income = await this.prisma.db.$queryRaw<IncomeRow[]>`
      SELECT d.competencia, d.tipo::text AS tipo, d.codigo, d.nome, sum(d.valor) AS valor
        FROM vw_dre d
       WHERE d.empresa_id = ${companyId}::uuid
         AND d.competencia BETWEEN date_trunc('month', ${formatDateOnly(from)}::date)::date
                               AND date_trunc('month', ${formatDateOnly(to)}::date)::date
       GROUP BY d.competencia, d.tipo, d.codigo, d.nome
       ORDER BY d.competencia, d.codigo
       LIMIT ${MAX_REPORT_ROWS}
    `;

    const revenue = this.sumWhere(income, (row) => row.tipo === 'RECEITA');
    const expense = this.sumWhere(income, (row) => row.tipo !== 'RECEITA');

    return {
      period: { from: formatDateOnly(from), to: formatDateOnly(to) },
      cash: {
        days: daily.map((row) => ({
          date: formatDateOnly(row.data_referencia),
          status: row.situacao,
          inflow: row.entradas,
          outflow: row.saidas,
          movements: row.movimentos,
        })),
        totals: this.cashTotals(daily),
      },
      result: {
        lines: income.map((row) => ({
          competence: formatDateOnly(row.competencia),
          type: row.tipo,
          accountCode: row.codigo,
          accountName: row.nome,
          amount: row.valor,
        })),
        revenue,
        expense,
        net: revenue.minus(expense),
      },
    };
  }

  /** Compras, fornecedores e estoque (RF-109). */
  async purchasing(companyId: string, filter: ReportFilterDto) {
    const { from, to } = this.range(filter);
    const period = Prisma.sql`c.competencia BETWEEN date_trunc('month', ${formatDateOnly(from)}::date)::date
                                               AND date_trunc('month', ${formatDateOnly(to)}::date)::date`;

    const orders = await this.prisma.db.$queryRaw<PurchaseRow[]>`
      SELECT c.competencia,
             c.status::text          AS status,
             sum(c.pedidos)::int     AS pedidos,
             sum(c.valor_produtos)   AS valor_produtos,
             sum(c.valor_frete)      AS valor_frete,
             sum(c.valor_total)      AS valor_total
        FROM vw_indicador_compras c
       WHERE ${Prisma.join(
         [
           Prisma.sql`c.empresa_id = ${companyId}::uuid`,
           period,
           ...(filter.branchId ? [Prisma.sql`c.filial_id = ${filter.branchId}::uuid`] : []),
           ...(filter.costCenterId
             ? [Prisma.sql`c.centro_custo_id = ${filter.costCenterId}::uuid`]
             : []),
           ...(filter.categoryId
             ? [Prisma.sql`c.categoria_financeira_id = ${filter.categoryId}::uuid`]
             : []),
           ...(filter.partnerId ? [Prisma.sql`c.parceiro_id = ${filter.partnerId}::uuid`] : []),
         ],
         ' AND ',
       )}
       GROUP BY c.competencia, c.status
       ORDER BY c.competencia, c.status
       LIMIT ${MAX_REPORT_ROWS}
    `;

    const suppliers = await this.prisma.db.$queryRaw<SupplierRow[]>`
      SELECT c.parceiro_id,
             coalesce(p.nome_fantasia, p.razao_social) AS parceiro_nome,
             sum(c.pedidos)::int                   AS pedidos,
             sum(c.valor_total)                    AS valor_total,
             sum(c.recebimentos)::int              AS recebimentos,
             sum(c.recebimentos_divergentes)::int  AS recebimentos_divergentes,
             avg(c.prazo_medio_dias)               AS prazo_medio_dias,
             max(c.maior_atraso_entrega)::int      AS maior_atraso_entrega
        FROM vw_indicador_fornecedor c
        JOIN parceiro p ON p.id = c.parceiro_id
       WHERE ${Prisma.join(
         [
           Prisma.sql`c.empresa_id = ${companyId}::uuid`,
           period,
           ...(filter.partnerId ? [Prisma.sql`c.parceiro_id = ${filter.partnerId}::uuid`] : []),
         ],
         ' AND ',
       )}
       GROUP BY c.parceiro_id, p.nome_fantasia, p.razao_social
       ORDER BY sum(c.valor_total) DESC
       LIMIT ${MAX_REPORT_ROWS}
    `;

    const stock = await this.prisma.db.$queryRaw<StockRow[]>`
      SELECT e.local_estoque_id,
             l.nome                          AS local_nome,
             e.categoria_produto_id,
             sum(e.itens)::int               AS itens,
             sum(e.quantidade)               AS quantidade,
             sum(e.valor_total)              AS valor_total,
             sum(e.itens_abaixo_minimo)::int AS itens_abaixo_minimo
        FROM vw_indicador_estoque e
        JOIN local_estoque l ON l.id = e.local_estoque_id
       WHERE ${Prisma.join(
         [
           Prisma.sql`e.empresa_id = ${companyId}::uuid`,
           ...(filter.branchId ? [Prisma.sql`e.filial_id = ${filter.branchId}::uuid`] : []),
         ],
         ' AND ',
       )}
       GROUP BY e.local_estoque_id, l.nome, e.categoria_produto_id
       ORDER BY sum(e.valor_total) DESC
       LIMIT ${MAX_REPORT_ROWS}
    `;

    return {
      period: { from: formatDateOnly(from), to: formatDateOnly(to) },
      orders: orders.map((row) => ({
        competence: formatDateOnly(row.competencia),
        status: row.status,
        orders: row.pedidos,
        productsAmount: row.valor_produtos,
        freightAmount: row.valor_frete,
        totalAmount: row.valor_total,
      })),
      suppliers: suppliers.map((row) => ({
        partnerId: row.parceiro_id,
        partnerName: row.parceiro_nome,
        orders: row.pedidos,
        totalAmount: row.valor_total,
        receipts: row.recebimentos,
        divergentReceipts: row.recebimentos_divergentes,
        averageLeadTimeDays: row.prazo_medio_dias,
        worstDeliveryDelayDays: row.maior_atraso_entrega,
      })),
      // Posição, e por isso sem período: estoque é o saldo de agora.
      stock: stock.map((row) => ({
        locationId: row.local_estoque_id,
        locationName: row.local_nome,
        productCategoryId: row.categoria_produto_id,
        items: row.itens,
        quantity: row.quantidade,
        totalAmount: row.valor_total,
        itemsBelowMinimum: row.itens_abaixo_minimo,
      })),
      totals: {
        purchased: this.sum(orders, 'valor_total'),
        stockValue: this.sum(stock, 'valor_total'),
        itemsBelowMinimum: stock.reduce((total, row) => total + row.itens_abaixo_minimo, 0),
      },
    };
  }

  /** Funcionários e centros de custo (RF-110). */
  async workforce(companyId: string, filter: ReportFilterDto) {
    const { from, to } = this.range(filter);
    const competence = (alias: string) =>
      Prisma.sql`${Prisma.raw(alias)}.competencia BETWEEN date_trunc('month', ${formatDateOnly(from)}::date)::date
                                                      AND date_trunc('month', ${formatDateOnly(to)}::date)::date`;

    const headcount = await this.prisma.db.$queryRaw<HeadcountRow[]>`
      SELECT q.departamento_id,
             d.nome                            AS departamento_nome,
             q.cargo_id,
             q.centro_custo_id,
             q.status::text                    AS status,
             sum(q.funcionarios)::int          AS funcionarios,
             sum(q.funcionarios_com_salario)::int AS funcionarios_com_salario,
             sum(q.salario_base_total)         AS salario_base_total
        FROM vw_indicador_quadro q
        LEFT JOIN departamento d ON d.id = q.departamento_id
       WHERE ${Prisma.join(
         [
           Prisma.sql`q.empresa_id = ${companyId}::uuid`,
           ...(filter.branchId ? [Prisma.sql`q.filial_id = ${filter.branchId}::uuid`] : []),
           ...(filter.costCenterId
             ? [Prisma.sql`q.centro_custo_id = ${filter.costCenterId}::uuid`]
             : []),
         ],
         ' AND ',
       )}
       GROUP BY q.departamento_id, d.nome, q.cargo_id, q.centro_custo_id, q.status
       ORDER BY d.nome NULLS LAST
       LIMIT ${MAX_REPORT_ROWS}
    `;

    const movement = await this.prisma.db.$queryRaw<HeadcountMovementRow[]>`
      SELECT m.competencia,
             m.departamento_id,
             sum(m.admissoes)::int     AS admissoes,
             sum(m.desligamentos)::int AS desligamentos
        FROM vw_indicador_quadro_movimento m
       WHERE ${Prisma.join(
         [
           Prisma.sql`m.empresa_id = ${companyId}::uuid`,
           competence('m'),
           ...(filter.branchId ? [Prisma.sql`m.filial_id = ${filter.branchId}::uuid`] : []),
           ...(filter.costCenterId
             ? [Prisma.sql`m.centro_custo_id = ${filter.costCenterId}::uuid`]
             : []),
         ],
         ' AND ',
       )}
       GROUP BY m.competencia, m.departamento_id
       ORDER BY m.competencia
       LIMIT ${MAX_REPORT_ROWS}
    `;

    const costCenters = await this.prisma.db.$queryRaw<CostCenterRow[]>`
      SELECT c.competencia,
             c.centro_custo_id,
             cc.nome                     AS centro_custo_nome,
             c.tipo::text                AS tipo,
             sum(c.valor_provisionado)   AS valor_provisionado,
             sum(c.valor_realizado)      AS valor_realizado
        FROM vw_indicador_centro_custo c
        LEFT JOIN centro_custo cc ON cc.id = c.centro_custo_id
       WHERE ${Prisma.join(
         [
           Prisma.sql`c.empresa_id = ${companyId}::uuid`,
           competence('c'),
           ...(filter.branchId ? [Prisma.sql`c.filial_id = ${filter.branchId}::uuid`] : []),
           ...(filter.costCenterId
             ? [Prisma.sql`c.centro_custo_id = ${filter.costCenterId}::uuid`]
             : []),
         ],
         ' AND ',
       )}
       GROUP BY c.competencia, c.centro_custo_id, cc.nome, c.tipo
       ORDER BY c.competencia, cc.nome NULLS LAST
       LIMIT ${MAX_REPORT_ROWS}
    `;

    const active = headcount.filter((row) => row.status === 'ATIVO');

    return {
      period: { from: formatDateOnly(from), to: formatDateOnly(to) },
      // Posição: quadro é quem está na empresa hoje, não no período filtrado.
      headcount: headcount.map((row) => ({
        departmentId: row.departamento_id,
        departmentName: row.departamento_nome,
        positionId: row.cargo_id,
        costCenterId: row.centro_custo_id,
        status: row.status,
        employees: row.funcionarios,
        employeesWithSalary: row.funcionarios_com_salario,
        baseSalaryTotal: row.salario_base_total,
      })),
      movement: movement.map((row) => ({
        competence: formatDateOnly(row.competencia),
        departmentId: row.departamento_id,
        hires: row.admissoes,
        terminations: row.desligamentos,
      })),
      costCenters: costCenters.map((row) => ({
        competence: formatDateOnly(row.competencia),
        costCenterId: row.centro_custo_id,
        costCenterName: row.centro_custo_nome,
        type: row.tipo,
        budgetedAmount: row.valor_provisionado,
        realizedAmount: row.valor_realizado,
      })),
      totals: {
        activeEmployees: active.reduce((total, row) => total + row.funcionarios, 0),
        activeBaseSalary: this.sum(active, 'salario_base_total'),
        hires: movement.reduce((total, row) => total + row.admissoes, 0),
        terminations: movement.reduce((total, row) => total + row.desligamentos, 0),
      },
    };
  }

  // --- consultas compartilhadas ---------------------------------------------

  private portfolioRows(
    companyId: string,
    filter: ReportFilterDto,
    window: { from: Date; to: Date } | null,
  ): Promise<PortfolioRow[]> {
    const conditions = this.scope(companyId, filter, {
      alias: 'c',
      branch: true,
      category: true,
      costCenter: true,
      partner: true,
    });

    if (window) {
      conditions.push(
        Prisma.sql`c.data_vencimento BETWEEN ${formatDateOnly(window.from)}::date AND ${formatDateOnly(window.to)}::date`,
      );
    }

    return this.prisma.db.$queryRaw<PortfolioRow[]>`
      SELECT c.tipo::text          AS tipo,
             c.faixa_atraso,
             c.competencia,
             sum(c.parcelas)::int  AS parcelas,
             sum(c.saldo)          AS saldo,
             sum(c.encargos)       AS encargos,
             sum(c.valor_atualizado) AS valor_atualizado
        FROM vw_indicador_carteira c
       WHERE ${Prisma.join(conditions, ' AND ')}
       GROUP BY c.tipo, c.faixa_atraso, c.competencia
       ORDER BY c.competencia, c.tipo
       LIMIT ${MAX_REPORT_ROWS}
    `;
  }

  private realizedRows(
    companyId: string,
    filter: ReportFilterDto,
    from: Date,
    to: Date,
  ): Promise<RealizedRow[]> {
    const conditions = this.scope(companyId, filter, {
      alias: 'r',
      branch: true,
      category: true,
      costCenter: true,
      partner: true,
      bankAccount: true,
    });

    conditions.push(
      Prisma.sql`r.data_baixa BETWEEN ${formatDateOnly(from)}::date AND ${formatDateOnly(to)}::date`,
    );

    return this.prisma.db.$queryRaw<RealizedRow[]>`
      SELECT r.tipo::text        AS tipo,
             r.competencia,
             sum(r.baixas)::int  AS baixas,
             sum(r.valor_principal) AS valor_principal,
             sum(r.valor_juros)     AS valor_juros,
             sum(r.valor_multa)     AS valor_multa,
             sum(r.valor_desconto)  AS valor_desconto,
             sum(r.valor_total)     AS valor_total
        FROM vw_indicador_realizado r
       WHERE ${Prisma.join(conditions, ' AND ')}
       GROUP BY r.tipo, r.competencia
       ORDER BY r.competencia, r.tipo
       LIMIT ${MAX_REPORT_ROWS}
    `;
  }

  /**
   * Monta o `WHERE` do recorte (RF-112).
   *
   * O alias é escolhido aqui, no código, e nunca vem do cliente: `Prisma.raw` é
   * concatenação literal, e um alias vindo de query seria injeção de SQL. Os
   * valores, esses, entram sempre como parâmetro.
   */
  private scope(
    companyId: string,
    filter: ReportFilterDto,
    options: {
      alias?: string;
      branch?: boolean;
      category?: boolean;
      costCenter?: boolean;
      partner?: boolean;
      bankAccount?: boolean;
    },
  ): Prisma.Sql[] {
    const alias = Prisma.raw(options.alias ?? 'f');
    const conditions: Prisma.Sql[] = [Prisma.sql`${alias}.empresa_id = ${companyId}::uuid`];

    if (options.branch && filter.branchId) {
      conditions.push(Prisma.sql`${alias}.filial_id = ${filter.branchId}::uuid`);
    }
    if (options.category && filter.categoryId) {
      conditions.push(Prisma.sql`${alias}.categoria_financeira_id = ${filter.categoryId}::uuid`);
    }
    if (options.costCenter && filter.costCenterId) {
      conditions.push(Prisma.sql`${alias}.centro_custo_id = ${filter.costCenterId}::uuid`);
    }
    if (options.partner && filter.partnerId) {
      conditions.push(Prisma.sql`${alias}.parceiro_id = ${filter.partnerId}::uuid`);
    }
    if (options.bankAccount && filter.bankAccountId) {
      conditions.push(Prisma.sql`${alias}.conta_bancaria_id = ${filter.bankAccountId}::uuid`);
    }

    return conditions;
  }

  // --- agregações em memória -------------------------------------------------

  private aging(rows: PortfolioRow[]) {
    const bands = ['A_VENCER', 'ATE_30', 'DE_31_A_60', 'DE_61_A_90', 'ACIMA_DE_90'];
    return bands.map((band) => {
      const slice = rows.filter((row) => row.faixa_atraso === band);
      const byType = this.sumBy(slice, (row) => row.tipo, 'valor_atualizado');
      return {
        band,
        installments: slice.reduce((total, row) => total + row.parcelas, 0),
        receivable: byType.RECEBER ?? ZERO,
        payable: byType.PAGAR ?? ZERO,
      };
    });
  }

  private groupMonths(rows: RealizedRow[]) {
    const months = new Map<string, { inflow: Prisma.Decimal; outflow: Prisma.Decimal }>();
    for (const row of rows) {
      const key = formatDateOnly(row.competencia);
      const bucket = months.get(key) ?? { inflow: ZERO, outflow: ZERO };
      if (row.tipo === 'RECEBER') bucket.inflow = bucket.inflow.plus(row.valor_total);
      else bucket.outflow = bucket.outflow.plus(row.valor_total);
      months.set(key, bucket);
    }

    return [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([competence, bucket]) => ({
        competence,
        inflow: bucket.inflow,
        outflow: bucket.outflow,
        net: bucket.inflow.minus(bucket.outflow),
      }));
  }

  private cashTotals(rows: DailyCashRow[]) {
    const byStatus: Record<string, { inflow: Prisma.Decimal; outflow: Prisma.Decimal }> = {};
    for (const row of rows) {
      const bucket = byStatus[row.situacao] ?? { inflow: ZERO, outflow: ZERO };
      bucket.inflow = bucket.inflow.plus(row.entradas);
      bucket.outflow = bucket.outflow.plus(row.saidas);
      byStatus[row.situacao] = bucket;
    }
    return byStatus;
  }

  private sum<T>(rows: T[], key: keyof T): Prisma.Decimal {
    return rows.reduce(
      (total, row) => total.plus((row[key] as Prisma.Decimal | null) ?? ZERO),
      ZERO,
    );
  }

  private sumWhere(rows: IncomeRow[], predicate: (row: IncomeRow) => boolean): Prisma.Decimal {
    return rows.filter(predicate).reduce((total, row) => total.plus(row.valor), ZERO);
  }

  private sumBy<T>(
    rows: T[],
    keyOf: (row: T) => string,
    valueKey: keyof T,
  ): Record<string, Prisma.Decimal> {
    const totals: Record<string, Prisma.Decimal> = {};
    for (const row of rows) {
      const key = keyOf(row);
      totals[key] = (totals[key] ?? ZERO).plus((row[valueKey] as Prisma.Decimal | null) ?? ZERO);
    }
    return totals;
  }

  /** Janela do relatório, validada como dia civil. */
  private range(filter: ReportFilterDto): { from: Date; to: Date } {
    const from = toDateOnly(filter.from);
    const to = toDateOnly(filter.to);
    if (to.getTime() < from.getTime()) {
      throw new BadRequestException('`to` não pode ser anterior a `from`.');
    }
    return { from, to };
  }
}
