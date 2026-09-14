import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountNature, JournalLineType, LedgerAccountType, Prisma } from '@prisma/client';
import { formatDateOnly, toDateOnly } from '../../common/utils/date-only';
import { PrismaService } from '../../prisma/prisma.service';
import { RESULT_ACCOUNT_TYPES } from './accounting.constants';
import {
  QueryIncomeStatementDto,
  QueryLedgerDto,
  QueryTrialBalanceDto,
} from './dto/accounting-report.dto';

const ZERO = new Prisma.Decimal(0);

/** Débito e crédito acumulados de uma conta num recorte. */
interface Movement {
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

export interface LedgerRow {
  entryId: string;
  entryNumber: number;
  competenceDate: string;
  history: string;
  extraHistory: string | null;
  origin: string | null;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  /** Saldo corrido na natureza da conta, linha a linha. */
  balance: Prisma.Decimal;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  nature: AccountNature;
  openingBalance: Prisma.Decimal;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  closingBalance: Prisma.Decimal;
}

export interface IncomeStatementLine {
  accountId: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  amount: Prisma.Decimal;
}

/**
 * Razão, balancete e DRE (RF-083 a RF-085).
 *
 * Três decisões valem para os três relatórios:
 *
 *  1. **estorno não é exclusão**. O lançamento estornado e o estorno dele
 *     continuam nos três relatórios, e se anulam por soma. Filtrar só o
 *     estornado — como a view `vw_razao_contabil` de bd/03 fazia — deixava o
 *     estorno sozinho e produzia um valor negativo fantasma no balancete;
 *  2. **o saldo respeita a natureza da conta**. Numa conta devedora o saldo é
 *     débito menos crédito; numa credora, o contrário. Sem isso, todo passivo e
 *     toda receita apareceriam negativos, e o balancete pareceria errado quando
 *     está certo;
 *  3. **`Decimal` do banco à resposta**. Nenhum total passa por `number` no
 *     caminho (RN-012): um centavo perdido aqui reaparece como balancete que
 *     não fecha, e ninguém encontra a origem.
 *
 * As agregações são feitas com `groupBy` do Prisma, e não com as views de bd/03:
 * o filtro por empresa fica explícito na consulta, além da RLS, e o mesmo código
 * responde por razão, balancete e DRE.
 */
@Injectable()
export class AccountingReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Razão de uma conta (RF-083).
   *
   * Traz o saldo anterior à janela e o saldo corrido linha a linha — que é o
   * que se confere quando um saldo não bate: o ponto em que ele deixou de bater.
   */
  async ledger(companyId: string, query: QueryLedgerDto) {
    const { from, to } = this.range(query.from, query.to);

    const account = await this.prisma.db.ledgerAccount.findFirst({
      where: { id: query.accountId, companyId },
      select: { id: true, code: true, name: true, type: true, nature: true },
    });
    if (!account) {
      throw new NotFoundException('Conta contábil não encontrada.');
    }
    const costCenterId = await this.costCenterScope(companyId, query.costCenterId);

    const opening = await this.movementOf(companyId, account.id, { lt: from }, costCenterId);
    let balance = this.balanceOf(account.nature, opening);

    const lines = await this.prisma.db.journalEntryLine.findMany({
      where: {
        companyId,
        accountId: account.id,
        ...(costCenterId ? { costCenterId } : {}),
        entry: { competenceDate: { gte: from, lte: to } },
      },
      orderBy: [
        { entry: { competenceDate: 'asc' } },
        { entry: { number: 'asc' } },
        { sequence: 'asc' },
      ],
      skip: query.offset ?? 0,
      take: query.limit ?? 200,
      select: {
        type: true,
        amount: true,
        extraHistory: true,
        entry: {
          select: {
            id: true,
            number: true,
            competenceDate: true,
            history: true,
            origin: true,
          },
        },
      },
    });

    const rows: LedgerRow[] = lines.map((line) => {
      const debit = line.type === JournalLineType.DEBITO ? line.amount : ZERO;
      const credit = line.type === JournalLineType.CREDITO ? line.amount : ZERO;
      balance = balance.plus(this.balanceOf(account.nature, { debit, credit }));

      return {
        entryId: line.entry.id,
        entryNumber: Number(line.entry.number),
        competenceDate: formatDateOnly(line.entry.competenceDate),
        history: line.entry.history,
        extraHistory: line.extraHistory,
        origin: line.entry.origin,
        debit,
        credit,
        balance,
      };
    });

    const period = await this.movementOf(
      companyId,
      account.id,
      { gte: from, lte: to },
      costCenterId,
    );

    return {
      account,
      range: { from: formatDateOnly(from), to: formatDateOnly(to) },
      costCenterId,
      openingBalance: this.balanceOf(account.nature, opening),
      totalDebit: period.debit,
      totalCredit: period.credit,
      // Fecha com o total da janela, e não com a última linha da página: o
      // saldo final não muda porque quem consulta pediu a segunda página.
      closingBalance: this.balanceOf(account.nature, opening).plus(
        this.balanceOf(account.nature, period),
      ),
      rows,
    };
  }

  /**
   * Balancete de verificação (RF-084).
   *
   * Devolve também os totais de débito e de crédito do período: eles precisam
   * ser iguais, e é essa igualdade que dá nome ao relatório. Se divergirem, o
   * problema é de escrituração, não de apresentação.
   */
  async trialBalance(companyId: string, query: QueryTrialBalanceDto) {
    const { from, to } = this.range(query.from, query.to);
    const costCenterId = await this.costCenterScope(companyId, query.costCenterId);

    const [openings, movements] = await Promise.all([
      this.movementsByAccount(companyId, { lt: from }, costCenterId),
      this.movementsByAccount(companyId, { gte: from, lte: to }, costCenterId),
    ]);

    const accountIds = new Set([...openings.keys(), ...movements.keys()]);
    const accounts = await this.prisma.db.ledgerAccount.findMany({
      where: query.includeZeroed
        ? { companyId, acceptsEntry: true }
        : { companyId, id: { in: [...accountIds] } },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, type: true, nature: true },
    });

    let totalDebit = ZERO;
    let totalCredit = ZERO;

    const rows: TrialBalanceRow[] = accounts.map((account) => {
      const opening = openings.get(account.id) ?? { debit: ZERO, credit: ZERO };
      const movement = movements.get(account.id) ?? { debit: ZERO, credit: ZERO };
      const openingBalance = this.balanceOf(account.nature, opening);

      totalDebit = totalDebit.plus(movement.debit);
      totalCredit = totalCredit.plus(movement.credit);

      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        nature: account.nature,
        openingBalance,
        debit: movement.debit,
        credit: movement.credit,
        closingBalance: openingBalance.plus(this.balanceOf(account.nature, movement)),
      };
    });

    return {
      range: { from: formatDateOnly(from), to: formatDateOnly(to) },
      costCenterId,
      totalDebit,
      totalCredit,
      /** Verdadeiro é o esperado; falso é escrituração para investigar. */
      balanced: totalDebit.equals(totalCredit),
      rows,
    };
  }

  /**
   * DRE do período (RF-085).
   *
   * Receita entra pelo crédito; custo e despesa, pelo débito — o sinal já vem da
   * natureza da conta, e por isso as três somas usam o mesmo cálculo. O
   * resultado é receita menos custo menos despesa: positivo é lucro.
   */
  async incomeStatement(companyId: string, query: QueryIncomeStatementDto) {
    const { from, to } = this.range(query.from, query.to);

    const movements = await this.movementsByAccount(companyId, { gte: from, lte: to });
    const accounts = await this.prisma.db.ledgerAccount.findMany({
      where: { companyId, type: { in: RESULT_ACCOUNT_TYPES }, id: { in: [...movements.keys()] } },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, type: true, nature: true },
    });

    const groups: Record<'revenue' | 'cost' | 'expense', IncomeStatementLine[]> = {
      revenue: [],
      cost: [],
      expense: [],
    };
    const totals = { revenue: ZERO, cost: ZERO, expense: ZERO };

    for (const account of accounts) {
      const movement = movements.get(account.id) ?? { debit: ZERO, credit: ZERO };
      const amount = this.balanceOf(account.nature, movement);
      const line: IncomeStatementLine = {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        amount,
      };

      const bucket =
        account.type === LedgerAccountType.RECEITA
          ? 'revenue'
          : account.type === LedgerAccountType.CUSTO
            ? 'cost'
            : 'expense';

      groups[bucket].push(line);
      totals[bucket] = totals[bucket].plus(amount);
    }

    const grossResult = totals.revenue.minus(totals.cost);

    return {
      range: { from: formatDateOnly(from), to: formatDateOnly(to) },
      revenue: { total: totals.revenue, lines: groups.revenue },
      cost: { total: totals.cost, lines: groups.cost },
      expense: { total: totals.expense, lines: groups.expense },
      grossResult,
      netResult: grossResult.minus(totals.expense),
    };
  }

  /**
   * Débito e crédito por conta no recorte de competência.
   *
   * Uma agregação no banco em vez de somar linhas na aplicação: o balancete de
   * um ano tem centenas de milhares de partidas, e trazê-las para somar seria
   * transferir o razão inteiro pela rede.
   */
  private async movementsByAccount(
    companyId: string,
    competence: Prisma.DateTimeFilter,
    costCenterId: string | null = null,
  ): Promise<Map<string, Movement>> {
    const grouped = await this.prisma.db.journalEntryLine.groupBy({
      by: ['accountId', 'type'],
      where: {
        companyId,
        ...(costCenterId ? { costCenterId } : {}),
        entry: { competenceDate: competence },
      },
      _sum: { amount: true },
    });

    const result = new Map<string, Movement>();
    for (const row of grouped) {
      const current = result.get(row.accountId) ?? { debit: ZERO, credit: ZERO };
      const amount = row._sum.amount ?? ZERO;
      if (row.type === JournalLineType.DEBITO) {
        current.debit = current.debit.plus(amount);
      } else {
        current.credit = current.credit.plus(amount);
      }
      result.set(row.accountId, current);
    }
    return result;
  }

  private async movementOf(
    companyId: string,
    accountId: string,
    competence: Prisma.DateTimeFilter,
    costCenterId: string | null = null,
  ): Promise<Movement> {
    const grouped = await this.prisma.db.journalEntryLine.groupBy({
      by: ['type'],
      where: {
        companyId,
        accountId,
        ...(costCenterId ? { costCenterId } : {}),
        entry: { competenceDate: competence },
      },
      _sum: { amount: true },
    });

    const movement: Movement = { debit: ZERO, credit: ZERO };
    for (const row of grouped) {
      const amount = row._sum.amount ?? ZERO;
      if (row.type === JournalLineType.DEBITO) {
        movement.debit = movement.debit.plus(amount);
      } else {
        movement.credit = movement.credit.plus(amount);
      }
    }
    return movement;
  }

  /**
   * Centro de custo do recorte, confrontado com a empresa ativa (UI-057).
   *
   * Um id de outra empresa só devolveria relatório zerado — o filtro por
   * `companyId` e a RLS já garantem isso —, mas zerado parece "sem movimento".
   * O 404 diz a verdade: o centro não existe para esta empresa.
   */
  private async costCenterScope(
    companyId: string,
    costCenterId: string | undefined,
  ): Promise<string | null> {
    if (!costCenterId) return null;
    const costCenter = await this.prisma.db.costCenter.findFirst({
      where: { id: costCenterId, companyId },
      select: { id: true },
    });
    if (!costCenter) {
      throw new NotFoundException('Centro de custo não encontrado.');
    }
    return costCenter.id;
  }

  /** Saldo na natureza da conta: devedora soma débito, credora soma crédito. */
  private balanceOf(nature: AccountNature, movement: Movement): Prisma.Decimal {
    return nature === AccountNature.DEVEDORA
      ? movement.debit.minus(movement.credit)
      : movement.credit.minus(movement.debit);
  }

  /** Janela de competência, validada como dia civil. */
  private range(from: string, to: string): { from: Date; to: Date } {
    const start = toDateOnly(from);
    const end = toDateOnly(to);
    if (end.getTime() < start.getTime()) {
      throw new BadRequestException('`to` não pode ser anterior a `from`.');
    }
    return { from: start, to: end };
  }
}
