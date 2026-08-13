import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { QueryStockBalanceDto } from './dto/query-stock-balance.dto';

const balanceInclude = {
  product: { select: { id: true, code: true, description: true, minStock: true, maxStock: true } },
  location: {
    select: {
      id: true,
      code: true,
      name: true,
      branch: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.StockBalanceInclude;

/** Uma linha de `vw_estoque_alerta_minimo` (RF-035). */
interface StockAlertRow {
  produto_id: string;
  codigo: string;
  descricao: string;
  local_estoque_id: string;
  local_nome: string;
  quantidade: Prisma.Decimal;
  estoque_minimo: Prisma.Decimal;
  quantidade_repor: Prisma.Decimal;
}

/**
 * Consulta de saldos, alertas e valorização (RF-031, RF-034, RF-035).
 *
 * Somente leitura — e não por convenção: `estoque_saldo` é projeção do razão e
 * a role da aplicação não tem privilégio de escrita sobre ela (bd/08). Corrigir
 * saldo é lançar movimento.
 */
@Injectable()
export class StockBalancesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Saldos por produto e local (RF-031). */
  async findAll(companyId: string, query: QueryStockBalanceDto) {
    const where: Prisma.StockBalanceWhereInput = {
      companyId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.branchId ? { location: { branchId: query.branchId } } : {}),
      ...(query.onlyWithBalance ? { quantity: { gt: 0 } } : {}),
      ...(query.q
        ? {
            product: {
              OR: [
                { code: { contains: query.q, mode: 'insensitive' } },
                { description: { contains: query.q, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const data = await this.prisma.db.stockBalance.findMany({
      where,
      include: balanceInclude,
      orderBy: [{ product: { code: 'asc' } }, { location: { code: 'asc' } }],
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.stockBalance.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  /**
   * Posição consolidada de um item: saldo por local e total na empresa.
   *
   * O total é somado a partir das mesmas linhas já lidas — pedir ao banco um
   * `aggregate` extra devolveria o mesmo número por uma segunda ida.
   */
  async findByProduct(companyId: string, productId: string) {
    const balances = await this.prisma.db.stockBalance.findMany({
      where: { companyId, productId },
      include: balanceInclude,
      orderBy: { location: { code: 'asc' } },
    });

    const quantity = balances.reduce((sum, b) => sum.plus(b.quantity), new Prisma.Decimal(0));
    const totalValue = balances.reduce((sum, b) => sum.plus(b.totalValue), new Prisma.Decimal(0));

    return {
      productId,
      quantity,
      totalValue,
      // Custo médio da empresa: a média das médias por local só coincidiria com
      // este número se todos os locais tivessem a mesma quantidade.
      averageCost: quantity.isZero() ? new Prisma.Decimal(0) : totalValue.dividedBy(quantity),
      balances,
    };
  }

  /**
   * Itens no ou abaixo do estoque mínimo (RF-035).
   *
   * Lê `vw_estoque_alerta_minimo` (bd/01) em vez de repetir a comparação aqui:
   * a regra do alerta é do modelo, e duas definições do mesmo alerta divergem
   * na primeira mudança.
   */
  async alerts(companyId: string, locationId?: string) {
    const rows = await this.prisma.db.$queryRaw<StockAlertRow[]>`
      SELECT produto_id, codigo, descricao, local_estoque_id, local_nome,
             quantidade, estoque_minimo, quantidade_repor
        FROM vw_estoque_alerta_minimo
       WHERE empresa_id = ${companyId}::uuid
         AND (${locationId ?? null}::uuid IS NULL OR local_estoque_id = ${locationId ?? null}::uuid)
       ORDER BY quantidade_repor DESC, codigo
    `;

    return rows.map((row) => ({
      productId: row.produto_id,
      code: row.codigo,
      description: row.descricao,
      locationId: row.local_estoque_id,
      locationName: row.local_nome,
      quantity: row.quantidade,
      minStock: row.estoque_minimo,
      quantityToReplenish: row.quantidade_repor,
    }));
  }

  /**
   * Valorização do estoque a custo médio (RF-034).
   *
   * Recurso de permissão próprio (`stock-valuation:READ`): o saldo diz quanto
   * há, a valorização diz quanto vale — é número de balanço, e não precisa
   * acompanhar quem opera o depósito.
   */
  async valuation(companyId: string, branchId?: string, locationId?: string) {
    const where: Prisma.StockBalanceWhereInput = {
      companyId,
      quantity: { gt: 0 },
      ...(locationId ? { locationId } : {}),
      ...(branchId ? { location: { branchId } } : {}),
    };

    const byLocation = await this.prisma.db.stockBalance.groupBy({
      by: ['locationId'],
      where,
      _sum: { totalValue: true, quantity: true },
    });

    const locations = await this.prisma.db.stockLocation.findMany({
      where: { companyId, id: { in: byLocation.map((row) => row.locationId) } },
      select: { id: true, code: true, name: true, branch: { select: { id: true, name: true } } },
    });
    const byId = new Map(locations.map((l) => [l.id, l]));

    const total = byLocation.reduce(
      (sum, row) => sum.plus(row._sum.totalValue ?? 0),
      new Prisma.Decimal(0),
    );

    return {
      totalValue: total,
      locations: byLocation.map((row) => ({
        location: byId.get(row.locationId) ?? { id: row.locationId },
        quantity: row._sum.quantity ?? new Prisma.Decimal(0),
        totalValue: row._sum.totalValue ?? new Prisma.Decimal(0),
      })),
    };
  }
}
