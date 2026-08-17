import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntryType, FiscalDocumentStatus, Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { ReferencesService } from '../../common/references/references.service';
import { formatDateOnly } from '../../common/utils/date-only';
import {
  MOVEMENT_ORIGIN,
  StockMovementInput,
  StockMovementsService,
} from '../stock/stock-movements.service';
import { ENTRY_ORIGIN, FinancialEntriesService } from '../finance/financial-entries.service';
import { PurchaseOrdersService, PurchaseOrderRow } from './purchase-orders.service';
import {
  CreateGoodsReceiptDto,
  GoodsReceiptItemDto,
  GoodsReceiptPayableDto,
} from './dto/create-goods-receipt.dto';
import { QueryGoodsReceiptDto } from './dto/query-goods-receipt.dto';

const receiptInclude = {
  order: { select: { id: true, number: true, status: true, partnerId: true } },
  branch: { select: { id: true, code: true, name: true } },
  location: { select: { id: true, code: true, name: true } },
  inspector: { select: { id: true, name: true } },
  fiscalDocument: { select: { id: true, number: true, series: true, accessKey: true } },
  items: {
    include: {
      product: { select: { id: true, code: true, description: true } },
      orderItem: { select: { id: true, sequence: true, description: true } },
    },
  },
} satisfies Prisma.GoodsReceiptInclude;

type ReceiptRow = Prisma.GoodsReceiptGetPayload<{ include: typeof receiptInclude }>;

type OrderItemRow = PurchaseOrderRow['items'][number];

/** Uma linha conferida, já resolvida contra o item do pedido. */
interface PlannedLine {
  dto: GoodsReceiptItemDto;
  orderItem: OrderItemRow;
  quantity: Prisma.Decimal;
  /** Preço do documento, ou o do pedido quando o fornecedor não divergiu. */
  price: Prisma.Decimal;
  /** Preço mais a parcela do item no frete e nas despesas do pedido (RF-034). */
  landedCost: Prisma.Decimal;
  locationId?: string;
}

/**
 * Recebimento e conferência de mercadoria (RF-039 a RF-041) —
 * `gestao.recebimento`.
 *
 * O recebimento é a única porta de entrada de "chegou": `quantidade_recebida` do
 * item, o status do pedido e as marcas de estoque/financeiro são projeção do
 * INSERT em `recebimento_item` (bd/11), e a role da aplicação não tem UPDATE nem
 * DELETE sobre a tabela. Corrigir uma conferência é registrar outra.
 *
 * A entrega puxa dois efeitos, ambos na mesma transação (RF-041):
 *  - **estoque**: uma entrada por linha aceita, valorizada pelo custo posto —
 *    preço do documento mais o rateio do frete, sem o qual a primeira saída
 *    vira lucro aparente;
 *  - **financeiro**: um título a pagar do valor recebido, quando pedido. Os
 *    índices únicos de bd/11 garantem que a segunda tentativa não gere
 *    mercadoria a mais nem dinheiro a mais saindo (RN-004).
 */
@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
    private readonly orders: PurchaseOrdersService,
    private readonly movements: StockMovementsService,
    private readonly entries: FinancialEntriesService,
  ) {}

  async create(companyId: string, orderId: string, dto: CreateGoodsReceiptDto, userId: string) {
    const order = await this.orders.findReceivable(companyId, orderId);

    await this.references.assert(companyId, {
      branchId: dto.branchId,
      stockLocationId: dto.locationId,
    });

    await this.assertFiscalDocument(companyId, order, dto.fiscalDocumentId);

    const lines = await this.planLines(companyId, order, dto);

    return this.prisma.transaction(async () => {
      const number = await this.nextNumber(companyId);
      const receipt = await this.prisma.db.goodsReceipt.create({
        data: {
          companyId,
          orderId,
          number,
          branchId: dto.branchId ?? order.branchId,
          locationId: dto.locationId,
          fiscalDocumentId: dto.fiscalDocumentId,
          inspectorId: userId,
          ...(dto.receivedAt ? { receivedAt: new Date(dto.receivedAt) } : {}),
          note: dto.note,
        },
        select: { id: true, receivedAt: true },
      });

      // Sequencial de propósito: o trigger de bd/11 toma um lock por item do
      // pedido e confere o saldo pendente contra a posição corrente — em
      // paralelo, duas linhas do mesmo item leriam o mesmo saldo.
      const movements: StockMovementInput[] = [];
      for (const line of lines) {
        const item = await this.prisma.db.goodsReceiptItem.create({
          data: {
            companyId,
            receiptId: receipt.id,
            orderItemId: line.orderItem.id,
            productId: line.orderItem.productId,
            receivedQuantity: line.quantity,
            documentPrice: line.dto.documentPrice
              ? new Prisma.Decimal(line.dto.documentPrice)
              : undefined,
            accepted: line.dto.accepted ?? true,
            note: line.dto.note,
          },
          select: { id: true, accepted: true },
        });

        if (item.accepted && line.locationId && line.orderItem.product?.tracksStock) {
          movements.push({
            companyId,
            productId: line.orderItem.productId!,
            locationId: line.locationId,
            type: StockMovementType.ENTRADA,
            quantity: line.quantity,
            unitCost: line.landedCost,
            movementDate: receipt.receivedAt,
            origin: MOVEMENT_ORIGIN.GOODS_RECEIPT,
            // A linha conferida, e não o recebimento: é o que dá ao índice
            // único de bd/11 a granularidade de uma entrada por linha.
            originId: item.id,
            fiscalDocumentId: dto.fiscalDocumentId,
            batch: line.dto.batch,
            note: line.dto.note,
            userId,
          });
        }
      }

      if (movements.length > 0) {
        await this.movements.record(companyId, movements);
      }

      if (dto.generatePayable) {
        await this.createPayable(companyId, order, receipt.id, number, lines, dto, userId);
      }

      return this.findOne(companyId, receipt.id);
    });
  }

  async findAll(companyId: string, query: QueryGoodsReceiptDto) {
    const where: Prisma.GoodsReceiptWhereInput = {
      companyId,
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.partnerId ? { order: { partnerId: query.partnerId } } : {}),
      ...(query.divergentOnly ? { hasDivergence: true } : {}),
      // Período semiaberto (`from` inclusivo, `to` exclusivo), como no razão de
      // estoque: com `lte`, a entrega das 23:59:59.7 ficaria fora do relatório.
      ...(query.from || query.to
        ? {
            receivedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.q ? { number: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const data = await this.prisma.db.goodsReceipt.findMany({
      where,
      include: receiptInclude,
      orderBy: { receivedAt: 'desc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.goodsReceipt.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string): Promise<ReceiptRow> {
    const receipt = await this.prisma.db.goodsReceipt.findFirst({
      where: { id, companyId },
      include: receiptInclude,
    });
    if (!receipt) {
      throw new NotFoundException('Recebimento não encontrado.');
    }
    return receipt;
  }

  /**
   * A nota informada na entrega é desta empresa, está processada e é do mesmo
   * fornecedor do pedido (RF-047).
   *
   * O vínculo entra na criação porque o cabeçalho do recebimento é imutável
   * (bd/11) — e a conferência acontece aqui, e não no M07, porque é o
   * recebimento que aponta para a nota.
   */
  private async assertFiscalDocument(
    companyId: string,
    order: PurchaseOrderRow,
    fiscalDocumentId?: string,
  ): Promise<void> {
    if (!fiscalDocumentId) return;

    const document = await this.prisma.db.fiscalDocument.findFirst({
      where: { id: fiscalDocumentId, companyId },
      select: { number: true, status: true, issuerPartnerId: true, purchaseOrderId: true },
    });
    if (!document) {
      throw new BadRequestException('Documento fiscal inválido para esta empresa.');
    }
    if (document.status !== FiscalDocumentStatus.PROCESSADO) {
      throw new BadRequestException(
        `O documento ${document.number} está ${document.status} e não pode amparar a entrega (RF-049).`,
      );
    }
    if (document.issuerPartnerId && document.issuerPartnerId !== order.partnerId) {
      throw new BadRequestException(
        `O documento ${document.number} foi emitido por outro fornecedor que não o do pedido ${order.number} (RF-047).`,
      );
    }
    if (document.purchaseOrderId && document.purchaseOrderId !== order.id) {
      throw new BadRequestException(
        `O documento ${document.number} está vinculado a outro pedido de compra (RF-047).`,
      );
    }
  }

  /** Número sequencial por empresa e ano, serializado no banco (bd/11). */
  private async nextNumber(companyId: string): Promise<string> {
    const [row] = await this.prisma.db.$queryRaw<{ numero: string }[]>`
      SELECT fn_proximo_numero_recebimento(${companyId}::uuid) AS numero
    `;
    return row.numero;
  }

  /**
   * Confere as linhas contra o pedido antes de escrever qualquer coisa.
   *
   * As mesmas regras existem em bd/11 — a duplicação é proposital: aqui elas
   * viram 400 com a mensagem do domínio, em vez de 500 de violação de regra.
   */
  private async planLines(
    companyId: string,
    order: PurchaseOrderRow,
    dto: CreateGoodsReceiptDto,
  ): Promise<PlannedLine[]> {
    const byId = new Map(order.items.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const lines: PlannedLine[] = [];

    for (const line of dto.items) {
      const orderItem = byId.get(line.orderItemId);
      if (!orderItem) {
        throw new BadRequestException(
          `O item conferido não pertence ao pedido ${order.number} (RF-040).`,
        );
      }
      // Duas linhas do mesmo item num recebimento só somariam a mesma
      // conferência duas vezes — quase sempre é a requisição enviada em dobro.
      if (seen.has(line.orderItemId)) {
        throw new BadRequestException(
          `O item ${orderItem.sequence} aparece duas vezes na mesma conferência.`,
        );
      }
      seen.add(line.orderItemId);

      const quantity = new Prisma.Decimal(line.receivedQuantity);
      if (quantity.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          `A quantidade recebida do item ${orderItem.sequence} deve ser maior que zero.`,
        );
      }

      const accepted = line.accepted ?? true;
      const pending = orderItem.quantity.minus(orderItem.receivedQuantity);
      if (accepted && quantity.greaterThan(pending)) {
        throw new BadRequestException(
          `O item ${orderItem.sequence} tem ${pending.toFixed(6)} pendente(s) e a entrega informa ${quantity.toFixed(6)} (RF-039).`,
        );
      }

      const price = line.documentPrice
        ? new Prisma.Decimal(line.documentPrice)
        : orderItem.unitPrice;
      const locationId = line.locationId ?? orderItem.locationId ?? dto.locationId ?? undefined;

      if (accepted && orderItem.product?.tracksStock) {
        if (!locationId) {
          throw new BadRequestException(
            `Informe o local de estoque que recebeu o item ${orderItem.sequence} (RF-031).`,
          );
        }
        await this.references.assert(companyId, { stockLocationId: locationId });
      }

      lines.push({
        dto: line,
        orderItem,
        quantity,
        price,
        landedCost: this.landedCost(orderItem, price),
        locationId,
      });
    }

    return lines;
  }

  /**
   * Custo posto da unidade (RF-034/RF-037): preço mais a parcela do item no
   * frete, no seguro e nas despesas do pedido.
   *
   * O rateio pode ser negativo quando o desconto do pedido supera as despesas —
   * e um desconto grande o bastante levaria o custo a zero ou abaixo, que o
   * razão recusa. Nesse caso vale o preço: o desconto do pedido é negociação
   * comercial, não motivo para registrar entrada sem valor.
   */
  private landedCost(orderItem: OrderItemRow, price: Prisma.Decimal): Prisma.Decimal {
    if (orderItem.quantity.lessThanOrEqualTo(0)) return price;

    const share = orderItem.apportionedFreight
      .dividedBy(orderItem.quantity)
      .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
    const landed = price.plus(share);

    return landed.greaterThan(0) ? landed : price;
  }

  /**
   * Título a pagar do que chegou (RF-041).
   *
   * O valor é a soma das linhas aceitas pelo custo posto — o mesmo número que
   * entrou no estoque. Enquanto o M07 não trouxer a nota (Sprint 9), é este o
   * documento que sustenta o pagamento, e por isso ele nasce ligado ao
   * recebimento e ao pedido.
   */
  private async createPayable(
    companyId: string,
    order: PurchaseOrderRow,
    receiptId: string,
    receiptNumber: string,
    lines: PlannedLine[],
    dto: CreateGoodsReceiptDto,
    userId: string,
  ) {
    const payable: GoodsReceiptPayableDto = dto.payable ?? {};

    const amount = lines
      .filter((line) => line.dto.accepted ?? true)
      .reduce(
        (total, line) => total.plus(line.quantity.times(line.landedCost)),
        new Prisma.Decimal(0),
      )
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'Nenhuma linha aceita nesta entrega: não há valor a pagar (RF-041).',
      );
    }

    await this.entries.createEntry(
      companyId,
      {
        type: EntryType.PAGAR,
        description: `Compra ${order.number} — recebimento ${receiptNumber}`,
        documentReference: payable.documentReference,
        partnerId: order.partnerId,
        branchId: dto.branchId ?? order.branchId ?? undefined,
        grossAmount: amount.toFixed(2),
        issueDate: formatDateOnly(dto.receivedAt ? new Date(dto.receivedAt) : new Date()),
        categoryId: payable.categoryId ?? order.categoryId ?? undefined,
        costCenterId: payable.costCenterId ?? order.costCenterId ?? undefined,
        paymentMethodId: payable.paymentMethodId ?? order.paymentMethodId ?? undefined,
        // A condição negociada no pedido é a do fornecedor: repeti-la aqui à mão
        // seria a chance de pagar em prazo diferente do combinado (RF-026).
        paymentTermId: payable.paymentTermId ?? order.paymentTermId ?? undefined,
        firstDueDate: payable.firstDueDate,
        installmentCount: payable.installmentCount,
        intervalDays: payable.intervalDays,
        dailyInterestRate: payable.dailyInterestRate,
        penaltyRate: payable.penaltyRate,
      },
      userId,
      {
        origin: ENTRY_ORIGIN.GOODS_RECEIPT,
        originId: receiptId,
        purchaseOrderId: order.id,
        // A nota da entrega, quando informada: é o que liga o pagamento ao
        // documento fiscal que o sustenta (RF-047).
        fiscalDocumentId: dto.fiscalDocumentId,
      },
    );
  }
}
