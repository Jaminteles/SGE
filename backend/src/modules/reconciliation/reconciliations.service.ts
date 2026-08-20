import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditEvent,
  Prisma,
  ReconciliationOrigin,
  ReconciliationStatus,
  TransactionDirection,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../../common/audit/audit.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { toDateOnly } from '../../common/utils/date-only';
import {
  CreateReconciliationDto,
  IgnoreBankTransactionDto,
  QueryPendingDto,
  QueryReconciliationDto,
  UndoReconciliationDto,
} from './dto/reconciliation.dto';

const ZERO = new Prisma.Decimal(0);

export const RECONCILIATION_FIELDS = {
  id: true,
  bankTransactionId: true,
  installmentId: true,
  settlementId: true,
  paymentTransactionId: true,
  ruleId: true,
  origin: true,
  score: true,
  reconciledAmount: true,
  difference: true,
  hasDivergence: true,
  justification: true,
  confirmed: true,
  confirmedById: true,
  confirmedAt: true,
  undoneAt: true,
  undoneById: true,
  undoReason: true,
  createdAt: true,
} satisfies Prisma.ReconciliationSelect;

/** Alvos possíveis de um vínculo, já conferidos contra a empresa ativa. */
interface ResolvedTarget {
  installmentId?: string;
  settlementId?: string;
  paymentTransactionId?: string;
  /** Quanto o lançamento interno diz que deveria ser. Base da diferença. */
  expectedAmount: Prisma.Decimal;
  label: string;
}

/**
 * Conciliação manual, desfazimento e histórico (RF-074, RF-077).
 *
 * **Conciliar não movimenta dinheiro.** O vínculo afirma que a linha do extrato
 * corresponde a um lançamento que já existe; ele não cria baixa, não abate saldo
 * de parcela e não toca no saldo da conta. Quem paga é M09, quem baixa é M08.
 * Se a conciliação também liquidasse, o mesmo dinheiro teria duas portas de
 * entrada — e a divergência que ela existe para revelar (RF-076) passaria a ser
 * produzida por ela mesma.
 *
 * O que impede conciliar duas vezes o mesmo dinheiro é o banco, não este
 * serviço: o trigger `trg_valida_conciliacao` (bd/14 §5) confere a soma dos
 * vínculos vivos com o movimento travado por `FOR UPDATE`. As checagens aqui
 * existem para responder 409 com mensagem de domínio em vez de deixar subir uma
 * violação de integridade — mesma divisão de trabalho do módulo bancário.
 *
 * Desfazer é um evento, não uma exclusão: `undoneAt`, autor e motivo. Uma
 * conciliação errada que some leva junto a evidência de que ela existiu — que é
 * exatamente o que se procura quando o extrato não fecha (RF-077).
 */
@Injectable()
export class ReconciliationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(companyId: string, dto: CreateReconciliationDto, userId: string) {
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException('O valor conciliado precisa ser maior que zero.');
    }

    return this.prisma.transaction(async () => {
      const movement = await this.loadMovement(companyId, dto.bankTransactionId);

      if (movement.reconciliationStatus === ReconciliationStatus.IGNORADO) {
        throw new ConflictException(
          'Este movimento está marcado como ignorado. Reabra-o antes de conciliar.',
        );
      }

      const target = await this.resolveTarget(companyId, dto, movement.direction);
      const reconciled = await this.sumActive(dto.bankTransactionId);
      const remaining = movement.amount.minus(reconciled);

      if (amount.greaterThan(remaining)) {
        throw new ConflictException(
          `O movimento de ${movement.amount.toFixed(2)} já tem ${reconciled.toFixed(2)} conciliado: ` +
            `restam ${remaining.toFixed(2)}.`,
        );
      }

      const difference = amount.minus(target.expectedAmount);
      const hasDivergence = !difference.isZero();

      if (hasDivergence && !dto.justification) {
        throw new BadRequestException(
          `O valor conciliado difere do lançamento em ${difference.toFixed(2)}: ` +
            'informe a justificativa da divergência (RF-076).',
        );
      }

      const reconciliation = await this.prisma.db.reconciliation.create({
        data: {
          companyId,
          bankTransactionId: movement.id,
          installmentId: target.installmentId,
          settlementId: target.settlementId,
          paymentTransactionId: target.paymentTransactionId,
          origin: ReconciliationOrigin.MANUAL,
          reconciledAmount: amount,
          difference,
          hasDivergence,
          justification: dto.justification,
          confirmed: true,
          confirmedById: userId,
          confirmedAt: new Date(),
        },
        select: RECONCILIATION_FIELDS,
      });

      await this.audit.record({
        event: AuditEvent.APROVACAO,
        entity: AUDIT_ENTITY.RECONCILIATION,
        entityId: reconciliation.id,
        companyId,
        note:
          `Conciliação manual do movimento ${movement.id} (${movement.direction} ` +
          `${movement.amount.toFixed(2)}) com ${target.label}: ${amount.toFixed(2)}` +
          (hasDivergence ? `, divergência de ${difference.toFixed(2)}.` : '.'),
      });

      return reconciliation;
    });
  }

  /**
   * Desfaz o vínculo (RF-074/RF-077).
   *
   * O status do movimento não é atualizado aqui: quem recalcula é o trigger
   * `trg_atualiza_status_conciliacao` (bd/14 §6), a partir dos vínculos que
   * sobraram. Escrever o status também daqui criaria um segundo dono do mesmo
   * campo, e os dois divergiriam no primeiro caminho de erro.
   */
  async undo(companyId: string, id: string, dto: UndoReconciliationDto, userId: string) {
    return this.prisma.transaction(async () => {
      const existing = await this.prisma.db.reconciliation.findFirst({
        where: { id, companyId },
        select: { id: true, undoneAt: true, bankTransactionId: true, reconciledAmount: true },
      });
      if (!existing) {
        throw new NotFoundException('Conciliação não encontrada.');
      }
      if (existing.undoneAt) {
        throw new ConflictException('Esta conciliação já foi desfeita.');
      }

      const undone = await this.prisma.db.reconciliation.update({
        where: { id: existing.id },
        data: { undoneAt: new Date(), undoneById: userId, undoReason: dto.reason },
        select: RECONCILIATION_FIELDS,
      });

      await this.audit.record({
        event: AuditEvent.ESTORNO,
        entity: AUDIT_ENTITY.RECONCILIATION,
        entityId: existing.id,
        companyId,
        note:
          `Conciliação desfeita do movimento ${existing.bankTransactionId} ` +
          `(${existing.reconciledAmount.toFixed(2)}): ${dto.reason}`,
      });

      return undone;
    });
  }

  /**
   * Marca o movimento como sem par (RF-072/RF-074).
   *
   * Tarifa, rendimento e transferência entre contas próprias não têm título — e
   * sem uma saída explícita eles ficam para sempre na lista de pendências,
   * escondendo as divergências reais no meio do ruído.
   */
  async ignore(
    companyId: string,
    bankTransactionId: string,
    dto: IgnoreBankTransactionDto,
    userId: string,
  ) {
    return this.prisma.transaction(async () => {
      const movement = await this.loadMovement(companyId, bankTransactionId);

      if (movement.reconciliationStatus === ReconciliationStatus.IGNORADO) {
        return this.projectMovement(movement.id, companyId);
      }

      const active = await this.sumActive(bankTransactionId);
      if (active.greaterThan(ZERO)) {
        throw new ConflictException(
          'Este movimento tem conciliações vivas: desfaça-as antes de marcá-lo como ignorado.',
        );
      }

      await this.setStatus(movement.id, ReconciliationStatus.IGNORADO, {
        ignoredBy: userId,
        ignoredAt: new Date().toISOString(),
        reason: dto.reason,
      });

      await this.audit.record({
        event: AuditEvent.CANCELAMENTO,
        entity: AUDIT_ENTITY.BANK_TRANSACTION,
        entityId: movement.id,
        companyId,
        note: `Movimento bancário marcado como ignorado na conciliação: ${dto.reason}`,
      });

      return this.projectMovement(movement.id, companyId);
    });
  }

  /** Devolve o movimento ignorado para a fila de conciliação (RF-074). */
  async reopen(companyId: string, bankTransactionId: string, userId: string) {
    return this.prisma.transaction(async () => {
      const movement = await this.loadMovement(companyId, bankTransactionId);

      if (movement.reconciliationStatus !== ReconciliationStatus.IGNORADO) {
        throw new ConflictException('Este movimento não está marcado como ignorado.');
      }

      await this.setStatus(movement.id, ReconciliationStatus.NAO_CONCILIADO, {
        reopenedBy: userId,
        reopenedAt: new Date().toISOString(),
      });

      await this.audit.record({
        event: AuditEvent.REABERTURA,
        entity: AUDIT_ENTITY.BANK_TRANSACTION,
        entityId: movement.id,
        companyId,
        note: 'Movimento bancário reaberto para conciliação.',
      });

      return this.projectMovement(movement.id, companyId);
    });
  }

  /**
   * Histórico de conciliações (RF-077).
   *
   * Por padrão devolve só os vínculos vivos, que é o que a tela de trabalho
   * pede; `includeUndone` traz o histórico completo, com o que foi desfeito,
   * por quem e por quê — a visão de quem investiga.
   */
  async findAll(companyId: string, query: QueryReconciliationDto) {
    const where: Prisma.ReconciliationWhereInput = {
      companyId,
      ...(query.includeUndone ? {} : { undoneAt: null }),
      ...(query.bankTransactionId ? { bankTransactionId: query.bankTransactionId } : {}),
      ...(query.installmentId ? { installmentId: query.installmentId } : {}),
      ...(query.bankAccountId ? { bankTransaction: { bankAccountId: query.bankAccountId } } : {}),
      ...(query.origin ? { origin: query.origin } : {}),
      ...(query.confirmed !== undefined ? { confirmed: query.confirmed } : {}),
      ...(query.hasDivergence !== undefined ? { hasDivergence: query.hasDivergence } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: toDateOnly(query.from) } : {}),
              // `to` é dia civil inclusivo: o limite é o início do dia seguinte.
              ...(query.to ? { lt: shiftDays(toDateOnly(query.to), 1) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.db.reconciliation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: query.skip,
        take: query.take,
        select: {
          ...RECONCILIATION_FIELDS,
          bankTransaction: {
            select: {
              bankAccountId: true,
              movementDate: true,
              direction: true,
              amount: true,
              description: true,
              reconciliationStatus: true,
            },
          },
        },
      }),
      this.prisma.db.reconciliation.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const reconciliation = await this.prisma.db.reconciliation.findFirst({
      where: { id, companyId },
      select: RECONCILIATION_FIELDS,
    });
    if (!reconciliation) {
      throw new NotFoundException('Conciliação não encontrada.');
    }
    return reconciliation;
  }

  /** Movimentos que ainda pedem decisão (RF-072/RF-076). */
  async findPending(companyId: string, query: QueryPendingDto) {
    const where: Prisma.BankTransactionWhereInput = {
      companyId,
      reconciliationStatus: query.status ?? {
        in: [
          ReconciliationStatus.NAO_CONCILIADO,
          ReconciliationStatus.SUGERIDO,
          ReconciliationStatus.DIVERGENTE,
        ],
      },
      ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.from || query.to
        ? {
            movementDate: {
              ...(query.from ? { gte: toDateOnly(query.from) } : {}),
              ...(query.to ? { lte: toDateOnly(query.to) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { description: { contains: query.q, mode: 'insensitive' } },
              { document: { contains: query.q } },
              { counterpartName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.db.bankTransaction.findMany({
        where,
        orderBy: [{ movementDate: 'asc' }, { createdAt: 'asc' }],
        skip: query.skip,
        take: query.take,
        select: {
          id: true,
          bankAccountId: true,
          movementDate: true,
          direction: true,
          amount: true,
          description: true,
          document: true,
          counterpartName: true,
          reconciliationStatus: true,
          metadata: true,
        },
      }),
      this.prisma.db.bankTransaction.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  private async loadMovement(companyId: string, bankTransactionId: string) {
    const movement = await this.prisma.db.bankTransaction.findFirst({
      where: { id: bankTransactionId, companyId },
      select: {
        id: true,
        bankAccountId: true,
        direction: true,
        amount: true,
        movementDate: true,
        reconciliationStatus: true,
        metadata: true,
      },
    });
    if (!movement) {
      throw new NotFoundException('Movimento bancário não encontrado.');
    }
    return movement;
  }

  private async sumActive(bankTransactionId: string): Promise<Prisma.Decimal> {
    const aggregate = await this.prisma.db.reconciliation.aggregate({
      where: { bankTransactionId, undoneAt: null },
      _sum: { reconciledAmount: true },
    });
    return aggregate._sum.reconciledAmount ?? ZERO;
  }

  /**
   * Confere cada alvo informado contra a empresa ativa e diz quanto o
   * lançamento interno vale.
   *
   * A conferência é por `companyId` no `where`, e não pela FK: o banco impede o
   * vínculo entre empresas (bd/14 §1), mas responder 404 aqui evita que a
   * diferença entre "não existe" e "é de outra empresa" vaze pelo código de
   * erro — que é como se enumera id alheio (RF-005).
   */
  private async resolveTarget(
    companyId: string,
    dto: CreateReconciliationDto,
    direction: TransactionDirection,
  ): Promise<ResolvedTarget> {
    if (!dto.installmentId && !dto.settlementId && !dto.paymentTransactionId) {
      throw new BadRequestException(
        'Informe a parcela, a baixa ou a ordem de pagamento correspondente ao movimento.',
      );
    }

    const target: ResolvedTarget = { expectedAmount: ZERO, label: '' };
    const labels: string[] = [];

    if (dto.installmentId) {
      const installment = await this.prisma.db.financialInstallment.findFirst({
        where: { id: dto.installmentId, companyId },
        select: {
          id: true,
          number: true,
          totalInstallments: true,
          balance: true,
          status: true,
          entry: { select: { number: true, type: true } },
        },
      });
      if (!installment) {
        throw new NotFoundException('Parcela não encontrada.');
      }
      if (installment.status === 'CANCELADA') {
        throw new ConflictException('A parcela está cancelada e não concilia.');
      }
      this.assertDirection(direction, installment.entry.type === 'RECEBER');

      target.installmentId = installment.id;
      target.expectedAmount = installment.balance;
      labels.push(
        `título ${installment.entry.number} parcela ${installment.number}/${installment.totalInstallments}`,
      );
    }

    if (dto.settlementId) {
      const settlement = await this.prisma.db.settlement.findFirst({
        where: { id: dto.settlementId, companyId, isReversed: false },
        select: { id: true, totalAmount: true, installmentId: true },
      });
      if (!settlement) {
        throw new NotFoundException('Baixa não encontrada ou já estornada.');
      }
      if (dto.installmentId && settlement.installmentId !== dto.installmentId) {
        throw new BadRequestException('A baixa informada pertence a outra parcela.');
      }

      target.settlementId = settlement.id;
      // A baixa é mais específica que a parcela: quando as duas vêm, é o valor
      // efetivamente baixado que define a diferença.
      target.expectedAmount = settlement.totalAmount;
      labels.push(`baixa ${settlement.id}`);
    }

    if (dto.paymentTransactionId) {
      const transaction = await this.prisma.db.paymentTransaction.findFirst({
        where: { id: dto.paymentTransactionId, companyId },
        select: { id: true, amount: true, direction: true, status: true },
      });
      if (!transaction) {
        throw new NotFoundException('Ordem de pagamento não encontrada.');
      }
      if (transaction.direction !== direction) {
        throw new BadRequestException(
          'A ordem de pagamento tem sentido oposto ao do movimento bancário.',
        );
      }

      target.paymentTransactionId = transaction.id;
      if (!dto.installmentId && !dto.settlementId) {
        target.expectedAmount = transaction.amount;
      }
      labels.push(`ordem ${transaction.id}`);
    }

    target.label = labels.join(' + ');
    return target;
  }

  /**
   * Crédito no extrato só corresponde a título a receber; débito, a pagar.
   *
   * É o erro mais caro da conciliação manual — baixar um pagamento com o
   * dinheiro que entrou — e por isso é recusado aqui e no banco (bd/14 §5).
   */
  private assertDirection(direction: TransactionDirection, isReceivable: boolean): void {
    const expectsCredit = direction === TransactionDirection.CREDITO;
    if (expectsCredit !== isReceivable) {
      throw new BadRequestException(
        expectsCredit
          ? 'Uma entrada no extrato só concilia com título a receber.'
          : 'Uma saída no extrato só concilia com título a pagar.',
      );
    }
  }

  /** Mescla a nota da decisão em `metadados`, preservando a identificação. */
  private async setStatus(
    id: string,
    status: ReconciliationStatus,
    note: Record<string, unknown>,
  ): Promise<void> {
    const current = await this.prisma.db.bankTransaction.findUniqueOrThrow({
      where: { id },
      select: { metadata: true },
    });
    const metadata =
      current.metadata && typeof current.metadata === 'object' && !Array.isArray(current.metadata)
        ? (current.metadata as Prisma.JsonObject)
        : {};

    await this.prisma.db.bankTransaction.update({
      where: { id },
      data: {
        reconciliationStatus: status,
        metadata: { ...metadata, reconciliation: note as Prisma.JsonObject },
      },
      select: { id: true },
    });
  }

  private async projectMovement(id: string, companyId: string) {
    return this.prisma.db.bankTransaction.findFirstOrThrow({
      where: { id, companyId },
      select: {
        id: true,
        bankAccountId: true,
        movementDate: true,
        direction: true,
        amount: true,
        description: true,
        reconciliationStatus: true,
        metadata: true,
      },
    });
  }
}

function shiftDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
