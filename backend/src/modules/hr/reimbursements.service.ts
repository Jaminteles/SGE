import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditEvent, Prisma, ReimbursementStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { AuditService, AUDIT_ENTITY } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { toDateOnly } from '../../common/utils/date-only';
import { ApprovalThresholdsService } from '../approvals/approval-thresholds.service';
import { ReferencesService } from '../../common/references/references.service';
import { CreateReimbursementDto, ReimbursementItemDto } from './dto/create-reimbursement.dto';
import { QueryReimbursementDto } from './dto/query-reimbursement.dto';
import { ApproveReimbursementDto, RejectReimbursementDto } from './dto/review-reimbursement.dto';

/** Operação usada na consulta de alçadas (RF-012/RN-003). */
export const REIMBURSEMENT_OPERATION = 'REEMBOLSO';

/**
 * Transições permitidas (RF-018). O que não está aqui é recusado — inclusive a
 * ida direta de RASCUNHO para APROVADO, que puliria a solicitação.
 *
 * `PAGO` só é alcançado pela liquidação financeira (M08, sprint futura): esta
 * API não expõe a transição, e o banco exige aprovação antes dela.
 */
const TRANSITIONS: Record<ReimbursementStatus, ReimbursementStatus[]> = {
  RASCUNHO: [ReimbursementStatus.SOLICITADO, ReimbursementStatus.CANCELADO],
  SOLICITADO: [
    ReimbursementStatus.EM_ANALISE,
    ReimbursementStatus.APROVADO,
    ReimbursementStatus.REPROVADO,
    ReimbursementStatus.CANCELADO,
  ],
  EM_ANALISE: [
    ReimbursementStatus.APROVADO,
    ReimbursementStatus.REPROVADO,
    ReimbursementStatus.CANCELADO,
  ],
  APROVADO: [ReimbursementStatus.PAGO, ReimbursementStatus.CANCELADO],
  REPROVADO: [],
  PAGO: [],
  CANCELADO: [],
};

const reimbursementInclude = {
  employee: { select: { id: true, registration: true, name: true, userId: true } },
  items: {
    orderBy: { expenseDate: 'asc' },
    include: {
      document: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
    },
  },
} satisfies Prisma.ReimbursementInclude;

type ReimbursementRow = Prisma.ReimbursementGetPayload<{ include: typeof reimbursementInclude }>;

/**
 * Despesas e reembolsos (RF-018) — `gestao.reembolso`.
 *
 * Três decisões sustentam o módulo:
 *  - o valor total nunca vem do cliente: é a soma dos itens, recalculada pelo
 *    banco a cada alteração (bd/06);
 *  - o número é sequencial por empresa, gerado dentro da transação;
 *  - aprovar exige permissão própria, alçada compatível com o valor (RN-003) e
 *    não ser o solicitante — as três verificadas aqui, e as duas últimas
 *    também no banco.
 */
@Injectable()
export class ReimbursementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
    private readonly thresholds: ApprovalThresholdsService,
    private readonly audit: AuditService,
  ) {}

  async create(companyId: string, dto: CreateReimbursementDto) {
    await this.references.assert(companyId, {
      employeeId: dto.employeeId,
      branchId: dto.branchId,
      costCenterId: dto.costCenterId,
    });
    for (const item of dto.items) {
      this.assertItemAmount(item);
      await this.references.assert(companyId, {
        categoryId: item.categoryId,
        costCenterId: item.costCenterId,
      });
    }

    return this.prisma.transaction(async () => {
      const number = await this.nextNumber(companyId);
      const created = await this.prisma.db.reimbursement.create({
        data: {
          companyId,
          employeeId: dto.employeeId,
          branchId: dto.branchId,
          costCenterId: dto.costCenterId,
          number,
          description: dto.description,
          note: dto.note,
          items: {
            create: dto.items.map((item) => ({
              companyId,
              description: item.description,
              expenseDate: toDateOnly(item.expenseDate),
              amount: new Prisma.Decimal(item.amount),
              categoryId: item.categoryId,
              costCenterId: item.costCenterId,
              note: item.note,
            })),
          },
        },
        select: { id: true },
      });
      // O total foi recalculado pelo trigger; a leitura abaixo já traz o valor.
      return this.findOne(companyId, created.id);
    });
  }

  async findAll(companyId: string, query: QueryReimbursementDto) {
    const where: Prisma.ReimbursementWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.from || query.to
        ? {
            requestDate: {
              ...(query.from ? { gte: toDateOnly(query.from) } : {}),
              ...(query.to ? { lte: toDateOnly(query.to) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { number: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.reimbursement.findMany({
      where,
      include: reimbursementInclude,
      orderBy: [{ requestDate: 'desc' }, { number: 'desc' }],
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.reimbursement.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string): Promise<ReimbursementRow> {
    const reimbursement = await this.prisma.db.reimbursement.findFirst({
      where: { id, companyId },
      include: reimbursementInclude,
    });
    if (!reimbursement) {
      throw new NotFoundException('Reembolso não encontrado.');
    }
    return reimbursement;
  }

  /** Envia para análise (RF-018). Sem comprovante não há o que analisar (RF-019). */
  async submit(companyId: string, id: string) {
    const current = await this.findOne(companyId, id);
    this.assertTransition(current.status, ReimbursementStatus.SOLICITADO);

    if (current.items.length === 0) {
      throw new BadRequestException('Inclua ao menos uma despesa antes de solicitar.');
    }
    const withoutReceipt = current.items.filter((item) => !item.documentId);
    if (withoutReceipt.length > 0) {
      throw new BadRequestException(
        `Anexe o comprovante de todas as despesas (${withoutReceipt.length} pendente(s)).`,
      );
    }

    await this.prisma.db.reimbursement.update({
      where: { id },
      data: { status: ReimbursementStatus.SOLICITADO },
    });
    return this.findOne(companyId, id);
  }

  /** Coloca em análise, sem decidir ainda — mantém o rastro de quem examinou. */
  async startReview(companyId: string, id: string) {
    const current = await this.findOne(companyId, id);
    this.assertTransition(current.status, ReimbursementStatus.EM_ANALISE);

    await this.prisma.db.reimbursement.update({
      where: { id },
      data: { status: ReimbursementStatus.EM_ANALISE },
    });
    return this.findOne(companyId, id);
  }

  async approve(
    companyId: string,
    id: string,
    dto: ApproveReimbursementDto,
    approver: AuthenticatedUser,
  ) {
    const current = await this.findOne(companyId, id);
    this.assertTransition(current.status, ReimbursementStatus.APROVADO);
    this.assertNotSelfApproval(current, approver.id);

    const approvedAmount =
      dto.approvedAmount != null ? new Prisma.Decimal(dto.approvedAmount) : current.totalAmount;
    if (approvedAmount.isNegative() || approvedAmount.greaterThan(current.totalAmount)) {
      throw new BadRequestException('O valor aprovado deve estar entre zero e o total solicitado.');
    }

    await this.thresholds.assertAuthority(
      companyId,
      approver,
      REIMBURSEMENT_OPERATION,
      approvedAmount,
    );

    await this.prisma.db.reimbursement.update({
      where: { id },
      data: {
        status: ReimbursementStatus.APROVADO,
        approvedAmount,
        approvedBy: approver.id,
        approvedAt: new Date(),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    });

    // RF-114: aprovação não nasce de DML própria — é decisão, e vai à trilha.
    await this.audit.record({
      event: AuditEvent.APROVACAO,
      entity: AUDIT_ENTITY.REIMBURSEMENT,
      entityId: id,
      note: `Reembolso ${current.number} aprovado por ${approvedAmount.toFixed(2)}.`,
    });

    return this.findOne(companyId, id);
  }

  async reject(
    companyId: string,
    id: string,
    dto: RejectReimbursementDto,
    approver: AuthenticatedUser,
  ) {
    const current = await this.findOne(companyId, id);
    this.assertTransition(current.status, ReimbursementStatus.REPROVADO);
    this.assertNotSelfApproval(current, approver.id);

    await this.prisma.db.reimbursement.update({
      where: { id },
      data: {
        status: ReimbursementStatus.REPROVADO,
        approvedAmount: new Prisma.Decimal(0),
        approvedBy: approver.id,
        approvedAt: new Date(),
        note: dto.reason,
      },
    });

    await this.audit.record({
      event: AuditEvent.REPROVACAO,
      entity: AUDIT_ENTITY.REIMBURSEMENT,
      entityId: id,
      note: `Reembolso ${current.number} reprovado: ${dto.reason}`,
    });

    return this.findOne(companyId, id);
  }

  async cancel(companyId: string, id: string, reason?: string) {
    const current = await this.findOne(companyId, id);
    this.assertTransition(current.status, ReimbursementStatus.CANCELADO);

    await this.prisma.db.reimbursement.update({
      where: { id },
      data: { status: ReimbursementStatus.CANCELADO, ...(reason ? { note: reason } : {}) },
    });

    await this.audit.record({
      event: AuditEvent.CANCELAMENTO,
      entity: AUDIT_ENTITY.REIMBURSEMENT,
      entityId: id,
      note: `Reembolso ${current.number} cancelado.${reason ? ` Motivo: ${reason}` : ''}`,
    });

    return this.findOne(companyId, id);
  }

  /** Número sequencial por empresa e ano, serializado no banco (bd/06). */
  private async nextNumber(companyId: string): Promise<string> {
    const [row] = await this.prisma.db.$queryRaw<{ numero: string }[]>`
      SELECT fn_proximo_numero_reembolso(${companyId}::uuid) AS numero
    `;
    return row.numero;
  }

  private assertTransition(from: ReimbursementStatus, to: ReimbursementStatus) {
    if (!TRANSITIONS[from].includes(to)) {
      throw new ConflictException(`Reembolso ${from} não pode ir para ${to}.`);
    }
  }

  /**
   * RN-003: quem solicitou não decide. A checagem também existe no banco — esta
   * aqui devolve 403 em vez de deixar o erro subir como falha de integridade.
   */
  private assertNotSelfApproval(reimbursement: ReimbursementRow, approverUserId: string) {
    if (reimbursement.employee.userId && reimbursement.employee.userId === approverUserId) {
      throw new ForbiddenException('O solicitante não pode decidir o próprio reembolso.');
    }
  }

  private assertItemAmount(item: ReimbursementItemDto) {
    if (new Prisma.Decimal(item.amount).lessThanOrEqualTo(0)) {
      throw new BadRequestException('O valor de cada despesa deve ser maior que zero.');
    }
  }
}
