import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountingPeriodStatus, Prisma } from '@prisma/client';
import { AUDIT_ENTITY, AuditService } from '../../common/audit/audit.service';
import { toDateOnly } from '../../common/utils/date-only';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CloseAccountingPeriodDto,
  QueryAccountingPeriodDto,
  ReopenAccountingPeriodDto,
} from './dto/accounting-period.dto';

const periodSelect = {
  id: true,
  year: true,
  month: true,
  startDate: true,
  endDate: true,
  status: true,
  closedAt: true,
  closedById: true,
  reopenedAt: true,
  reopenedById: true,
  reopenReason: true,
} satisfies Prisma.AccountingPeriodSelect;

export type AccountingPeriodRow = Prisma.AccountingPeriodGetPayload<{
  select: typeof periodSelect;
}>;

/** Situações que ainda aceitam lançamento (RN-008). */
const OPEN_STATUSES: AccountingPeriodStatus[] = [
  AccountingPeriodStatus.ABERTO,
  AccountingPeriodStatus.EM_FECHAMENTO,
  AccountingPeriodStatus.REABERTO,
];

/**
 * Fechamento e reabertura de períodos (RF-086, RN-008).
 *
 * Fechar é a afirmação de que aquele mês parou de mudar — e é dela que dependem
 * o balancete entregue, a DRE assinada e qualquer obrigação acessória já
 * transmitida. Por isso três coisas:
 *
 *  1. **o fechamento é em duas etapas**. `EM_FECHAMENTO` ainda aceita ajuste
 *     (é a semana em que a contabilidade concilia); `FECHADO` não aceita nada,
 *     e o bloqueio é do banco (RN-008, trigger de bd/03), não da aplicação;
 *  2. **reabrir exige motivo e responsável**. Sem os dois, "por que este número
 *     mudou depois de fechado" não tem resposta — e essa é a única pergunta que
 *     importa quando ele muda;
 *  3. **fechar, reabrir e refechar vão para a trilha** (RF-114). O trigger de
 *     DML de bd/03 já captura a alteração da linha; os eventos de aprovação
 *     registrados aqui existem porque fechamento e reabertura são *decisões*, e
 *     a trilha precisa mostrá-las como tal, não como UPDATE de duas colunas.
 */
@Injectable()
export class AccountingPeriodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Abre os doze meses do exercício, pulando os que já existem.
   *
   * Período é calendário, não decisão: os meses existem independentemente de
   * alguém os cadastrar, e a falta de um só aparece no dia em que um lançamento
   * é recusado por não haver período para a competência.
   */
  async openYear(companyId: string, year: number): Promise<AccountingPeriodRow[]> {
    const existing = await this.prisma.db.accountingPeriod.findMany({
      where: { companyId, year },
      select: { month: true },
    });
    const known = new Set(existing.map((row) => row.month));

    const missing = [];
    for (let month = 1; month <= 12; month += 1) {
      if (known.has(month)) continue;
      missing.push({
        companyId,
        year,
        month,
        startDate: this.firstDayOf(year, month),
        endDate: this.lastDayOf(year, month),
      });
    }

    if (missing.length > 0) {
      // `skipDuplicates`: duas aberturas simultâneas do mesmo exercício não
      // derrubam uma à outra na unique (empresa, exercicio, mes).
      await this.prisma.db.accountingPeriod.createMany({ data: missing, skipDuplicates: true });
    }

    return this.findAll(companyId, { year });
  }

  findAll(companyId: string, query: QueryAccountingPeriodDto): Promise<AccountingPeriodRow[]> {
    return this.prisma.db.accountingPeriod.findMany({
      where: {
        companyId,
        ...(query.year ? { year: query.year } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ year: 'desc' }, { month: 'asc' }],
      select: periodSelect,
    });
  }

  /** Um período da empresa ativa. Id de outra empresa é 404, não 403. */
  async findOne(companyId: string, id: string): Promise<AccountingPeriodRow> {
    const period = await this.prisma.db.accountingPeriod.findFirst({
      where: { id, companyId },
      select: periodSelect,
    });
    if (!period) {
      throw new NotFoundException('Período contábil não encontrado.');
    }
    return period;
  }

  /**
   * Fecha o período — ou o coloca em fechamento (RF-086).
   *
   * Recusa fechar um mês com lançamento desbalanceado seria redundante: o banco
   * não deixa um desbalanceado existir (bd/03). O que se confere aqui é o que o
   * banco não pode conferir sozinho: que o mês anterior já esteja fechado. Um
   * mês fechado depois do seguinte deixa uma janela em que alguém ainda lança em
   * período mais antigo do que o último já entregue.
   */
  async close(
    companyId: string,
    id: string,
    dto: CloseAccountingPeriodDto,
    userId: string,
  ): Promise<AccountingPeriodRow> {
    const period = await this.findOne(companyId, id);
    const target = dto.status ?? AccountingPeriodStatus.FECHADO;

    if (
      target !== AccountingPeriodStatus.FECHADO &&
      target !== AccountingPeriodStatus.EM_FECHAMENTO
    ) {
      throw new BadRequestException('Só é possível colocar em fechamento ou fechar por esta rota.');
    }
    if (period.status === AccountingPeriodStatus.FECHADO) {
      throw new ConflictException('Período já está fechado.');
    }
    await this.assertPreviousClosed(companyId, period);

    const updated = await this.prisma.db.accountingPeriod.update({
      where: { id: period.id },
      data: {
        status: target,
        ...(target === AccountingPeriodStatus.FECHADO
          ? { closedById: userId, closedAt: new Date() }
          : {}),
      },
      select: periodSelect,
    });

    await this.audit.record({
      event: 'FECHAMENTO',
      entity: AUDIT_ENTITY.ACCOUNTING_PERIOD,
      entityId: period.id,
      note: `Período ${period.month}/${period.year} → ${target}.`,
    });

    return updated;
  }

  /** Reabre um período fechado, com motivo e responsável (RF-086). */
  async reopen(
    companyId: string,
    id: string,
    dto: ReopenAccountingPeriodDto,
    userId: string,
  ): Promise<AccountingPeriodRow> {
    const period = await this.findOne(companyId, id);

    if (period.status !== AccountingPeriodStatus.FECHADO) {
      throw new ConflictException('Só um período fechado é reaberto.');
    }

    const updated = await this.prisma.db.accountingPeriod.update({
      where: { id: period.id },
      data: {
        status: AccountingPeriodStatus.REABERTO,
        reopenedById: userId,
        reopenedAt: new Date(),
        reopenReason: dto.reason,
      },
      select: periodSelect,
    });

    await this.audit.record({
      event: 'REABERTURA',
      entity: AUDIT_ENTITY.ACCOUNTING_PERIOD,
      entityId: period.id,
      note: `Período ${period.month}/${period.year} reaberto: ${dto.reason}`,
    });

    return updated;
  }

  /** O período que contém a competência, aberto ou não. */
  async findFor(companyId: string, competence: Date): Promise<AccountingPeriodRow | null> {
    return this.prisma.db.accountingPeriod.findFirst({
      where: { companyId, startDate: { lte: competence }, endDate: { gte: competence } },
      select: periodSelect,
    });
  }

  /** Fechar fora de ordem deixa um mês antigo aberto atrás de um já entregue. */
  private async assertPreviousClosed(
    companyId: string,
    period: AccountingPeriodRow,
  ): Promise<void> {
    const previous = await this.prisma.db.accountingPeriod.findFirst({
      where: {
        companyId,
        endDate: { lt: period.startDate },
        status: { in: OPEN_STATUSES },
      },
      orderBy: { startDate: 'asc' },
      select: { year: true, month: true },
    });

    if (previous) {
      throw new ConflictException(
        `Feche antes o período ${previous.month}/${previous.year}: fechar fora de ordem deixa um mês anterior aberto atrás de um já entregue.`,
      );
    }
  }

  private firstDayOf(year: number, month: number): Date {
    return toDateOnly(`${year}-${String(month).padStart(2, '0')}-01`);
  }

  /** Último dia civil do mês — dia 0 do mês seguinte, em UTC. */
  private lastDayOf(year: number, month: number): Date {
    return new Date(Date.UTC(year, month, 0));
  }
}
