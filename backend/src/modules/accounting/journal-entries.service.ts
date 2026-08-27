import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountingPeriodStatus, JournalLineType, Prisma } from '@prisma/client';
import { AUDIT_ENTITY, AuditService } from '../../common/audit/audit.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { formatDateOnly, toDateOnly } from '../../common/utils/date-only';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountingPeriodsService } from './accounting-periods.service';
import { JOURNAL_ORIGINS, JournalOrigin } from './accounting.constants';
import {
  CreateJournalEntryDto,
  JournalEntryLineDto,
  QueryJournalEntryDto,
  ReverseJournalEntryDto,
} from './dto/journal-entry.dto';
import { JournalEntryResponse, toJournalEntryResponse } from './accounting.mapper';

const ZERO = new Prisma.Decimal(0);

const entryInclude = {
  lines: {
    orderBy: { sequence: 'asc' as const },
    include: {
      account: { select: { id: true, code: true, name: true, type: true } },
    },
  },
} satisfies Prisma.JournalEntryInclude;

/** Partida já normalizada: conta conferida e valor em Decimal. */
export interface PostingLine {
  accountId: string;
  type: JournalLineType;
  amount: Prisma.Decimal;
  costCenterId?: string;
  extraHistory?: string;
}

/** O que uma contabilização precisa informar para virar lançamento. */
export interface PostingInput {
  entryDate: Date;
  competenceDate: Date;
  history: string;
  lines: PostingLine[];
  origin: JournalOrigin;
  originId?: string;
  settlementId?: string;
  fiscalDocumentId?: string;
  branchId?: string;
  batch?: string;
  reversalOfId?: string;
  createdById?: string;
}

/**
 * Lançamentos contábeis (RF-081/RF-082).
 *
 * O serviço é curto de propósito: quase toda invariante é do banco, porque é lá
 * que caminhos de código futuros também passam.
 *
 *  - **débito = crédito** — constraint trigger DEFERRABLE (bd/03). A conferência
 *    feita aqui existe para devolver 400 com a diferença em vez de 500 com um
 *    erro de trigger;
 *  - **cabeçalho = soma das partidas** — bd/17 §4;
 *  - **período fechado não recebe nada** — RN-008, trigger de bd/03;
 *  - **conta sintética não recebe partida** — bd/03;
 *  - **imutabilidade** — bd/17 §5: não existe método de alteração neste serviço
 *    porque não existe UPDATE possível na tabela. Corrigir é estornar;
 *  - **idempotência da contabilização automática** — índice parcial
 *    `ux_lancamento_origem`: a mesma baixa não vira dois lançamentos, e é isso
 *    que impede um retry de dobrar a despesa do mês.
 *
 * Cabeçalho e partidas são gravados na mesma transação. Um cabeçalho sem
 * partidas seria um lançamento de valor sem contrapartida — e o razão não teria
 * como mostrá-lo.
 */
@Injectable()
export class JournalEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly periods: AccountingPeriodsService,
    private readonly audit: AuditService,
  ) {}

  /** Lançamento manual, digitado por quem responde pela escrituração (RF-081). */
  async create(
    companyId: string,
    dto: CreateJournalEntryDto,
    userId: string,
  ): Promise<JournalEntryResponse> {
    const entryDate = toDateOnly(dto.entryDate);
    const competenceDate = toDateOnly(dto.competenceDate ?? dto.entryDate);
    const lines = await this.normalizeLines(companyId, dto.lines);

    return this.post(companyId, {
      entryDate,
      competenceDate,
      history: dto.history,
      lines,
      origin: JOURNAL_ORIGINS.MANUAL,
      branchId: dto.branchId,
      batch: dto.batch,
      createdById: userId,
    });
  }

  /**
   * Grava um lançamento. É o único caminho de escrita do módulo — manual,
   * automático e estorno passam todos por aqui.
   */
  async post(companyId: string, input: PostingInput): Promise<JournalEntryResponse> {
    const total = this.assertBalanced(input.lines);
    await this.assertPeriodOpen(companyId, input.competenceDate);

    try {
      const entry = await this.prisma.transaction(async () => {
        const created = await this.prisma.db.journalEntry.create({
          data: {
            companyId,
            branchId: input.branchId,
            entryDate: input.entryDate,
            competenceDate: input.competenceDate,
            history: input.history,
            totalAmount: total,
            origin: input.origin,
            originId: input.originId,
            settlementId: input.settlementId,
            fiscalDocumentId: input.fiscalDocumentId,
            batch: input.batch,
            reversalOfId: input.reversalOfId,
            createdById: input.createdById,
            lines: {
              create: input.lines.map((line, index) => ({
                companyId,
                sequence: index + 1,
                accountId: line.accountId,
                type: line.type,
                amount: line.amount,
                costCenterId: line.costCenterId,
                extraHistory: line.extraHistory,
              })),
            },
          },
          include: entryInclude,
        });

        if (input.reversalOfId) {
          // Marca o estornado no mesmo commit: um lançamento estornado cujo
          // estorno não existisse (ou o contrário) apareceria duas vezes no
          // razão, ou nenhuma.
          await this.prisma.db.journalEntry.update({
            where: { id: input.reversalOfId },
            data: { isReversed: true },
          });
        }

        return created;
      });

      await this.audit.record({
        event: input.reversalOfId ? 'ESTORNO' : 'CRIACAO',
        entity: AUDIT_ENTITY.JOURNAL_ENTRY,
        entityId: entry.id,
        note: `${input.origin} — ${input.history}`.slice(0, 500),
      });

      return toJournalEntryResponse(entry);
    } catch (error) {
      throw this.translate(error, input);
    }
  }

  /**
   * Lançamento já existente para aquela origem, se houver (RF-081).
   *
   * A contabilização automática consulta antes de gravar: devolver o lançamento
   * que já existe é a resposta certa para o retry, e é mais barato do que
   * esperar o índice `ux_lancamento_origem` recusar.
   */
  async findByOrigin(
    companyId: string,
    origin: JournalOrigin,
    originId: string,
  ): Promise<JournalEntryResponse | null> {
    const entry = await this.prisma.db.journalEntry.findFirst({
      where: { companyId, origin, originId },
      include: entryInclude,
    });
    return entry ? toJournalEntryResponse(entry) : null;
  }

  async findAll(
    companyId: string,
    query: QueryJournalEntryDto,
  ): Promise<PaginatedResult<JournalEntryResponse>> {
    const where: Prisma.JournalEntryWhereInput = {
      companyId,
      ...(query.from || query.to
        ? {
            competenceDate: {
              ...(query.from ? { gte: toDateOnly(query.from) } : {}),
              ...(query.to ? { lte: toDateOnly(query.to) } : {}),
            },
          }
        : {}),
      ...(query.origin ? { origin: query.origin } : {}),
      ...(query.batch ? { batch: query.batch } : {}),
      // A conta é filtro sobre as partidas: `some` mantém o resultado no nível
      // do lançamento, que é o que o diário lista.
      ...(query.accountId ? { lines: { some: { accountId: query.accountId } } } : {}),
      ...(query.q ? { history: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.journalEntry.findMany({
        where,
        orderBy: [{ competenceDate: 'desc' }, { number: 'desc' }],
        skip: query.skip,
        take: query.take,
        include: entryInclude,
      }),
      this.prisma.db.journalEntry.count({ where }),
    ]);

    return new PaginatedResult(rows.map(toJournalEntryResponse), total, query.page, query.pageSize);
  }

  /** Um lançamento da empresa ativa. Id de outra empresa é 404, não 403. */
  async findOne(companyId: string, id: string): Promise<JournalEntryResponse> {
    const entry = await this.prisma.db.journalEntry.findFirst({
      where: { id, companyId },
      include: entryInclude,
    });
    if (!entry) {
      throw new NotFoundException('Lançamento contábil não encontrado.');
    }
    return toJournalEntryResponse(entry);
  }

  /**
   * Estorna o lançamento (RF-082).
   *
   * O estorno é um lançamento novo com as partidas invertidas, nunca uma
   * alteração: as duas versões continuam visíveis no razão, e é essa dupla que
   * responde "o que estava errado e o que ficou no lugar". O banco impede o
   * segundo estorno do mesmo lançamento (`ux_lancamento_estorno_unico`).
   */
  async reverse(
    companyId: string,
    id: string,
    dto: ReverseJournalEntryDto,
    userId: string,
  ): Promise<JournalEntryResponse> {
    const entry = await this.prisma.db.journalEntry.findFirst({
      where: { id, companyId },
      include: entryInclude,
    });
    if (!entry) {
      throw new NotFoundException('Lançamento contábil não encontrado.');
    }
    if (entry.isReversed) {
      throw new ConflictException('Lançamento já estornado.');
    }

    const competenceDate = dto.competenceDate
      ? toDateOnly(dto.competenceDate)
      : entry.competenceDate;

    return this.post(companyId, {
      entryDate: new Date(),
      competenceDate,
      history: `Estorno do lançamento ${entry.number}: ${dto.reason}`.slice(0, 500),
      lines: entry.lines.map((line) => ({
        accountId: line.accountId,
        // Inverter o lado é o estorno: mesmo valor, mesma conta, sinal contrário.
        type:
          line.type === JournalLineType.DEBITO ? JournalLineType.CREDITO : JournalLineType.DEBITO,
        amount: line.amount,
        costCenterId: line.costCenterId ?? undefined,
        extraHistory: line.extraHistory ?? undefined,
      })),
      origin: JOURNAL_ORIGINS.REVERSAL,
      branchId: entry.branchId ?? undefined,
      reversalOfId: entry.id,
      createdById: userId,
    });
  }

  /** Conta analítica, ativa e da empresa; valor positivo. */
  private async normalizeLines(
    companyId: string,
    lines: JournalEntryLineDto[],
  ): Promise<PostingLine[]> {
    const accountIds = [...new Set(lines.map((line) => line.accountId))];
    const accounts = await this.prisma.db.ledgerAccount.findMany({
      where: { id: { in: accountIds }, companyId },
      select: { id: true, code: true, acceptsEntry: true, isActive: true },
    });
    const byId = new Map(accounts.map((account) => [account.id, account]));

    return lines.map((line) => {
      const account = byId.get(line.accountId);
      if (!account) {
        // Conta de outra empresa e conta inexistente devolvem a mesma coisa: a
        // resposta não confirma a existência de contas alheias.
        throw new BadRequestException('Conta contábil não encontrada nesta empresa.');
      }
      if (!account.isActive) {
        throw new BadRequestException(`A conta ${account.code} está inativa.`);
      }
      if (!account.acceptsEntry) {
        throw new BadRequestException(
          `A conta ${account.code} é sintética e não recebe partida: use uma conta analítica.`,
        );
      }

      const amount = new Prisma.Decimal(line.amount);
      if (amount.lessThanOrEqualTo(ZERO)) {
        throw new BadRequestException(
          'O valor da partida é positivo: o lado (débito/crédito) é que dá o sinal.',
        );
      }

      return {
        accountId: line.accountId,
        type: line.type,
        amount,
        costCenterId: line.costCenterId,
        extraHistory: line.extraHistory,
      };
    });
  }

  /** Débito = crédito, em Decimal. Devolve o total, que vira `valor_total`. */
  private assertBalanced(lines: PostingLine[]): Prisma.Decimal {
    let debit = ZERO;
    let credit = ZERO;

    for (const line of lines) {
      if (line.type === JournalLineType.DEBITO) {
        debit = debit.plus(line.amount);
      } else {
        credit = credit.plus(line.amount);
      }
    }

    if (debit.isZero()) {
      throw new BadRequestException('O lançamento precisa de ao menos um débito e um crédito.');
    }
    if (!debit.equals(credit)) {
      throw new BadRequestException(
        `Lançamento desbalanceado: débito ${debit.toFixed(2)} ≠ crédito ${credit.toFixed(2)}.`,
      );
    }
    return debit;
  }

  /** RN-008: o período da competência precisa existir e aceitar lançamento. */
  private async assertPeriodOpen(companyId: string, competenceDate: Date): Promise<void> {
    const period = await this.periods.findFor(companyId, competenceDate);

    if (!period) {
      throw new BadRequestException(
        `Não há período contábil para a competência ${formatDateOnly(competenceDate)}. Abra o exercício primeiro.`,
      );
    }
    if (period.status === AccountingPeriodStatus.FECHADO) {
      throw new ConflictException(
        `O período ${period.month}/${period.year} está fechado (RN-008). Reabra-o, com motivo, para lançar nele.`,
      );
    }
  }

  /** Índices e triggers do banco viram mensagem, não 500. */
  private translate(error: unknown, input: PostingInput): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException(
        input.reversalOfId
          ? 'Este lançamento já foi estornado.'
          : `Já existe lançamento contábil para ${input.origin} ${input.originId ?? ''}`.trim(),
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
