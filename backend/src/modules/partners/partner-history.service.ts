import { BadRequestException, Injectable } from '@nestjs/common';
import { EntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { formatDateOnly, toDateOnly } from '../../common/utils/date-only';
import { PartnersService } from './partners.service';
import { QueryPartnerHistoryDto } from './dto/query-partner-history.dto';

const ZERO = new Prisma.Decimal(0);
const DEFAULT_LIMIT = 10;

/** Totais de um lado do relacionamento financeiro (a pagar ou a receber). */
export interface FinancialSideSummary {
  count: number;
  netAmount: string;
  settledAmount: string;
  openBalance: string;
}

/**
 * Histórico comercial e financeiro do parceiro (RF-025).
 *
 * Somente leitura, e consolidado a partir das tabelas que já são a fonte de
 * cada fato: `titulo` (M08) e `pedido_compra` (M06). Guardar aqui uma cópia do
 * "total comprado" seria criar um segundo número para a mesma verdade — o que
 * diverge no primeiro estorno.
 *
 * Enquanto os módulos financeiro e de compras não entram (Sprints 6 e 8), o
 * resumo responde zerado: é o retrato correto de um parceiro sem movimento.
 */
@Injectable()
export class PartnerHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: PartnersService,
  ) {}

  async summary(companyId: string, partnerId: string, query: QueryPartnerHistoryDto) {
    const partner = await this.partners.findOne(companyId, partnerId);
    const period = this.resolvePeriod(query);
    const limit = query.limit ?? DEFAULT_LIMIT;

    const entryWhere: Prisma.FinancialEntryWhereInput = {
      companyId,
      partnerId,
      ...(period ? { issueDate: period } : {}),
    };
    const orderWhere: Prisma.PurchaseOrderWhereInput = {
      companyId,
      partnerId,
      ...(period ? { orderDate: period } : {}),
    };

    const [payable, receivable, recentEntries, purchases, recentOrders] = await Promise.all([
      this.summarizeEntries(entryWhere, EntryType.PAGAR),
      this.summarizeEntries(entryWhere, EntryType.RECEBER),
      this.prisma.db.financialEntry.findMany({
        where: entryWhere,
        orderBy: { issueDate: 'desc' },
        take: limit,
      }),
      this.prisma.db.purchaseOrder.aggregate({
        where: orderWhere,
        _count: { _all: true },
        _sum: { totalAmount: true },
        _max: { orderDate: true },
      }),
      this.prisma.db.purchaseOrder.findMany({
        where: orderWhere,
        orderBy: { orderDate: 'desc' },
        take: limit,
      }),
    ]);

    return {
      partner: {
        id: partner.id,
        legalName: partner.legalName,
        isCustomer: partner.isCustomer,
        isSupplier: partner.isSupplier,
        isActive: partner.isActive,
        customerBlocked: partner.customer?.isBlocked ?? null,
        supplierBlocked: partner.supplier?.isBlocked ?? null,
        creditLimit: partner.customer?.creditLimit.toFixed(2) ?? null,
        registeredAt: partner.createdAt,
      },
      period: {
        from: query.from ?? null,
        to: query.to ?? null,
      },
      financial: {
        payable,
        receivable,
        // Exposição líquida: o que ele nos deve menos o que devemos a ele.
        netExposure: new Prisma.Decimal(receivable.openBalance)
          .sub(new Prisma.Decimal(payable.openBalance))
          .toFixed(2),
      },
      commercial: {
        purchaseOrders: {
          count: purchases._count._all,
          totalAmount: (purchases._sum.totalAmount ?? ZERO).toFixed(2),
          lastOrderDate: purchases._max.orderDate ? formatDateOnly(purchases._max.orderDate) : null,
        },
        recentOrders: recentOrders.map((order) => ({
          id: order.id,
          number: order.number,
          orderDate: formatDateOnly(order.orderDate),
          totalAmount: order.totalAmount.toFixed(2),
          status: order.status,
        })),
      },
      recentEntries: recentEntries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        number: entry.number,
        description: entry.description,
        issueDate: formatDateOnly(entry.issueDate),
        netAmount: entry.netAmount.toFixed(2),
        settledAmount: entry.settledAmount.toFixed(2),
        balance: entry.balance.toFixed(2),
        status: entry.status,
      })),
    };
  }

  private async summarizeEntries(
    where: Prisma.FinancialEntryWhereInput,
    type: EntryType,
  ): Promise<FinancialSideSummary> {
    const totals = await this.prisma.db.financialEntry.aggregate({
      where: { ...where, type },
      _count: { _all: true },
      _sum: { netAmount: true, settledAmount: true, balance: true },
    });

    return {
      count: totals._count._all,
      netAmount: (totals._sum.netAmount ?? ZERO).toFixed(2),
      settledAmount: (totals._sum.settledAmount ?? ZERO).toFixed(2),
      openBalance: (totals._sum.balance ?? ZERO).toFixed(2),
    };
  }

  /** Período inclusivo nos dois extremos: são colunas `date`, não instantes. */
  private resolvePeriod(query: QueryPartnerHistoryDto): Prisma.DateTimeFilter | undefined {
    if (!query.from && !query.to) return undefined;

    const from = query.from ? toDateOnly(query.from) : undefined;
    const to = query.to ? toDateOnly(query.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException('O início do período não pode ser posterior ao fim.');
    }

    return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
}
