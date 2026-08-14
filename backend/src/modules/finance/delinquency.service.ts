import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryPortfolioDto } from './dto/query-portfolio.dto';

/** Faixas de aging, na ordem em que a leitura faz sentido (bd/09). */
const AGING_BUCKETS = ['ATE_30', 'DE_31_A_60', 'DE_61_A_90', 'ACIMA_DE_90'] as const;

interface BucketRow {
  faixa_atraso: string;
  parcelas: bigint;
  saldo: Prisma.Decimal;
  atualizado: Prisma.Decimal;
}

interface PartnerRow {
  parceiro_id: string | null;
  parceiro_nome: string | null;
  parcelas: bigint;
  saldo: Prisma.Decimal;
  atualizado: Prisma.Decimal;
  maior_atraso: number;
}

/**
 * Inadimplência (RF-058) — leitura de `vw_inadimplencia` (bd/09).
 *
 * Recurso de permissão próprio: o aging expõe quem está devendo, há quanto
 * tempo e quanto — é a leitura que sustenta cobrança e provisão para perda, e
 * não acompanha quem apenas lança títulos.
 *
 * Duas visões do mesmo fato: por faixa de atraso (quanto está velho) e por
 * parceiro (com quem está). Nenhuma delas guarda número: são agregações da
 * carteira no instante da consulta, porque "quanto está vencido" muda de valor
 * a cada dia sem que nada seja lançado.
 */
@Injectable()
export class DelinquencyService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(companyId: string, query: QueryPortfolioDto) {
    const filters = this.buildFilters(companyId, query);

    const buckets = await this.prisma.db.$queryRaw<BucketRow[]>`
      SELECT faixa_atraso,
             count(*)                    AS parcelas,
             sum(saldo)                  AS saldo,
             sum(valor_atualizado)       AS atualizado
        FROM vw_inadimplencia p
       WHERE ${filters}
       GROUP BY faixa_atraso
    `;

    const partners = await this.prisma.db.$queryRaw<PartnerRow[]>`
      SELECT p.parceiro_id,
             pa.razao_social             AS parceiro_nome,
             count(*)                    AS parcelas,
             sum(p.saldo)                AS saldo,
             sum(p.valor_atualizado)     AS atualizado,
             max(p.dias_atraso)          AS maior_atraso
        FROM vw_inadimplencia p
        LEFT JOIN parceiro pa ON pa.id = p.parceiro_id
       WHERE ${filters}
       GROUP BY p.parceiro_id, pa.razao_social
       ORDER BY sum(p.valor_atualizado) DESC
       LIMIT 50
    `;

    const byBucket = new Map(buckets.map((row) => [row.faixa_atraso, row]));

    return {
      // Faixas sem parcela aparecem zeradas: uma faixa ausente lê-se como
      // "não consultei", e zerada, como "não há" — que é a informação.
      aging: AGING_BUCKETS.map((bucket) => ({
        bucket,
        installments: Number(byBucket.get(bucket)?.parcelas ?? 0),
        balance: byBucket.get(bucket)?.saldo ?? new Prisma.Decimal(0),
        updatedBalance: byBucket.get(bucket)?.atualizado ?? new Prisma.Decimal(0),
      })),
      totals: {
        installments: buckets.reduce((sum, row) => sum + Number(row.parcelas), 0),
        balance: buckets.reduce((sum, row) => sum.plus(row.saldo), new Prisma.Decimal(0)),
        updatedBalance: buckets.reduce(
          (sum, row) => sum.plus(row.atualizado),
          new Prisma.Decimal(0),
        ),
      },
      partners: partners.map((row) => ({
        partner: row.parceiro_id ? { id: row.parceiro_id, legalName: row.parceiro_nome } : null,
        installments: Number(row.parcelas),
        balance: row.saldo,
        updatedBalance: row.atualizado,
        maxDaysOverdue: row.maior_atraso,
      })),
    };
  }

  private buildFilters(companyId: string, query: QueryPortfolioDto): Prisma.Sql {
    const conditions: Prisma.Sql[] = [Prisma.sql`p.empresa_id = ${companyId}::uuid`];

    if (query.type) conditions.push(Prisma.sql`p.tipo = ${query.type}::enum_tipo_titulo`);
    if (query.partnerId) conditions.push(Prisma.sql`p.parceiro_id = ${query.partnerId}::uuid`);
    if (query.branchId) conditions.push(Prisma.sql`p.filial_id = ${query.branchId}::uuid`);
    if (query.categoryId) {
      conditions.push(Prisma.sql`p.categoria_financeira_id = ${query.categoryId}::uuid`);
    }
    if (query.costCenterId) {
      conditions.push(Prisma.sql`p.centro_custo_id = ${query.costCenterId}::uuid`);
    }
    if (query.dueTo) conditions.push(Prisma.sql`p.data_vencimento <= ${query.dueTo}::date`);
    if (query.dueFrom) conditions.push(Prisma.sql`p.data_vencimento >= ${query.dueFrom}::date`);

    return Prisma.join(conditions, ' AND ');
  }
}
