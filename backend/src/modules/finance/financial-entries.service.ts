import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalStatus, AuditEvent, EntryStatus, EntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { AuditService, AUDIT_ENTITY } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { ReferencesService } from '../../common/references/references.service';
import { formatDateOnly, toDateOnly } from '../../common/utils/date-only';
import { ApprovalThresholdsService } from '../approvals/approval-thresholds.service';
import {
  CreateFinancialEntryDto,
  FinancialEntryInstallmentDto,
} from './dto/create-financial-entry.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import { QueryFinancialEntryDto } from './dto/query-financial-entry.dto';
import {
  ApproveFinancialEntryDto,
  CancelFinancialEntryDto,
  RejectFinancialEntryDto,
} from './dto/review-financial-entry.dto';

/** Operações usadas na consulta de alçadas (RF-012/RF-056). */
export const ENTRY_OPERATION: Record<EntryType, string> = {
  [EntryType.PAGAR]: 'TITULO_PAGAR',
  [EntryType.RECEBER]: 'TITULO_RECEBER',
};

/** Processo que deu causa ao título — `titulo.origem_tipo`. */
export const ENTRY_ORIGIN = {
  MANUAL: 'MANUAL',
  RECURRENCE: 'RECORRENCIA',
  REIMBURSEMENT: 'REEMBOLSO',
  GOODS_RECEIPT: 'RECEBIMENTO',
  /** Título gerado pela própria nota, sem pedido nem conferência (M07). */
  FISCAL_DOCUMENT: 'DOCUMENTO_FISCAL',
} as const;

/**
 * O fato que deu causa ao título (RF-051/RF-052).
 *
 * `originId` é o fato em si — a ocorrência da recorrência, o recebimento da
 * mercadoria. As colunas nomeadas (`recurrenceId`, `purchaseOrderId`) são o
 * vínculo estrutural com o processo, que é o que permite ir do título ao pedido
 * sem passar por um id polimórfico (RF-041).
 */
export interface EntrySource {
  origin: string;
  originId?: string;
  recurrenceId?: string;
  purchaseOrderId?: string;
  fiscalDocumentId?: string;
}

/** Situações em que o título ainda pode ser editado ou liquidado. */
const OPEN_STATUSES: EntryStatus[] = [EntryStatus.ABERTO, EntryStatus.PARCIALMENTE_LIQUIDADO];

const DEFAULT_INTERVAL_DAYS = 30;

const entryInclude = {
  partner: { select: { id: true, legalName: true, tradeName: true } },
  employee: { select: { id: true, registration: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
  category: { select: { id: true, code: true, name: true, type: true } },
  costCenter: { select: { id: true, code: true, name: true } },
  paymentMethod: { select: { id: true, code: true, name: true, method: true } },
  paymentTerm: { select: { id: true, code: true, name: true } },
  installments: {
    orderBy: { number: 'asc' },
    include: {
      settlements: {
        orderBy: { createdAt: 'asc' },
        include: { paymentMethod: { select: { id: true, code: true, name: true } } },
      },
    },
  },
} satisfies Prisma.FinancialEntryInclude;

type EntryRow = Prisma.FinancialEntryGetPayload<{ include: typeof entryInclude }>;

/** Parcela pronta para o INSERT — o que o planejamento produz. */
export interface PlannedInstallment {
  number: number;
  totalInstallments: number;
  dueDate: Date;
  amount: Prisma.Decimal;
  dailyInterestRate: Prisma.Decimal;
  penaltyRate: Prisma.Decimal;
  barcode?: string;
  digitableLine?: string;
  bankIdentifier?: string;
  note?: string;
}

/**
 * Contas a pagar e a receber (RF-051 a RF-058) — `gestao.titulo`.
 *
 * Uma entidade só para as duas carteiras, discriminada por `type`: parcelas,
 * baixas, encargos e aprovação são a mesma mecânica com o fluxo invertido.
 *
 * Três decisões sustentam o módulo:
 *  - o valor líquido e o saldo nunca vêm do cliente: o primeiro é derivado do
 *    bruto menos o desconto, e o segundo é projeção das parcelas (bd/09);
 *  - as parcelas somam exatamente o valor líquido, conferido pelo banco no
 *    commit — o resto da divisão vai para a última parcela, e não some;
 *  - aprovar exige permissão própria, alçada compatível (RN-003) e não ser quem
 *    lançou o título.
 */
@Injectable()
export class FinancialEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
    private readonly thresholds: ApprovalThresholdsService,
    private readonly audit: AuditService,
  ) {}

  async create(companyId: string, dto: CreateFinancialEntryDto, userId: string) {
    return this.createEntry(companyId, dto, userId, { origin: ENTRY_ORIGIN.MANUAL });
  }

  /**
   * Criação a partir de outro processo (recorrência e recebimento de compra
   * hoje; documento fiscal na Sprint 9). `source` deixa registrado o que deu
   * causa ao título — sem isso, um título gerado automaticamente é
   * indistinguível de um lançamento manual na conferência.
   */
  async createEntry(
    companyId: string,
    dto: CreateFinancialEntryDto,
    userId: string,
    source: EntrySource,
  ) {
    await this.assertCounterpart(companyId, dto);
    await this.references.assert(companyId, {
      branchId: dto.branchId,
      categoryId: dto.categoryId,
      costCenterId: dto.costCenterId,
      paymentMethodId: dto.paymentMethodId,
      paymentTermId: dto.paymentTermId,
    });
    await this.assertCategoryMatchesType(companyId, dto.categoryId, dto.type);

    const gross = new Prisma.Decimal(dto.grossAmount);
    const discount = new Prisma.Decimal(dto.discountAmount ?? '0');
    const net = gross.minus(discount);
    if (gross.lessThanOrEqualTo(0)) {
      throw new BadRequestException('O valor bruto do título deve ser maior que zero.');
    }
    if (discount.isNegative() || net.lessThanOrEqualTo(0)) {
      throw new BadRequestException('O desconto deve ser positivo e menor que o valor bruto.');
    }

    const issueDate = dto.issueDate ? toDateOnly(dto.issueDate) : new Date();
    const installments = await this.planInstallments(companyId, dto, net, issueDate);
    const approvalStatus = await this.resolveApprovalStatus(companyId, dto.type, net);

    return this.prisma.transaction(async () => {
      const number = await this.nextNumber(companyId, dto.type);
      const created = await this.prisma.db.financialEntry.create({
        data: {
          companyId,
          type: dto.type,
          number,
          description: dto.description,
          documentReference: dto.documentReference,
          partnerId: dto.partnerId,
          employeeId: dto.employeeId,
          branchId: dto.branchId,
          issueDate,
          competenceDate: dto.competenceDate ? toDateOnly(dto.competenceDate) : issueDate,
          grossAmount: gross,
          discountAmount: discount,
          // Derivado pelo banco; enviado aqui porque a coluna é NOT NULL.
          netAmount: net,
          categoryId: dto.categoryId,
          costCenterId: dto.costCenterId,
          paymentMethodId: dto.paymentMethodId,
          paymentTermId: dto.paymentTermId,
          approvalStatus,
          origin: source.origin,
          originId: source.originId,
          recurrenceId: source.recurrenceId,
          purchaseOrderId: source.purchaseOrderId,
          fiscalDocumentId: source.fiscalDocumentId,
          note: dto.note,
          createdById: userId,
          installments: {
            create: installments.map((installment) => ({
              companyId,
              number: installment.number,
              totalInstallments: installment.totalInstallments,
              dueDate: installment.dueDate,
              amount: installment.amount,
              dailyInterestRate: installment.dailyInterestRate,
              penaltyRate: installment.penaltyRate,
              barcode: installment.barcode,
              digitableLine: installment.digitableLine,
              bankIdentifier: installment.bankIdentifier,
              note: installment.note,
            })),
          },
        },
        select: { id: true },
      });

      return this.findOne(companyId, created.id);
    });
  }

  async findAll(companyId: string, query: QueryFinancialEntryDto) {
    const dueRange = this.dateRange(query.dueFrom, query.dueTo);

    const where: Prisma.FinancialEntryWhereInput = {
      companyId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.approvalStatus ? { approvalStatus: query.approvalStatus } : {}),
      ...(query.partnerId ? { partnerId: query.partnerId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.costCenterId ? { costCenterId: query.costCenterId } : {}),
      ...(this.dateRange(query.issuedFrom, query.issuedTo)
        ? { issueDate: this.dateRange(query.issuedFrom, query.issuedTo) }
        : {}),
      // Vencimento é da parcela: o título "vence" no intervalo se alguma das
      // suas parcelas em aberto vence nele.
      ...(dueRange
        ? {
            installments: {
              some: { dueDate: dueRange, status: { in: ['ABERTA', 'PARCIALMENTE_LIQUIDADA'] } },
            },
          }
        : {}),
      ...(query.openOnly ? { status: { in: OPEN_STATUSES } } : {}),
      ...(query.q
        ? {
            OR: [
              { number: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
              { documentReference: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.financialEntry.findMany({
      where,
      include: entryInclude,
      orderBy: [{ issueDate: 'desc' }, { number: 'desc' }],
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.financialEntry.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string): Promise<EntryRow> {
    const entry = await this.prisma.db.financialEntry.findFirst({
      where: { id, companyId },
      include: entryInclude,
    });
    if (!entry) {
      throw new NotFoundException('Título não encontrado.');
    }
    return entry;
  }

  /**
   * Edita o título (RF-051/RF-054).
   *
   * Alterar valor refaz o parcelamento — as parcelas precisam continuar somando
   * o valor líquido (RF-053), e o banco recusa o contrário no commit. Por isso
   * só é aceito enquanto nada foi liquidado: reescrever a parcela que já
   * recebeu pagamento apagaria o contrato contra o qual ele foi feito.
   */
  async update(companyId: string, id: string, dto: UpdateFinancialEntryDto) {
    const current = await this.findOne(companyId, id);
    this.assertOpen(current);

    await this.references.assert(companyId, {
      branchId: dto.branchId,
      categoryId: dto.categoryId,
      costCenterId: dto.costCenterId,
      paymentMethodId: dto.paymentMethodId,
    });
    await this.assertCategoryMatchesType(companyId, dto.categoryId, current.type);

    const changesValue = dto.grossAmount !== undefined || dto.discountAmount !== undefined;
    const gross =
      dto.grossAmount != null ? new Prisma.Decimal(dto.grossAmount) : current.grossAmount;
    const discount =
      dto.discountAmount != null ? new Prisma.Decimal(dto.discountAmount) : current.discountAmount;
    const net = gross.minus(discount);

    if (changesValue) {
      if (current.settledAmount.greaterThan(0)) {
        throw new ConflictException(
          'O título já tem baixa: estorne a liquidação antes de alterar o valor (RF-057).',
        );
      }
      if (net.lessThanOrEqualTo(0)) {
        throw new BadRequestException('O desconto deve ser menor que o valor bruto.');
      }
    }

    return this.prisma.transaction(async () => {
      await this.prisma.db.financialEntry.update({
        where: { id },
        data: {
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.documentReference !== undefined
            ? { documentReference: dto.documentReference }
            : {}),
          ...(dto.competenceDate ? { competenceDate: toDateOnly(dto.competenceDate) } : {}),
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.costCenterId !== undefined ? { costCenterId: dto.costCenterId } : {}),
          ...(dto.paymentMethodId !== undefined ? { paymentMethodId: dto.paymentMethodId } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...(changesValue ? { grossAmount: gross, discountAmount: discount, netAmount: net } : {}),
        },
      });

      if (changesValue) {
        await this.rebuildInstallments(companyId, current, net);
      }

      return this.findOne(companyId, id);
    });
  }

  /**
   * Cancela o título (RF-051/RF-052).
   *
   * O banco recusa cancelar quem tem baixa não estornada (bd/09): dinheiro que
   * já saiu precisa continuar tendo um título que o explique. As parcelas são
   * canceladas junto — deixá-las abertas manteria o valor na carteira de um
   * título que não existe mais.
   */
  async cancel(companyId: string, id: string, dto: CancelFinancialEntryDto) {
    const current = await this.findOne(companyId, id);
    if (current.status === EntryStatus.CANCELADO) {
      throw new ConflictException('O título já está cancelado.');
    }
    if (current.status === EntryStatus.LIQUIDADO) {
      throw new ConflictException('Título liquidado não é cancelado: estorne as baixas antes.');
    }

    return this.prisma.transaction(async () => {
      await this.prisma.db.financialInstallment.updateMany({
        where: { entryId: id, status: { in: ['ABERTA', 'PARCIALMENTE_LIQUIDADA'] } },
        data: { status: 'CANCELADA' },
      });

      await this.prisma.db.financialEntry.update({
        where: { id },
        data: {
          status: EntryStatus.CANCELADO,
          cancelReason: dto.reason,
          canceledAt: new Date(),
          ...(current.approvalStatus === ApprovalStatus.PENDENTE
            ? { approvalStatus: ApprovalStatus.CANCELADO }
            : {}),
        },
      });

      await this.audit.record({
        event: AuditEvent.CANCELAMENTO,
        entity: AUDIT_ENTITY.FINANCIAL_ENTRY,
        entityId: id,
        note: `Título ${current.number} cancelado: ${dto.reason}`,
      });

      return this.findOne(companyId, id);
    });
  }

  /** Coloca o título na fila de aprovação (RF-056). */
  async submitForApproval(companyId: string, id: string) {
    const current = await this.findOne(companyId, id);
    this.assertOpen(current);

    if (current.approvalStatus !== ApprovalStatus.NAO_REQUERIDA) {
      throw new ConflictException(
        `O título ${current.number} já está com aprovação ${current.approvalStatus}.`,
      );
    }

    await this.prisma.db.financialEntry.update({
      where: { id },
      data: { approvalStatus: ApprovalStatus.PENDENTE },
    });
    return this.findOne(companyId, id);
  }

  async approve(
    companyId: string,
    id: string,
    dto: ApproveFinancialEntryDto,
    approver: AuthenticatedUser,
  ) {
    const current = await this.findOne(companyId, id);
    this.assertPendingApproval(current);
    this.assertNotSelfApproval(current, approver);
    await this.thresholds.assertAuthority(
      companyId,
      approver,
      ENTRY_OPERATION[current.type],
      current.netAmount,
    );

    await this.prisma.db.financialEntry.update({
      where: { id },
      data: {
        approvalStatus: ApprovalStatus.APROVADO,
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });

    // RF-114: aprovação é decisão, não DML própria — o trigger não a distingue
    // de uma edição qualquer, e por isso ela vai à trilha explicitamente.
    await this.audit.record({
      event: AuditEvent.APROVACAO,
      entity: AUDIT_ENTITY.FINANCIAL_ENTRY,
      entityId: id,
      note: `Título ${current.number} aprovado por ${current.netAmount.toFixed(2)}.`,
    });

    return this.findOne(companyId, id);
  }

  async reject(
    companyId: string,
    id: string,
    dto: RejectFinancialEntryDto,
    approver: AuthenticatedUser,
  ) {
    const current = await this.findOne(companyId, id);
    this.assertPendingApproval(current);
    this.assertNotSelfApproval(current, approver);

    await this.prisma.db.financialEntry.update({
      where: { id },
      data: { approvalStatus: ApprovalStatus.REPROVADO, note: dto.reason },
    });

    await this.audit.record({
      event: AuditEvent.REPROVACAO,
      entity: AUDIT_ENTITY.FINANCIAL_ENTRY,
      entityId: id,
      note: `Título ${current.number} reprovado: ${dto.reason}`,
    });

    return this.findOne(companyId, id);
  }

  /**
   * Distribui o valor líquido entre as parcelas (RF-053).
   *
   * Exposto e puro porque é a regra que mais erra em silêncio: 1.000,00 em três
   * parcelas dá 333,33 três vezes, e um centavo evapora. O resto vai para a
   * última parcela — que é onde o cliente espera encontrá-lo, e é o que faz a
   * soma bater com o título (conferido pelo banco no commit).
   */
  planEqualInstallments(
    net: Prisma.Decimal,
    count: number,
    firstDueDate: Date,
    intervalDays: number,
    rates: { dailyInterestRate: Prisma.Decimal; penaltyRate: Prisma.Decimal },
  ): PlannedInstallment[] {
    const base = net.dividedBy(count).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);

    return Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      totalInstallments: count,
      dueDate: this.addDays(firstDueDate, index * intervalDays),
      amount: index === count - 1 ? net.minus(base.times(count - 1)) : base,
      ...rates,
    }));
  }

  /** Número sequencial por empresa, tipo e ano, serializado no banco (bd/09). */
  private async nextNumber(companyId: string, type: EntryType): Promise<string> {
    const [row] = await this.prisma.db.$queryRaw<{ numero: string }[]>`
      SELECT fn_proximo_numero_titulo(${companyId}::uuid, ${type}::enum_tipo_titulo) AS numero
    `;
    return row.numero;
  }

  private async planInstallments(
    companyId: string,
    dto: CreateFinancialEntryDto,
    net: Prisma.Decimal,
    issueDate: Date,
  ): Promise<PlannedInstallment[]> {
    const rates = {
      dailyInterestRate: new Prisma.Decimal(dto.dailyInterestRate ?? '0'),
      penaltyRate: new Prisma.Decimal(dto.penaltyRate ?? '0'),
    };

    if (dto.installments?.length) {
      return this.planExplicitInstallments(dto.installments, net, rates);
    }

    // A condição de pagamento define o *parcelamento* (RF-026). O desconto dela
    // não é aplicado sozinho: o valor cobrado é o que quem lançou digitou, e
    // dinheiro que muda sem ninguém pedir é defeito, não conveniência.
    if (dto.paymentTermId) {
      const term = await this.prisma.db.paymentTerm.findFirst({
        where: { id: dto.paymentTermId, companyId },
        select: { installments: true, intervalDays: true, firstDueDays: true },
      });
      if (!term) {
        throw new BadRequestException('Condição de pagamento inválida para esta empresa.');
      }
      return this.planEqualInstallments(
        net,
        term.installments,
        this.addDays(issueDate, term.firstDueDays),
        term.intervalDays,
        rates,
      );
    }

    const count = dto.installmentCount ?? 1;
    const firstDue = dto.firstDueDate ? toDateOnly(dto.firstDueDate) : issueDate;
    return this.planEqualInstallments(
      net,
      count,
      firstDue,
      dto.intervalDays ?? DEFAULT_INTERVAL_DAYS,
      rates,
    );
  }

  private planExplicitInstallments(
    items: FinancialEntryInstallmentDto[],
    net: Prisma.Decimal,
    rates: { dailyInterestRate: Prisma.Decimal; penaltyRate: Prisma.Decimal },
  ): PlannedInstallment[] {
    const planned = items.map((item, index) => {
      const amount = new Prisma.Decimal(item.amount);
      if (amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException('O valor de cada parcela deve ser maior que zero.');
      }
      return {
        number: index + 1,
        totalInstallments: items.length,
        dueDate: toDateOnly(item.dueDate),
        amount,
        dailyInterestRate:
          item.dailyInterestRate != null
            ? new Prisma.Decimal(item.dailyInterestRate)
            : rates.dailyInterestRate,
        penaltyRate:
          item.penaltyRate != null ? new Prisma.Decimal(item.penaltyRate) : rates.penaltyRate,
        barcode: item.barcode,
        digitableLine: item.digitableLine,
        bankIdentifier: item.bankIdentifier,
        note: item.note,
      };
    });

    const sum = planned.reduce((total, item) => total.plus(item.amount), new Prisma.Decimal(0));
    if (!sum.equals(net)) {
      throw new BadRequestException(
        `As parcelas somam ${sum.toFixed(2)} e o valor líquido do título é ${net.toFixed(2)} (RF-053).`,
      );
    }

    return planned;
  }

  /** Refaz o parcelamento preservando prazos, quando o valor do título muda. */
  private async rebuildInstallments(companyId: string, current: EntryRow, net: Prisma.Decimal) {
    const first = current.installments[0];
    await this.prisma.db.financialInstallment.deleteMany({ where: { entryId: current.id } });

    const planned = this.planEqualInstallments(
      net,
      current.installments.length || 1,
      first?.dueDate ?? current.issueDate,
      this.intervalBetween(current),
      {
        dailyInterestRate: first?.dailyInterestRate ?? new Prisma.Decimal(0),
        penaltyRate: first?.penaltyRate ?? new Prisma.Decimal(0),
      },
    );

    await this.prisma.db.financialInstallment.createMany({
      data: planned.map((installment) => ({
        companyId,
        entryId: current.id,
        number: installment.number,
        totalInstallments: installment.totalInstallments,
        dueDate: installment.dueDate,
        amount: installment.amount,
        dailyInterestRate: installment.dailyInterestRate,
        penaltyRate: installment.penaltyRate,
      })),
    });
  }

  /** Intervalo observado no parcelamento atual — mantém o ritmo já combinado. */
  private intervalBetween(entry: EntryRow): number {
    const [first, second] = entry.installments;
    if (!first || !second) return DEFAULT_INTERVAL_DAYS;
    const days = Math.round(
      (second.dueDate.getTime() - first.dueDate.getTime()) / (24 * 60 * 60 * 1000),
    );
    return days > 0 ? days : DEFAULT_INTERVAL_DAYS;
  }

  /**
   * RF-056: acima da alçada configurada para a operação, o título nasce
   * pendente — e o banco recusa baixá-lo antes da decisão (bd/09).
   */
  private async resolveApprovalStatus(
    companyId: string,
    type: EntryType,
    net: Prisma.Decimal,
  ): Promise<ApprovalStatus> {
    const evaluation = await this.thresholds.evaluate(
      companyId,
      ENTRY_OPERATION[type],
      net.toFixed(2),
    );
    return evaluation.requiresApproval ? ApprovalStatus.PENDENTE : ApprovalStatus.NAO_REQUERIDA;
  }

  /**
   * A contraparte é obrigatória e tem papel (RF-022/RF-023): título a receber é
   * emitido contra cliente, e a pagar, contra fornecedor. O banco exige que ao
   * menos um dos dois exista (`ck_titulo_credor`); o papel é conferido aqui.
   */
  private async assertCounterpart(companyId: string, dto: CreateFinancialEntryDto) {
    if (!dto.partnerId && !dto.employeeId) {
      throw new BadRequestException(
        'Informe o parceiro ou o funcionário a quem o título se refere.',
      );
    }

    await this.references.assert(companyId, {
      employeeId: dto.employeeId,
      ...(dto.partnerId
        ? dto.type === EntryType.RECEBER
          ? { customerId: dto.partnerId }
          : { supplierId: dto.partnerId }
        : {}),
    });
  }

  /**
   * RF-054: a categoria financeira tem natureza (`PAGAR`/`RECEBER`). Classificar
   * uma despesa numa categoria de receita inverte o sinal do resultado
   * gerencial — e o erro só aparece no fechamento.
   */
  private async assertCategoryMatchesType(
    companyId: string,
    categoryId: string | undefined,
    type: EntryType,
  ) {
    if (!categoryId) return;

    const category = await this.prisma.db.category.findFirst({
      where: { id: categoryId, companyId },
      select: { type: true, name: true, acceptsEntry: true },
    });
    if (!category) return; // já validado por ReferencesService

    if (category.type !== type) {
      throw new BadRequestException(
        `A categoria "${category.name}" é de ${category.type} e não classifica um título a ${type}.`,
      );
    }
    if (!category.acceptsEntry) {
      throw new BadRequestException(
        `A categoria "${category.name}" é sintética e não aceita lançamento direto.`,
      );
    }
  }

  private assertOpen(entry: EntryRow) {
    if (!OPEN_STATUSES.includes(entry.status)) {
      throw new ConflictException(
        `O título ${entry.number} está ${entry.status} e não é editável.`,
      );
    }
  }

  private assertPendingApproval(entry: EntryRow) {
    if (entry.approvalStatus !== ApprovalStatus.PENDENTE) {
      throw new ConflictException(
        `O título ${entry.number} não está aguardando aprovação (situação: ${entry.approvalStatus}).`,
      );
    }
  }

  /**
   * RN-003: quem lançou não decide. O título a pagar é o ponto onde uma despesa
   * inventada vira dinheiro saindo — a segregação vale mais aqui do que em
   * qualquer outro cadastro.
   */
  private assertNotSelfApproval(entry: EntryRow, approver: AuthenticatedUser) {
    if (entry.createdById && entry.createdById === approver.id && !approver.isSuperAdmin) {
      throw new ForbiddenException('Quem lançou o título não pode aprová-lo (RN-003).');
    }
  }

  /** Intervalo inclusivo nos dois extremos: são colunas `date`, não instantes. */
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

  /** Datas de vencimento são dias civis: a soma é feita em UTC, sem fuso. */
  private addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }
}
