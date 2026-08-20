import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AuditEvent,
  Prisma,
  ReconciliationOrigin,
  ReconciliationStatus,
  TransactionDirection,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../../common/audit/audit.service';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { QUEUES } from '../../common/queue/job.types';
import { toDateOnly } from '../../common/utils/date-only';
import { BankTransactionIdentifierService } from './bank-transaction-identifier.service';
import {
  EXACT_MATCH_SCORE,
  MatchCandidate,
  ReconciliationMatchingService,
} from './reconciliation-matching.service';
import { RunAutoReconciliationDto } from './dto/reconciliation.dto';

const ZERO = new Prisma.Decimal(0);

export const RECONCILIATION_JOBS = {
  RUN: 'conciliacao.executar',
} as const;

/** Teto de movimentos por execução: acima disso o período é grande demais. */
const MAX_MOVEMENTS_PER_RUN = 2_000;

/** Forma dos critérios gravados em `regra_conciliacao.condicoes`. */
interface RuleConditions {
  direction?: TransactionDirection;
  descriptionContains?: string;
  documentEquals?: string;
  counterpartDocument?: string;
  minAmount?: string;
  maxAmount?: string;
  bankAccountId?: string;
}

/** Forma das ações gravadas em `regra_conciliacao.acoes`. */
interface RuleActions {
  autoReconcile?: boolean;
  minScore?: string;
  markIgnored?: boolean;
}

export interface AutoReconciliationSummary {
  bankAccountId: string;
  from: string;
  to: string;
  examined: number;
  reconciled: number;
  suggested: number;
  ignored: number;
  untouched: number;
}

/**
 * Conciliação automática por regras (RF-075).
 *
 * O que roda por movimento, nesta ordem:
 *
 *  1. a primeira regra ativa cujas condições casam decide — prioridade
 *     crescente, nome como desempate. Não há "todas as regras que casam":
 *     duas regras concorrentes sobre o mesmo movimento produziriam um resultado
 *     que depende da ordem em que o banco devolveu as linhas;
 *  2. se a regra manda ignorar, o movimento sai da fila e o trabalho acabou;
 *  3. caso contrário, procura-se a melhor parcela candidata. O vínculo nasce
 *     **confirmado** só quando há autorização explícita — `autoReconcile` com
 *     score acima do piso da regra, ou correspondência inequívoca (RF-073);
 *  4. sem autorização, o vínculo nasce como sugestão, e o movimento vai para
 *     SUGERIDO — alguém decide depois.
 *
 * Idempotência em duas camadas, porque este é o processo que mais repete: a
 * chave do job dedupe o enfileiramento (`ux_job_idempotencia`), e movimentos que
 * já têm vínculo vivo são pulados. Reexecutar a mesma conta e o mesmo período
 * não duplica conciliação — nem quando o worker morre no meio.
 *
 * Um movimento com erro não derruba a execução inteira: ele é registrado e a
 * varredura segue. Interromper mil movimentos por causa de um é trocar um
 * problema pequeno por um grande.
 */
@Injectable()
export class AutoReconciliationService {
  private readonly logger = new Logger(AutoReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: ReconciliationMatchingService,
    private readonly identifier: BankTransactionIdentifierService,
    private readonly queue: JobQueueService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Enfileira a execução (RF-069/RF-075).
   *
   * Vai para a fila, e não para o caminho da requisição, porque um mês de conta
   * movimentada são centenas de movimentos e cada um faz consultas próprias — é
   * exatamente o pedido que estoura o timeout da transação da requisição.
   */
  async enqueue(companyId: string, dto: RunAutoReconciliationDto, userId: string) {
    const account = await this.prisma.db.companyBankAccount.findFirst({
      where: { id: dto.bankAccountId, companyId },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException('Conta bancária não encontrada.');
    }
    if (dto.from > dto.to) {
      throw new BadRequestException('A data inicial do período é posterior à final.');
    }

    const jobId = await this.queue.enqueue({
      queue: QUEUES.RECONCILIATION,
      name: RECONCILIATION_JOBS.RUN,
      companyId,
      payload: { bankAccountId: account.id, from: dto.from, to: dto.to, requestedBy: userId },
      // Mesma conta e mesmo período pedidos de novo enquanto o primeiro ainda
      // roda são um trabalho só.
      idempotencyKey: `conciliacao:${account.id}:${dto.from}:${dto.to}`,
    });

    await this.audit.record({
      event: AuditEvent.APROVACAO,
      entity: AUDIT_ENTITY.RECONCILIATION,
      companyId,
      note: `Conciliação automática enfileirada para a conta ${account.id} de ${dto.from} a ${dto.to}.`,
    });

    return { jobId, bankAccountId: account.id, from: dto.from, to: dto.to, status: 'ENFILEIRADA' };
  }

  /** Executa a varredura. Chamada pelo handler da fila. */
  async run(
    companyId: string,
    params: { bankAccountId: string; from: string; to: string },
  ): Promise<AutoReconciliationSummary> {
    const rules = await this.prisma.db.reconciliationRule.findMany({
      where: { companyId, isActive: true },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        conditions: true,
        actions: true,
        valueTolerance: true,
        dayTolerance: true,
      },
    });

    const movements = await this.prisma.db.bankTransaction.findMany({
      where: {
        companyId,
        bankAccountId: params.bankAccountId,
        movementDate: { gte: toDateOnly(params.from), lte: toDateOnly(params.to) },
        reconciliationStatus: {
          in: [ReconciliationStatus.NAO_CONCILIADO, ReconciliationStatus.SUGERIDO],
        },
      },
      orderBy: [{ movementDate: 'asc' }],
      take: MAX_MOVEMENTS_PER_RUN,
      select: {
        id: true,
        bankAccountId: true,
        movementDate: true,
        direction: true,
        amount: true,
        description: true,
        document: true,
        counterpartName: true,
        counterpartDocument: true,
        reconciliationStatus: true,
      },
    });

    const summary: AutoReconciliationSummary = {
      bankAccountId: params.bankAccountId,
      from: params.from,
      to: params.to,
      examined: movements.length,
      reconciled: 0,
      suggested: 0,
      ignored: 0,
      untouched: 0,
    };

    for (const movement of movements) {
      try {
        await this.processMovement(companyId, movement, rules, summary);
      } catch (error) {
        // Um movimento problemático não invalida os outros: o extrato inteiro
        // ficaria sem conciliar por causa de uma linha.
        summary.untouched += 1;
        this.logger.warn(
          `Movimento ${movement.id} não conciliado automaticamente: ${String(error)}`,
        );
      }
    }

    await this.audit.record({
      event: AuditEvent.APROVACAO,
      entity: AUDIT_ENTITY.RECONCILIATION,
      companyId,
      note:
        `Conciliação automática da conta ${params.bankAccountId} (${params.from} a ${params.to}): ` +
        `${summary.examined} examinados, ${summary.reconciled} conciliados, ` +
        `${summary.suggested} sugeridos, ${summary.ignored} ignorados.`,
    });

    return summary;
  }

  private async processMovement(
    companyId: string,
    movement: {
      id: string;
      bankAccountId: string;
      movementDate: Date;
      direction: TransactionDirection;
      amount: Prisma.Decimal;
      description: string | null;
      document: string | null;
      counterpartName: string | null;
      counterpartDocument: string | null;
    },
    rules: {
      id: string;
      name: string;
      conditions: Prisma.JsonValue;
      actions: Prisma.JsonValue;
      valueTolerance: Prisma.Decimal;
      dayTolerance: number;
    }[],
    summary: AutoReconciliationSummary,
  ): Promise<void> {
    const reconciled = await this.sumActive(movement.id);
    const remaining = movement.amount.minus(reconciled);
    if (remaining.lessThanOrEqualTo(ZERO)) {
      summary.untouched += 1;
      return;
    }

    const identification = await this.identifier.resolve(companyId, movement);

    const rule = rules.find((candidate) =>
      this.matches(movement, candidate.conditions as RuleConditions),
    );
    const actions = (rule?.actions ?? {}) as RuleActions;

    if (actions.markIgnored) {
      await this.prisma.db.bankTransaction.update({
        where: { id: movement.id },
        data: { reconciliationStatus: ReconciliationStatus.IGNORADO },
        select: { id: true },
      });
      summary.ignored += 1;
      return;
    }

    const candidates = await this.matching.findCandidates(
      companyId,
      movement,
      {
        dayTolerance: rule?.dayTolerance ?? 5,
        valueTolerance: rule?.valueTolerance ?? ZERO,
        limit: 3,
      },
      identification,
      reconciled,
    );

    const best = candidates[0];
    if (!best) {
      summary.untouched += 1;
      return;
    }

    const confirm = this.shouldConfirm(best, candidates, actions);

    await this.prisma.db.reconciliation.create({
      data: {
        companyId,
        bankTransactionId: movement.id,
        installmentId: best.installmentId,
        ruleId: rule?.id,
        origin: rule
          ? ReconciliationOrigin.AUTOMATICA_REGRA
          : ReconciliationOrigin.AUTOMATICA_EXATA,
        score: best.score,
        reconciledAmount: Prisma.Decimal.min(remaining, best.balance),
        difference: best.difference,
        hasDivergence: !best.difference.isZero(),
        justification: rule
          ? `Regra "${rule.name}": ${best.reasons.join('; ')}.`
          : `Correspondência inequívoca: ${best.reasons.join('; ')}.`,
        confirmed: confirm,
        confirmedAt: confirm ? new Date() : null,
      },
      select: { id: true },
    });

    if (confirm) {
      summary.reconciled += 1;
    } else {
      summary.suggested += 1;
    }
  }

  /**
   * Quando o vínculo nasce confirmado.
   *
   * Duas portas, e as duas exigem candidata única: uma segunda candidata com
   * pontuação igual significa que existe mais de uma leitura possível daquele
   * movimento, e escolher uma delas sozinho é adivinhar com o dinheiro do
   * cliente.
   */
  private shouldConfirm(
    best: MatchCandidate,
    candidates: MatchCandidate[],
    actions: RuleActions,
  ): boolean {
    const ambiguous = candidates.length > 1 && candidates[1].score.equals(best.score);
    if (ambiguous) {
      return false;
    }

    if (actions.autoReconcile && actions.minScore) {
      return best.score.greaterThanOrEqualTo(new Prisma.Decimal(actions.minScore));
    }

    // Sem regra que autorize, só a correspondência inequívoca e sem diferença
    // de valor se confirma sozinha.
    return best.score.greaterThanOrEqualTo(EXACT_MATCH_SCORE) && best.difference.isZero();
  }

  /** Avalia as condições da regra contra o movimento. Tudo em AND. */
  private matches(
    movement: {
      bankAccountId: string;
      direction: TransactionDirection;
      amount: Prisma.Decimal;
      description: string | null;
      document: string | null;
      counterpartDocument: string | null;
    },
    conditions: RuleConditions,
  ): boolean {
    if (conditions.direction && conditions.direction !== movement.direction) {
      return false;
    }
    if (conditions.bankAccountId && conditions.bankAccountId !== movement.bankAccountId) {
      return false;
    }
    if (conditions.documentEquals && conditions.documentEquals !== movement.document) {
      return false;
    }
    if (
      conditions.counterpartDocument &&
      conditions.counterpartDocument !== movement.counterpartDocument
    ) {
      return false;
    }
    if (
      conditions.minAmount &&
      movement.amount.lessThan(new Prisma.Decimal(conditions.minAmount))
    ) {
      return false;
    }
    if (
      conditions.maxAmount &&
      movement.amount.greaterThan(new Prisma.Decimal(conditions.maxAmount))
    ) {
      return false;
    }
    if (conditions.descriptionContains) {
      const haystack = normalize(movement.description ?? '');
      if (!haystack.includes(normalize(conditions.descriptionContains))) {
        return false;
      }
    }
    return true;
  }

  private async sumActive(bankTransactionId: string): Promise<Prisma.Decimal> {
    const aggregate = await this.prisma.db.reconciliation.aggregate({
      where: { bankTransactionId, undoneAt: null },
      _sum: { reconciledAmount: true },
    });
    return aggregate._sum.reconciledAmount ?? ZERO;
  }
}

/** Mesma normalização da identificação: sem acento, maiúsculas, espaço único. */
function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
