import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Realization } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { formatDateOnly, toDateOnly } from '../../common/utils/date-only';
import { QueryCashFlowDto } from './dto/query-cash-flow.dto';
import { CashFlowGranularity, QueryProjectionDto } from './dto/query-projection.dto';
import { ScenariosService, ScenarioAssumptions } from './scenarios.service';

/** Janela padrão quando a consulta não informa período. */
const DEFAULT_WINDOW_DAYS = 90;
/** Teto de períodos por resposta — 2 anos em dias, 10 anos em meses. */
const MAX_BUCKETS = 730;

/** Situações na ordem em que a leitura faz sentido: o que foi, o que atrasou, o que vem. */
const SITUATIONS: Realization[] = [
  Realization.REALIZADO,
  Realization.VENCIDO,
  Realization.PREVISTO,
];

/** date_trunc e passo de cada grão (RF-102). Lista fechada: entra em SQL. */
const GRANULARITY: Record<CashFlowGranularity, { unit: string; step: string }> = {
  [CashFlowGranularity.DIA]: { unit: 'day', step: '1 day' },
  [CashFlowGranularity.SEMANA]: { unit: 'week', step: '7 days' },
  [CashFlowGranularity.MES]: { unit: 'month', step: '1 month' },
};

interface SituationRow {
  situacao: Realization;
  entradas: Prisma.Decimal;
  saidas: Prisma.Decimal;
  movimentos: bigint;
}

interface CategoryRow {
  categoria_financeira_id: string | null;
  categoria_codigo: string | null;
  categoria_nome: string | null;
  entradas: Prisma.Decimal;
  saidas: Prisma.Decimal;
}

interface BucketRow {
  periodo: Date;
  entradas_realizadas: Prisma.Decimal;
  entradas_previstas: Prisma.Decimal;
  entradas_vencidas: Prisma.Decimal;
  saidas_realizadas: Prisma.Decimal;
  saidas_previstas: Prisma.Decimal;
  saidas_vencidas: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Fluxo de caixa consolidado e projetado (RF-101 a RF-103).
 *
 * Nada aqui é gravado: as duas leituras são agregações de `vw_fluxo_caixa`
 * (bd/10), que por sua vez projeta títulos e baixas. "Quanto entra em novembro"
 * muda a cada baixa registrada — um número gravado ontem estaria errado hoje
 * sem que ninguém tivesse errado nada.
 *
 * A divisão entre os dois métodos é a divisão entre duas perguntas: `summary`
 * responde "o que aconteceu e o que está em aberto neste período" (aceita
 * passado); `projection` responde "como fica o saldo daqui para a frente" — e
 * por isso exige janela futura, porque o saldo acumulado parte do caixa de
 * hoje, que já contém tudo o que foi realizado antes.
 */
@Injectable()
export class CashFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scenarios: ScenariosService,
  ) {}

  /** Consolidação por situação e por categoria no período (RF-101/RF-103). */
  async summary(companyId: string, query: QueryCashFlowDto) {
    const { from, to } = this.resolveWindow(query);
    const filters = this.buildFilters(companyId, from, to, query);

    const rows = await this.prisma.db.$queryRaw<SituationRow[]>`
      SELECT f.situacao,
             sum(f.entradas)   AS entradas,
             sum(f.saidas)     AS saidas,
             sum(f.movimentos) AS movimentos
        FROM vw_fluxo_caixa_diario f
       WHERE ${filters}
       GROUP BY f.situacao
    `;

    const categories = await this.prisma.db.$queryRaw<CategoryRow[]>`
      SELECT f.categoria_financeira_id,
             c.codigo        AS categoria_codigo,
             c.nome          AS categoria_nome,
             sum(f.entradas) AS entradas,
             sum(f.saidas)   AS saidas
        FROM vw_fluxo_caixa_diario f
        LEFT JOIN categoria_financeira c ON c.id = f.categoria_financeira_id
       WHERE ${filters}
       GROUP BY f.categoria_financeira_id, c.codigo, c.nome
       ORDER BY sum(f.entradas) + sum(f.saidas) DESC
    `;

    const bySituation = new Map(rows.map((row) => [row.situacao, row]));

    return {
      period: { from: formatDateOnly(from), to: formatDateOnly(to) },
      // Situações sem movimento aparecem zeradas: uma situação ausente lê-se
      // como "não consultei", e zerada, como "não há" — que é a informação.
      bySituation: SITUATIONS.map((situation) => {
        const row = bySituation.get(situation);
        const inflow = row?.entradas ?? ZERO;
        const outflow = row?.saidas ?? ZERO;
        return {
          situation,
          inflow,
          outflow,
          net: inflow.minus(outflow),
          movements: Number(row?.movimentos ?? 0),
        };
      }),
      totals: this.totals(rows),
      byCategory: categories.map((row) => ({
        category: row.categoria_financeira_id
          ? {
              id: row.categoria_financeira_id,
              code: row.categoria_codigo,
              name: row.categoria_nome,
            }
          : null,
        inflow: row.entradas,
        outflow: row.saidas,
        net: row.entradas.minus(row.saidas),
      })),
    };
  }

  /**
   * Série por período com saldo acumulado (RF-102), opcionalmente sob um
   * cenário (RF-104).
   *
   * Sem cenário, o ponto de partida é o caixa de hoje e a janela precisa começar
   * hoje ou depois: somar de novo o realizado de agosto sobre um saldo que já o
   * contém produziria um saldo projetado errado, e errado para mais.
   *
   * Com cenário, a origem é o saldo inicial declarado nele — que é um número do
   * planejamento, não do extrato —, e por isso a janela pode começar no passado.
   */
  async projection(companyId: string, query: QueryProjectionDto) {
    const scenario = query.scenarioId
      ? await this.scenarios.findOne(companyId, query.scenarioId)
      : null;

    const window = scenario
      ? { from: scenario.startDate, to: scenario.endDate }
      : this.resolveWindow(query);

    const today = this.today();
    if (!scenario && window.from < today) {
      throw new BadRequestException(
        'A projeção parte do saldo de caixa de hoje: informe um período a partir de ' +
          `${formatDateOnly(today)} ou consulte o passado em /cash-flow/summary.`,
      );
    }

    const { unit, step } = GRANULARITY[query.granularity];
    this.assertBucketLimit(window.from, window.to, query.granularity);

    const filters = this.buildFilters(companyId, window.from, window.to, query, scenario?.id);

    const rows = await this.prisma.db.$queryRaw<BucketRow[]>`
      SELECT g.periodo::date AS periodo,
             coalesce(sum(f.entradas) FILTER (WHERE f.situacao = 'REALIZADO'), 0) AS entradas_realizadas,
             coalesce(sum(f.entradas) FILTER (WHERE f.situacao = 'PREVISTO'),  0) AS entradas_previstas,
             coalesce(sum(f.entradas) FILTER (WHERE f.situacao = 'VENCIDO'),   0) AS entradas_vencidas,
             coalesce(sum(f.saidas)   FILTER (WHERE f.situacao = 'REALIZADO'), 0) AS saidas_realizadas,
             coalesce(sum(f.saidas)   FILTER (WHERE f.situacao = 'PREVISTO'),  0) AS saidas_previstas,
             coalesce(sum(f.saidas)   FILTER (WHERE f.situacao = 'VENCIDO'),   0) AS saidas_vencidas
        FROM generate_series(
               date_trunc(${unit}, ${formatDateOnly(window.from)}::date),
               ${formatDateOnly(window.to)}::date,
               ${step}::interval
             ) AS g(periodo)
        -- LEFT JOIN com a série: períodos sem movimento precisam aparecer
        -- zerados, senão o gráfico pula o mês em que nada acontece — que é
        -- justamente o mês que interessa quando o saldo está apertado.
        LEFT JOIN vw_fluxo_caixa_diario f
               ON f.data_referencia >= g.periodo::date
              AND f.data_referencia <  (g.periodo + ${step}::interval)::date
              AND ${filters}
       GROUP BY g.periodo
       ORDER BY g.periodo
    `;

    const assumptions = (scenario?.assumptions ?? {}) as ScenarioAssumptions;
    const inflowFactor = this.factor(assumptions.entradas_percentual);
    const outflowFactor = this.factor(assumptions.saidas_percentual);

    const openingBalance = scenario
      ? scenario.openingBalance
      : await this.currentCashBalance(companyId);

    let balance = openingBalance;
    const periods = rows.map((row) => {
      // A premissa ajusta só o que ainda não aconteceu: previsto e vencido são
      // expectativa, realizado é extrato.
      const inflow = {
        realized: row.entradas_realizadas,
        expected: this.apply(row.entradas_previstas, inflowFactor),
        overdue: this.apply(row.entradas_vencidas, inflowFactor),
      };
      const outflow = {
        realized: row.saidas_realizadas,
        expected: this.apply(row.saidas_previstas, outflowFactor),
        overdue: this.apply(row.saidas_vencidas, outflowFactor),
      };

      const inflowTotal = inflow.realized.plus(inflow.expected).plus(inflow.overdue);
      const outflowTotal = outflow.realized.plus(outflow.expected).plus(outflow.overdue);
      const net = inflowTotal.minus(outflowTotal);
      balance = balance.plus(net);

      return {
        periodStart: formatDateOnly(row.periodo),
        inflow: { ...inflow, total: inflowTotal },
        outflow: { ...outflow, total: outflowTotal },
        net,
        closingBalance: balance,
      };
    });

    return {
      period: { from: formatDateOnly(window.from), to: formatDateOnly(window.to) },
      granularity: query.granularity,
      scenario: scenario
        ? { id: scenario.id, name: scenario.name, assumptions: scenario.assumptions }
        : null,
      openingBalance,
      closingBalance: balance,
      periods,
    };
  }

  /**
   * Saldo de caixa de hoje (RF-105) — `fn_saldo_caixa_atual` (bd/10).
   *
   * Exposto ao módulo porque o alerta parte do mesmo número: o saldo que a
   * projeção usa como origem e o saldo que o alerta compara com o mínimo
   * precisam ser o mesmo, ou os dois discordam sobre a mesma empresa.
   */
  async currentCashBalance(companyId: string, bankAccountId?: string | null) {
    const [row] = await this.prisma.db.$queryRaw<{ saldo: Prisma.Decimal }[]>`
      SELECT fn_saldo_caixa_atual(${companyId}::uuid, ${bankAccountId ?? null}::uuid) AS saldo
    `;
    return row?.saldo ?? ZERO;
  }

  /**
   * Entradas e saídas por dia num intervalo — base do alerta (RF-105).
   *
   * Devolve só os dias com movimento; quem precisa da série completa preenche
   * as lacunas, que valem zero por definição.
   */
  async dailyNet(companyId: string, from: Date, to: Date) {
    return this.prisma.db.$queryRaw<
      { dia: Date; entradas: Prisma.Decimal; saidas: Prisma.Decimal }[]
    >`
      SELECT f.data_referencia AS dia,
             sum(f.entradas)   AS entradas,
             sum(f.saidas)     AS saidas
        FROM vw_fluxo_caixa_diario f
       WHERE f.empresa_id = ${companyId}::uuid
         AND f.cenario_id IS NULL
         AND f.data_referencia BETWEEN ${formatDateOnly(from)}::date AND ${formatDateOnly(to)}::date
       GROUP BY f.data_referencia
       ORDER BY f.data_referencia
    `;
  }

  /**
   * Filtros comuns às duas leituras.
   *
   * `cenario_id IS NULL` isola o consolidado real das hipóteses digitadas; com
   * cenário informado, as duas somam — que é o que "projetar sob um cenário"
   * significa.
   */
  private buildFilters(
    companyId: string,
    from: Date,
    to: Date,
    query: QueryCashFlowDto,
    scenarioId?: string,
  ): Prisma.Sql {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`f.empresa_id = ${companyId}::uuid`,
      Prisma.sql`f.data_referencia BETWEEN ${formatDateOnly(from)}::date AND ${formatDateOnly(to)}::date`,
      scenarioId
        ? Prisma.sql`(f.cenario_id IS NULL OR f.cenario_id = ${scenarioId}::uuid)`
        : Prisma.sql`f.cenario_id IS NULL`,
    ];

    if (query.branchId) conditions.push(Prisma.sql`f.filial_id = ${query.branchId}::uuid`);
    if (query.categoryId) {
      conditions.push(Prisma.sql`f.categoria_financeira_id = ${query.categoryId}::uuid`);
    }
    if (query.costCenterId) {
      conditions.push(Prisma.sql`f.centro_custo_id = ${query.costCenterId}::uuid`);
    }

    return Prisma.join(conditions, ' AND ');
  }

  private resolveWindow(query: QueryCashFlowDto): { from: Date; to: Date } {
    const from = query.from ? toDateOnly(query.from) : this.today();
    const to = query.to
      ? toDateOnly(query.to)
      : new Date(from.getTime() + DEFAULT_WINDOW_DAYS * 86_400_000);

    if (to < from) {
      throw new BadRequestException('O fim do período não pode ser anterior ao início.');
    }
    return { from, to };
  }

  /**
   * Um pedido de 30 anos em dias não é uma pergunta de caixa: é uma resposta de
   * onze mil linhas que trava o cliente e ocupa o banco. Recusar cedo, com o
   * grão sugerido, é mais útil do que entregar.
   */
  private assertBucketLimit(from: Date, to: Date, granularity: CashFlowGranularity): void {
    const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    const divisor =
      granularity === CashFlowGranularity.DIA
        ? 1
        : granularity === CashFlowGranularity.SEMANA
          ? 7
          : 30;

    if (Math.ceil(days / divisor) > MAX_BUCKETS) {
      throw new BadRequestException(
        `Período longo demais para o grão ${granularity}: use um intervalo menor ou agrupe por MES.`,
      );
    }
  }

  private totals(rows: SituationRow[]) {
    const inflow = rows.reduce((sum, row) => sum.plus(row.entradas), ZERO);
    const outflow = rows.reduce((sum, row) => sum.plus(row.saidas), ZERO);
    return { inflow, outflow, net: inflow.minus(outflow) };
  }

  /** Percentual de premissa em fator multiplicador; ausente vale "sem ajuste". */
  private factor(percentage?: number): Prisma.Decimal {
    if (percentage === undefined || percentage === null) return new Prisma.Decimal(1);
    return new Prisma.Decimal(100).plus(percentage).dividedBy(100);
  }

  private apply(value: Prisma.Decimal, factor: Prisma.Decimal): Prisma.Decimal {
    if (factor.equals(1)) return value;
    return value.mul(factor).toDecimalPlaces(2);
  }

  /** Hoje como dia civil — caixa se planeja em datas, não em instantes. */
  private today(): Date {
    return toDateOnly(formatDateOnly(new Date()));
  }
}
