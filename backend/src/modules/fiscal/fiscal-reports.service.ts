import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatDateOnly, toDateOnly } from '../../common/utils/date-only';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FiscalDirection,
  QueryFiscalLedgerDto,
  QueryFiscalReportDto,
} from './dto/fiscal-report.dto';

/** Linha da apuração, como a view devolve (bd/18 §7). */
interface AssessmentRow {
  competencia: Date;
  sentido: string;
  modelo: string;
  documentos: number;
  valor_total: Prisma.Decimal;
  valor_produtos: Prisma.Decimal;
  valor_icms: Prisma.Decimal;
  valor_icms_st: Prisma.Decimal;
  valor_ipi: Prisma.Decimal;
  valor_pis: Prisma.Decimal;
  valor_cofins: Prisma.Decimal;
  valor_iss: Prisma.Decimal;
}

/** Linha do livro fiscal por CFOP (bd/18 §7). */
interface LedgerRow {
  competencia: Date;
  sentido: string;
  cfop: string | null;
  ncm: string | null;
  itens: number;
  valor_total: Prisma.Decimal;
  base_calculo_icms: Prisma.Decimal;
  valor_icms: Prisma.Decimal;
  valor_icms_st: Prisma.Decimal;
  valor_ipi: Prisma.Decimal;
  valor_pis: Prisma.Decimal;
  valor_cofins: Prisma.Decimal;
}

/**
 * Relatórios fiscais (RF-093).
 *
 * Duas leituras sobre o mesmo movimento: a **apuração**, que soma os tributos
 * por competência e sentido, e o **livro fiscal**, que abre por CFOP e NCM.
 *
 * As duas saem das views de bd/18 §7 e, portanto, do que foi declarado — nada é
 * recalculado. Documento cancelado, denegado e duplicado ficam de fora: nota
 * cancelada não gera imposto, denegada nunca existiu, e somar a duplicada
 * dobraria o ICMS do mês.
 *
 * As views têm `security_invoker`, então a RLS aplicada é a de quem consulta —
 * sem isso o relatório fiscal de uma empresa mostraria o movimento de todas. O
 * `empresa_id` no `WHERE` é defesa em profundidade, não o isolamento.
 *
 * Os filtros vão como parâmetro em template do Prisma; nenhum valor de query é
 * concatenado na consulta.
 */
@Injectable()
export class FiscalReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Apuração por competência e sentido (RF-093). */
  async assessment(companyId: string, query: QueryFiscalReportDto) {
    const { from, to } = this.range(query.from, query.to);
    const filters = this.filters(companyId, from, to, query.branchId, query.direction);

    const rows = await this.prisma.db.$queryRaw<AssessmentRow[]>`
      SELECT a.competencia,
             a.sentido,
             a.modelo::text            AS modelo,
             sum(a.documentos)::int    AS documentos,
             sum(a.valor_total)        AS valor_total,
             sum(a.valor_produtos)     AS valor_produtos,
             sum(a.valor_icms)         AS valor_icms,
             sum(a.valor_icms_st)      AS valor_icms_st,
             sum(a.valor_ipi)          AS valor_ipi,
             sum(a.valor_pis)          AS valor_pis,
             sum(a.valor_cofins)       AS valor_cofins,
             sum(a.valor_iss)          AS valor_iss
        FROM vw_apuracao_fiscal a
       WHERE ${filters}
       GROUP BY a.competencia, a.sentido, a.modelo
       ORDER BY a.competencia, a.sentido, a.modelo
    `;

    return {
      period: { from: formatDateOnly(from), to: formatDateOnly(to) },
      rows: rows.map((row) => ({
        competence: formatDateOnly(row.competencia),
        direction: row.sentido,
        model: row.modelo,
        documents: row.documentos,
        totalAmount: row.valor_total,
        productsAmount: row.valor_produtos,
        icmsAmount: row.valor_icms,
        icmsStAmount: row.valor_icms_st,
        ipiAmount: row.valor_ipi,
        pisAmount: row.valor_pis,
        cofinsAmount: row.valor_cofins,
        issAmount: row.valor_iss,
      })),
      totals: this.totals(rows),
    };
  }

  /** Livro de entradas e saídas por CFOP e NCM (RF-093). */
  async ledger(companyId: string, query: QueryFiscalLedgerDto) {
    const { from, to } = this.range(query.from, query.to);
    const conditions: Prisma.Sql[] = [
      this.filters(companyId, from, to, query.branchId, query.direction),
    ];

    if (query.cfop) conditions.push(Prisma.sql`a.cfop = ${query.cfop}`);
    if (query.ncm) conditions.push(Prisma.sql`a.ncm = ${query.ncm}`);

    const rows = await this.prisma.db.$queryRaw<LedgerRow[]>`
      SELECT a.competencia,
             a.sentido,
             a.cfop,
             a.ncm,
             sum(a.itens)::int          AS itens,
             sum(a.valor_total)         AS valor_total,
             sum(a.base_calculo_icms)   AS base_calculo_icms,
             sum(a.valor_icms)          AS valor_icms,
             sum(a.valor_icms_st)       AS valor_icms_st,
             sum(a.valor_ipi)           AS valor_ipi,
             sum(a.valor_pis)           AS valor_pis,
             sum(a.valor_cofins)        AS valor_cofins
        FROM vw_livro_fiscal_cfop a
       WHERE ${Prisma.join(conditions, ' AND ')}
       GROUP BY a.competencia, a.sentido, a.cfop, a.ncm
       ORDER BY a.competencia, a.sentido, a.cfop, a.ncm
    `;

    return {
      period: { from: formatDateOnly(from), to: formatDateOnly(to) },
      rows: rows.map((row) => ({
        competence: formatDateOnly(row.competencia),
        direction: row.sentido,
        cfop: row.cfop,
        ncm: row.ncm,
        items: row.itens,
        totalAmount: row.valor_total,
        icmsBase: row.base_calculo_icms,
        icmsAmount: row.valor_icms,
        icmsStAmount: row.valor_icms_st,
        ipiAmount: row.valor_ipi,
        pisAmount: row.valor_pis,
        cofinsAmount: row.valor_cofins,
      })),
    };
  }

  /**
   * Totais do período, separados por sentido.
   *
   * Entrada e saída somadas juntas não significam nada: o imposto da entrada é
   * crédito e o da saída é débito. Somá-los produziria um número que não é a
   * apuração de nada.
   */
  private totals(rows: AssessmentRow[]) {
    const zero = new Prisma.Decimal(0);
    const empty = () => ({
      documents: 0,
      totalAmount: zero,
      icmsAmount: zero,
      icmsStAmount: zero,
      ipiAmount: zero,
      pisAmount: zero,
      cofinsAmount: zero,
      issAmount: zero,
    });

    const totals: Record<string, ReturnType<typeof empty>> = {
      ENTRADA: empty(),
      SAIDA: empty(),
      INDEFINIDO: empty(),
    };

    for (const row of rows) {
      const bucket = totals[row.sentido] ?? totals.INDEFINIDO;
      bucket.documents += row.documentos;
      bucket.totalAmount = bucket.totalAmount.plus(row.valor_total);
      bucket.icmsAmount = bucket.icmsAmount.plus(row.valor_icms);
      bucket.icmsStAmount = bucket.icmsStAmount.plus(row.valor_icms_st);
      bucket.ipiAmount = bucket.ipiAmount.plus(row.valor_ipi);
      bucket.pisAmount = bucket.pisAmount.plus(row.valor_pis);
      bucket.cofinsAmount = bucket.cofinsAmount.plus(row.valor_cofins);
      bucket.issAmount = bucket.issAmount.plus(row.valor_iss);
    }

    return totals;
  }

  private filters(
    companyId: string,
    from: Date,
    to: Date,
    branchId?: string,
    direction?: FiscalDirection,
  ): Prisma.Sql {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`a.empresa_id = ${companyId}::uuid`,
      Prisma.sql`a.competencia BETWEEN date_trunc('month', ${formatDateOnly(from)}::date)::date
                                   AND date_trunc('month', ${formatDateOnly(to)}::date)::date`,
    ];

    if (branchId) conditions.push(Prisma.sql`a.filial_id = ${branchId}::uuid`);
    if (direction) conditions.push(Prisma.sql`a.sentido = ${direction}`);

    return Prisma.join(conditions, ' AND ');
  }

  /** Janela de competência, validada como dia civil. */
  private range(from: string, to: string): { from: Date; to: Date } {
    const start = toDateOnly(from);
    const end = toDateOnly(to);
    if (end.getTime() < start.getTime()) {
      throw new BadRequestException('`to` não pode ser anterior a `from`.');
    }
    return { from: start, to: end };
  }
}
