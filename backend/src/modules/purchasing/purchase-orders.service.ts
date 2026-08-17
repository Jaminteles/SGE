import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalStatus, AuditEvent, EntryType, Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { AuditService, AUDIT_ENTITY } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { ReferencesService } from '../../common/references/references.service';
import { formatDateOnly, toDateOnly } from '../../common/utils/date-only';
import { ApprovalThresholdsService } from '../approvals/approval-thresholds.service';
import { CreatePurchaseOrderDto, PurchaseOrderItemDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import {
  ApprovePurchaseOrderDto,
  CancelPurchaseOrderDto,
  RejectPurchaseOrderDto,
} from './dto/review-purchase-order.dto';

/** Operação usada na consulta de alçadas (RF-012/RF-038). */
export const PURCHASE_OPERATION = 'PEDIDO_COMPRA';

/** Situações em que o pedido ainda pode receber mercadoria (RF-039). */
export const RECEIVABLE_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.APROVADO,
  PurchaseOrderStatus.PARCIALMENTE_RECEBIDO,
];

const orderInclude = {
  partner: { select: { id: true, legalName: true, tradeName: true } },
  branch: { select: { id: true, code: true, name: true } },
  buyer: { select: { id: true, registration: true, name: true } },
  requester: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  category: { select: { id: true, code: true, name: true, type: true } },
  costCenter: { select: { id: true, code: true, name: true } },
  paymentTerm: { select: { id: true, code: true, name: true } },
  paymentMethod: { select: { id: true, code: true, name: true, method: true } },
  items: {
    orderBy: { sequence: 'asc' },
    include: {
      product: { select: { id: true, code: true, description: true, tracksStock: true } },
      location: { select: { id: true, code: true, name: true } },
      costCenter: { select: { id: true, code: true, name: true } },
    },
  },
  receipts: {
    orderBy: { receivedAt: 'desc' },
    select: {
      id: true,
      number: true,
      receivedAt: true,
      hasDivergence: true,
      generatedStock: true,
      generatedPayable: true,
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

export type PurchaseOrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;

/** Item pronto para o INSERT — a empresa e o pedido são acrescentados na escrita. */
type PlannedItem = Omit<Prisma.PurchaseOrderItemCreateManyInput, 'companyId' | 'orderId'>;

/**
 * Pedidos de compra (RF-036 a RF-038, RF-041) — `gestao.pedido_compra`.
 *
 * Três decisões sustentam o módulo:
 *  - o total nunca vem do cliente: é a soma dos itens mais frete, seguro e
 *    despesas, rateados linha a linha pelo banco (bd/11) — é esse rateio que faz
 *    a entrada de estoque valer o custo posto, e não só o preço da mercadoria;
 *  - item só muda em rascunho: aprovar um pedido cujos itens ainda podem mudar
 *    não é aprovar nada, e a alçada passaria a valer sobre um valor que já não
 *    existe;
 *  - aprovar exige permissão própria, alçada compatível (RN-003) e não ser quem
 *    pediu — é no pedido que uma compra desnecessária vira dinheiro
 *    comprometido.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
    private readonly thresholds: ApprovalThresholdsService,
    private readonly audit: AuditService,
  ) {}

  async create(companyId: string, dto: CreatePurchaseOrderDto, userId: string) {
    await this.assertReferences(companyId, dto);
    await this.assertCategoryIsPayable(companyId, dto.categoryId);

    const orderDate = dto.orderDate ? toDateOnly(dto.orderDate) : new Date();
    const expectedDate = dto.expectedDate ? toDateOnly(dto.expectedDate) : undefined;
    if (expectedDate && expectedDate < orderDate) {
      throw new BadRequestException('A previsão de entrega não pode ser anterior ao pedido.');
    }

    const items = await this.planItems(companyId, dto.items);

    return this.prisma.transaction(async () => {
      const number = await this.nextNumber(companyId);
      const created = await this.prisma.db.purchaseOrder.create({
        data: {
          companyId,
          number,
          partnerId: dto.partnerId,
          branchId: dto.branchId,
          buyerId: dto.buyerId,
          requesterId: userId,
          orderDate,
          expectedDate,
          paymentTermId: dto.paymentTermId,
          paymentMethodId: dto.paymentMethodId,
          costCenterId: dto.costCenterId,
          categoryId: dto.categoryId,
          discountAmount: new Prisma.Decimal(dto.discountAmount ?? '0'),
          freightAmount: new Prisma.Decimal(dto.freightAmount ?? '0'),
          insuranceAmount: new Prisma.Decimal(dto.insuranceAmount ?? '0'),
          otherExpenseAmount: new Prisma.Decimal(dto.otherExpenseAmount ?? '0'),
          note: dto.note,
          createdById: userId,
          items: { create: items.map((item) => ({ companyId, ...item })) },
        },
        select: { id: true },
      });

      return this.findOne(companyId, created.id);
    });
  }

  async findAll(companyId: string, query: QueryPurchaseOrderDto) {
    const period = this.dateRange(query.from, query.to);

    const where: Prisma.PurchaseOrderWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.approvalStatus ? { approvalStatus: query.approvalStatus } : {}),
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(period ? { orderDate: period } : {}),
      ...(query.pendingReceiptOnly ? { status: { in: RECEIVABLE_STATUSES } } : {}),
      ...(query.q
        ? {
            OR: [
              { number: { contains: query.q, mode: 'insensitive' } },
              { note: { contains: query.q, mode: 'insensitive' } },
              { partner: { legalName: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.purchaseOrder.findMany({
      where,
      include: orderInclude,
      orderBy: [{ orderDate: 'desc' }, { number: 'desc' }],
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.purchaseOrder.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string): Promise<PurchaseOrderRow> {
    const order = await this.prisma.db.purchaseOrder.findFirst({
      where: { id, companyId },
      include: orderInclude,
    });
    if (!order) {
      throw new NotFoundException('Pedido de compra não encontrado.');
    }
    return order;
  }

  /** Edição do rascunho (RF-036/RF-037). Informar `items` substitui a lista. */
  async update(companyId: string, id: string, dto: UpdatePurchaseOrderDto) {
    const current = await this.findOne(companyId, id);
    this.assertDraft(current);

    await this.assertReferences(companyId, dto);
    await this.assertCategoryIsPayable(companyId, dto.categoryId);

    const items = dto.items ? await this.planItems(companyId, dto.items) : undefined;

    return this.prisma.transaction(async () => {
      // Os itens são trocados antes do cabeçalho: o rateio das despesas é
      // refeito pelo banco na última escrita, e assim ele enxerga a lista nova.
      if (items) {
        await this.prisma.db.purchaseOrderItem.deleteMany({ where: { orderId: id } });
        await this.prisma.db.purchaseOrderItem.createMany({
          data: items.map((item) => ({ companyId, orderId: id, ...item })),
        });
      }

      await this.prisma.db.purchaseOrder.update({
        where: { id },
        data: {
          ...(dto.partnerId !== undefined ? { partnerId: dto.partnerId } : {}),
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(dto.buyerId !== undefined ? { buyerId: dto.buyerId } : {}),
          ...(dto.orderDate ? { orderDate: toDateOnly(dto.orderDate) } : {}),
          ...(dto.expectedDate !== undefined
            ? { expectedDate: dto.expectedDate ? toDateOnly(dto.expectedDate) : null }
            : {}),
          ...(dto.paymentTermId !== undefined ? { paymentTermId: dto.paymentTermId } : {}),
          ...(dto.paymentMethodId !== undefined ? { paymentMethodId: dto.paymentMethodId } : {}),
          ...(dto.costCenterId !== undefined ? { costCenterId: dto.costCenterId } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...(dto.discountAmount !== undefined
            ? { discountAmount: new Prisma.Decimal(dto.discountAmount) }
            : {}),
          ...(dto.freightAmount !== undefined
            ? { freightAmount: new Prisma.Decimal(dto.freightAmount) }
            : {}),
          ...(dto.insuranceAmount !== undefined
            ? { insuranceAmount: new Prisma.Decimal(dto.insuranceAmount) }
            : {}),
          ...(dto.otherExpenseAmount !== undefined
            ? { otherExpenseAmount: new Prisma.Decimal(dto.otherExpenseAmount) }
            : {}),
        },
      });

      return this.findOne(companyId, id);
    });
  }

  /**
   * Fecha o rascunho (RF-038).
   *
   * Abaixo da alçada configurada para a operação, o pedido é aprovado na hora:
   * exigir a cerimônia de aprovação para toda compra transformaria o controle em
   * carimbo. Acima dela, fica aguardando decisão — e o banco recusa recebimento
   * até lá (bd/11).
   */
  async submitForApproval(companyId: string, id: string) {
    const current = await this.findOne(companyId, id);
    this.assertDraft(current);

    if (current.items.length === 0) {
      throw new BadRequestException('O pedido precisa de ao menos um item (RF-037).');
    }

    const evaluation = await this.thresholds.evaluate(
      companyId,
      PURCHASE_OPERATION,
      current.totalAmount.toFixed(2),
    );

    await this.prisma.db.purchaseOrder.update({
      where: { id },
      data: evaluation.requiresApproval
        ? {
            status: PurchaseOrderStatus.AGUARDANDO_APROVACAO,
            approvalStatus: ApprovalStatus.PENDENTE,
          }
        : {
            status: PurchaseOrderStatus.APROVADO,
            approvalStatus: ApprovalStatus.NAO_REQUERIDA,
          },
    });

    return this.findOne(companyId, id);
  }

  async approve(
    companyId: string,
    id: string,
    dto: ApprovePurchaseOrderDto,
    approver: AuthenticatedUser,
  ) {
    const current = await this.findOne(companyId, id);
    this.assertPendingApproval(current);
    this.assertNotSelfApproval(current, approver);
    await this.thresholds.assertAuthority(
      companyId,
      approver,
      PURCHASE_OPERATION,
      current.totalAmount,
    );

    await this.prisma.db.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.APROVADO,
        approvalStatus: ApprovalStatus.APROVADO,
        approvedById: approver.id,
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });

    // RF-114: aprovação é decisão, não DML própria — o trigger de auditoria não
    // a distingue de uma edição qualquer, e por isso ela vai à trilha aqui.
    await this.audit.record({
      event: AuditEvent.APROVACAO,
      entity: AUDIT_ENTITY.PURCHASE_ORDER,
      entityId: id,
      note: `Pedido ${current.number} aprovado por ${current.totalAmount.toFixed(2)}.`,
    });

    return this.findOne(companyId, id);
  }

  async reject(
    companyId: string,
    id: string,
    dto: RejectPurchaseOrderDto,
    approver: AuthenticatedUser,
  ) {
    const current = await this.findOne(companyId, id);
    this.assertPendingApproval(current);
    this.assertNotSelfApproval(current, approver);

    await this.prisma.db.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.REPROVADO,
        approvalStatus: ApprovalStatus.REPROVADO,
        approvedById: approver.id,
      },
    });

    // O motivo não tem coluna no pedido: fica na trilha, que é onde a decisão
    // (e quem a tomou) já mora.
    await this.audit.record({
      event: AuditEvent.REPROVACAO,
      entity: AUDIT_ENTITY.PURCHASE_ORDER,
      entityId: id,
      note: `Pedido ${current.number} reprovado: ${dto.reason}`,
    });

    return this.findOne(companyId, id);
  }

  /**
   * Cancela o pedido (RF-036).
   *
   * O banco recusa cancelar quem já recebeu mercadoria (bd/11): o que chegou
   * está no estoque e precisa continuar tendo um pedido que o explique (RN-009).
   */
  async cancel(companyId: string, id: string, dto: CancelPurchaseOrderDto) {
    const current = await this.findOne(companyId, id);
    if (current.status === PurchaseOrderStatus.CANCELADO) {
      throw new ConflictException('O pedido já está cancelado.');
    }
    if (current.receipts.length > 0) {
      throw new ConflictException(
        `O pedido ${current.number} já teve entrega registrada e não é cancelado (RF-039).`,
      );
    }

    return this.prisma.transaction(async () => {
      await this.prisma.db.purchaseOrder.update({
        where: { id },
        data: {
          status: PurchaseOrderStatus.CANCELADO,
          cancelReason: dto.reason,
          canceledAt: new Date(),
          ...(current.approvalStatus === ApprovalStatus.PENDENTE
            ? { approvalStatus: ApprovalStatus.CANCELADO }
            : {}),
        },
      });

      await this.audit.record({
        event: AuditEvent.CANCELAMENTO,
        entity: AUDIT_ENTITY.PURCHASE_ORDER,
        entityId: id,
        note: `Pedido ${current.number} cancelado: ${dto.reason}`,
      });

      return this.findOne(companyId, id);
    });
  }

  /** Pedido pronto para receber mercadoria — usado pelo recebimento (RF-039). */
  async findReceivable(companyId: string, id: string): Promise<PurchaseOrderRow> {
    const order = await this.findOne(companyId, id);
    if (!RECEIVABLE_STATUSES.includes(order.status)) {
      throw new ConflictException(
        `O pedido ${order.number} está ${order.status} e não aceita recebimento (RF-038/RF-039).`,
      );
    }
    return order;
  }

  /** Número sequencial por empresa e ano, serializado no banco (bd/11). */
  private async nextNumber(companyId: string): Promise<string> {
    const [row] = await this.prisma.db.$queryRaw<{ numero: string }[]>`
      SELECT fn_proximo_numero_pedido_compra(${companyId}::uuid) AS numero
    `;
    return row.numero;
  }

  /**
   * Monta os itens do pedido (RF-037).
   *
   * `lineAmount` é enviado porque a coluna é NOT NULL, mas quem manda é o banco:
   * o trigger o recalcula na gravação. A conta aqui existe para recusar o
   * desconto maior que a linha com 400, e não com 500 de violação de regra.
   */
  private async planItems(companyId: string, items: PurchaseOrderItemDto[]) {
    const planned: PlannedItem[] = [];

    for (const [index, item] of items.entries()) {
      const quantity = new Prisma.Decimal(item.quantity);
      const unitPrice = new Prisma.Decimal(item.unitPrice);
      const discount = new Prisma.Decimal(item.discountAmount ?? '0');

      if (quantity.lessThanOrEqualTo(0)) {
        throw new BadRequestException(`A quantidade do item ${index + 1} deve ser maior que zero.`);
      }
      if (unitPrice.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          `O preço unitário do item ${index + 1} deve ser maior que zero (RF-037).`,
        );
      }

      const gross = quantity.times(unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (discount.greaterThan(gross)) {
        throw new BadRequestException(
          `O desconto do item ${index + 1} supera o valor da linha (RF-037).`,
        );
      }

      const description = await this.resolveDescription(companyId, item, index);
      await this.references.assert(companyId, {
        productId: item.productId,
        costCenterId: item.costCenterId,
        stockLocationId: item.locationId,
      });

      planned.push({
        sequence: index + 1,
        productId: item.productId,
        description,
        quantity,
        unitPrice,
        discountAmount: discount,
        lineAmount: gross.minus(discount),
        costCenterId: item.costCenterId,
        locationId: item.locationId,
        note: item.note,
      });
    }

    return planned;
  }

  /** Sem produto, a descrição é obrigatória: linha sem nome não se confere. */
  private async resolveDescription(
    companyId: string,
    item: PurchaseOrderItemDto,
    index: number,
  ): Promise<string> {
    if (item.description) return item.description;

    if (!item.productId) {
      throw new BadRequestException(`Informe a descrição do item ${index + 1} (RF-037).`);
    }

    const product = await this.prisma.db.product.findFirst({
      where: { id: item.productId, companyId },
      select: { description: true },
    });
    if (!product) {
      throw new BadRequestException('Produto inválido para esta empresa.');
    }
    return product.description;
  }

  private async assertReferences(
    companyId: string,
    dto: CreatePurchaseOrderDto | UpdatePurchaseOrderDto,
  ) {
    await this.references.assert(companyId, {
      // Papel, e não só existência: pedido emitido contra quem nunca foi
      // fornecedor é erro de cadastro, não de digitação (RF-023).
      supplierId: dto.partnerId,
      branchId: dto.branchId,
      employeeId: dto.buyerId,
      costCenterId: dto.costCenterId,
      categoryId: dto.categoryId,
      paymentTermId: dto.paymentTermId,
      paymentMethodId: dto.paymentMethodId,
    });
  }

  /**
   * A categoria classifica o título que a compra vai gerar (RF-041/RF-054): uma
   * categoria de receita numa compra inverte o sinal do resultado gerencial, e o
   * erro só aparece no fechamento.
   */
  private async assertCategoryIsPayable(companyId: string, categoryId?: string) {
    if (!categoryId) return;

    const category = await this.prisma.db.category.findFirst({
      where: { id: categoryId, companyId },
      select: { type: true, name: true, acceptsEntry: true },
    });
    if (!category) return; // já validado por ReferencesService

    if (category.type !== EntryType.PAGAR) {
      throw new BadRequestException(
        `A categoria "${category.name}" é de ${category.type} e não classifica uma compra.`,
      );
    }
    if (!category.acceptsEntry) {
      throw new BadRequestException(
        `A categoria "${category.name}" é sintética e não aceita lançamento direto.`,
      );
    }
  }

  private assertDraft(order: PurchaseOrderRow) {
    if (order.status !== PurchaseOrderStatus.RASCUNHO) {
      throw new ConflictException(
        `O pedido ${order.number} está ${order.status} e não é mais editável (RF-038).`,
      );
    }
  }

  private assertPendingApproval(order: PurchaseOrderRow) {
    if (order.approvalStatus !== ApprovalStatus.PENDENTE) {
      throw new ConflictException(
        `O pedido ${order.number} não está aguardando aprovação (situação: ${order.approvalStatus}).`,
      );
    }
  }

  /** RN-003: quem pediu não decide sobre o próprio pedido. */
  private assertNotSelfApproval(order: PurchaseOrderRow, approver: AuthenticatedUser) {
    const requester = order.requesterId ?? order.createdById;
    if (requester && requester === approver.id && !approver.isSuperAdmin) {
      throw new ForbiddenException('Quem solicitou a compra não pode aprová-la (RN-003).');
    }
  }

  /** Intervalo inclusivo nos dois extremos: `data_pedido` é coluna `date`. */
  private dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
    if (!from && !to) return undefined;

    const start = from ? toDateOnly(from) : undefined;
    const end = to ? toDateOnly(to) : undefined;
    if (start && end && start > end) {
      throw new BadRequestException(
        `O início do período (${formatDateOnly(start)}) não pode ser posterior ao fim.`,
      );
    }
    return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
  }
}
