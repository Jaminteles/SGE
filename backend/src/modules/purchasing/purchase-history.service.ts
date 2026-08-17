import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { formatDateOnly } from '../../common/utils/date-only';
import { QueryPurchaseHistoryDto } from './dto/query-purchase-history.dto';

interface HistoryRow {
  pedido_compra_item_id: string;
  pedido_compra_id: string;
  numero: string;
  data_pedido: Date;
  status: string;
  parceiro_id: string;
  parceiro_nome: string | null;
  produto_id: string | null;
  produto_codigo: string | null;
  descricao: string;
  quantidade: Prisma.Decimal;
  quantidade_recebida: Prisma.Decimal;
  quantidade_pendente: Prisma.Decimal;
  preco_unitario: Prisma.Decimal;
  valor_total: Prisma.Decimal;
  custo_unitario_posto: Prisma.Decimal | null;
}

interface SummaryRow {
  linhas: bigint;
  quantidade: Prisma.Decimal | null;
  valor: Prisma.Decimal | null;
  menor_preco: Prisma.Decimal | null;
  maior_preco: Prisma.Decimal | null;
  ultimo_pedido: Date | null;
}

/**
 * Histórico de compras e de preços (RF-042) — leitura de `vw_historico_compra`
 * (bd/11).
 *
 * Recurso de permissão próprio: o histórico expõe a margem negociada com cada
 * fornecedor, que é a informação mais sensível do módulo — e a que decide a
 * próxima compra.
 *
 * Nada é gravado: o resumo é agregação no instante da consulta. Um "preço médio
 * do item" guardado numa coluna estaria errado no primeiro pedido novo, sem que
 * ninguém tivesse errado nada.
 */
@Injectable()
export class PurchaseHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(companyId: string, query: QueryPurchaseHistoryDto) {
    const filters = this.buildFilters(companyId, query);

    const rows = await this.prisma.db.$queryRaw<HistoryRow[]>`
      SELECT h.pedido_compra_item_id,
             h.pedido_compra_id,
             h.numero,
             h.data_pedido,
             h.status::text                AS status,
             h.parceiro_id,
             pa.razao_social               AS parceiro_nome,
             h.produto_id,
             pr.codigo                     AS produto_codigo,
             h.descricao,
             h.quantidade,
             h.quantidade_recebida,
             h.quantidade_pendente,
             h.preco_unitario,
             h.valor_total,
             h.custo_unitario_posto
        FROM vw_historico_compra h
        LEFT JOIN parceiro pa ON pa.id = h.parceiro_id
        LEFT JOIN produto  pr ON pr.id = h.produto_id
       WHERE ${filters}
       ORDER BY h.data_pedido DESC, h.numero DESC, h.sequencia
       LIMIT ${query.take} OFFSET ${query.skip}
    `;

    const [summary] = await this.prisma.db.$queryRaw<SummaryRow[]>`
      SELECT count(*)                          AS linhas,
             sum(h.quantidade)                 AS quantidade,
             sum(h.valor_total)                AS valor,
             min(h.preco_unitario)             AS menor_preco,
             max(h.preco_unitario)             AS maior_preco,
             max(h.data_pedido)                AS ultimo_pedido
        FROM vw_historico_compra h
       WHERE ${filters}
    `;

    const total = Number(summary?.linhas ?? 0);
    const quantity = summary?.quantidade ?? new Prisma.Decimal(0);
    const amount = summary?.valor ?? new Prisma.Decimal(0);

    return {
      ...new PaginatedResult(
        rows.map((row) => this.toResponse(row)),
        total,
        query.page,
        query.pageSize,
      ),
      summary: {
        lines: total,
        quantity: quantity.toFixed(6),
        amount: amount.toFixed(2),
        // Preço médio ponderado pela quantidade: a média simples dos preços
        // trataria uma compra de 1 unidade como uma de 10.000.
        averagePrice: quantity.greaterThan(0)
          ? amount.dividedBy(quantity).toDecimalPlaces(6).toFixed(6)
          : null,
        minPrice: summary?.menor_preco?.toFixed(6) ?? null,
        maxPrice: summary?.maior_preco?.toFixed(6) ?? null,
        lastOrderDate: summary?.ultimo_pedido ? formatDateOnly(summary.ultimo_pedido) : null,
      },
    };
  }

  private toResponse(row: HistoryRow) {
    return {
      orderItemId: row.pedido_compra_item_id,
      orderId: row.pedido_compra_id,
      number: row.numero,
      orderDate: formatDateOnly(row.data_pedido),
      status: row.status,
      partner: { id: row.parceiro_id, legalName: row.parceiro_nome },
      product: row.produto_id ? { id: row.produto_id, code: row.produto_codigo } : null,
      description: row.descricao,
      quantity: row.quantidade.toFixed(6),
      receivedQuantity: row.quantidade_recebida.toFixed(6),
      pendingQuantity: row.quantidade_pendente.toFixed(6),
      unitPrice: row.preco_unitario.toFixed(6),
      lineAmount: row.valor_total.toFixed(2),
      landedUnitCost: row.custo_unitario_posto?.toFixed(6) ?? null,
    };
  }

  private buildFilters(companyId: string, query: QueryPurchaseHistoryDto): Prisma.Sql {
    const conditions: Prisma.Sql[] = [Prisma.sql`h.empresa_id = ${companyId}::uuid`];

    if (query.productId) conditions.push(Prisma.sql`h.produto_id = ${query.productId}::uuid`);
    if (query.partnerId) conditions.push(Prisma.sql`h.parceiro_id = ${query.partnerId}::uuid`);
    if (query.from) conditions.push(Prisma.sql`h.data_pedido >= ${query.from}::date`);
    if (query.to) conditions.push(Prisma.sql`h.data_pedido <= ${query.to}::date`);
    if (query.q) {
      conditions.push(Prisma.sql`h.descricao ILIKE ${'%' + query.q + '%'}`);
    }

    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('O início do período não pode ser posterior ao fim.');
    }

    return Prisma.join(conditions, ' AND ');
  }
}
