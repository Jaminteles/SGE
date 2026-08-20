import { Injectable } from '@nestjs/common';
import { Prisma, ReconciliationStatus, TransactionDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toDateOnly } from '../../common/utils/date-only';
import { QueryDivergenceDto } from './dto/reconciliation.dto';
import { RECONCILIATION_FIELDS } from './reconciliations.service';

const ZERO = new Prisma.Decimal(0);

/** Quantos itens de cada lista o painel devolve. O resto se consulta filtrado. */
const SAMPLE_SIZE = 50;

/** Recorte de período aplicado a colunas `date` de tabelas diferentes. */
interface DatePeriod {
  gte?: Date;
  lte?: Date;
}

/**
 * Divergências da conciliação (RF-076).
 *
 * São quatro perguntas diferentes, e cada uma revela um problema diferente:
 *
 *  1. **movimento sem par** — o banco fez algo que não está lançado. Pode ser
 *     tarifa não cadastrada, recebimento de cliente sem título, ou pagamento
 *     feito fora do sistema;
 *  2. **movimento conciliado em parte** — o valor do extrato não foi todo
 *     atribuído. É o caso do depósito que quita várias parcelas e sobrou;
 *  3. **vínculo com diferença** — alguém conciliou aceitando que os valores não
 *     batem, e justificou. É a lista que a contabilidade precisa ver;
 *  4. **baixa sem movimento** — nós lançamos, o banco não confirmou. É a mais
 *     grave das quatro: um pagamento que o sistema considera feito e que não
 *     aparece no extrato.
 *
 * O painel devolve totais e uma amostra, não a lista inteira: uma conta com um
 * ano de pendências não cabe numa resposta, e quem investiga desce pelos
 * filtros de `/reconciliation` e `/reconciliation/pending`.
 *
 * Nenhuma consulta aqui usa `$queryRaw`: o `where` do Prisma cobre tudo o que
 * é preciso, e o filtro de empresa continua sendo a RLS, não o SQL.
 */
@Injectable()
export class DivergencesService {
  constructor(private readonly prisma: PrismaService) {}

  async find(companyId: string, query: QueryDivergenceDto) {
    const period = {
      ...(query.from ? { gte: toDateOnly(query.from) } : {}),
      ...(query.to ? { lte: toDateOnly(query.to) } : {}),
    };
    const hasPeriod = Object.keys(period).length > 0;

    const movementWhere: Prisma.BankTransactionWhereInput = {
      companyId,
      ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
      ...(hasPeriod ? { movementDate: period } : {}),
    };

    const [unreconciled, partial, divergent, settlements, accounts] = await Promise.all([
      this.summarize({ ...movementWhere, reconciliationStatus: 'NAO_CONCILIADO' }),
      this.summarize({ ...movementWhere, reconciliationStatus: 'DIVERGENTE' }),
      this.divergentLinks(companyId, query, hasPeriod ? period : undefined),
      this.settlementsWithoutMovement(companyId, query, hasPeriod ? period : undefined),
      this.balances(companyId, query.bankAccountId),
    ]);

    return {
      period: { from: query.from ?? null, to: query.to ?? null },
      bankAccountId: query.bankAccountId ?? null,
      /** Extrato sem lançamento nosso. */
      unreconciled,
      /** Extrato atribuído em parte. */
      partiallyReconciled: partial,
      /** Vínculos que alguém aceitou com diferença. */
      divergentLinks: divergent,
      /** Lançamento nosso sem extrato que o confirme. */
      settlementsWithoutMovement: settlements,
      /** Saldo informado pelo banco, para conferência visual. */
      accounts,
    };
  }

  /** Contagem e total por sentido, mais uma amostra dos movimentos. */
  private async summarize(where: Prisma.BankTransactionWhereInput) {
    const [grouped, sample] = await Promise.all([
      this.prisma.db.bankTransaction.groupBy({
        by: ['direction'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.db.bankTransaction.findMany({
        where,
        orderBy: [{ movementDate: 'asc' }],
        take: SAMPLE_SIZE,
        select: {
          id: true,
          bankAccountId: true,
          movementDate: true,
          direction: true,
          amount: true,
          description: true,
          reconciliationStatus: true,
        },
      }),
    ]);

    const byDirection = (direction: TransactionDirection) =>
      grouped.find((row) => row.direction === direction);

    return {
      count: grouped.reduce((total, row) => total + row._count._all, 0),
      debitTotal: byDirection(TransactionDirection.DEBITO)?._sum.amount ?? ZERO,
      creditTotal: byDirection(TransactionDirection.CREDITO)?._sum.amount ?? ZERO,
      sample,
    };
  }

  private async divergentLinks(companyId: string, query: QueryDivergenceDto, period?: DatePeriod) {
    const where: Prisma.ReconciliationWhereInput = {
      companyId,
      undoneAt: null,
      hasDivergence: true,
      ...(query.bankAccountId || period
        ? {
            bankTransaction: {
              ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
              ...(period ? { movementDate: period } : {}),
            },
          }
        : {}),
    };

    const [count, items] = await Promise.all([
      this.prisma.db.reconciliation.count({ where }),
      this.prisma.db.reconciliation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: SAMPLE_SIZE,
        select: {
          ...RECONCILIATION_FIELDS,
          bankTransaction: {
            select: { movementDate: true, direction: true, amount: true, description: true },
          },
        },
      }),
    ]);

    return { count, sample: items };
  }

  /**
   * Baixas lançadas numa conta bancária que nenhum movimento do extrato
   * confirma.
   *
   * O filtro de conta é obrigatório para a pergunta fazer sentido: baixa em
   * dinheiro, sem conta bancária, não tem extrato onde aparecer e não é
   * divergência.
   */
  private async settlementsWithoutMovement(
    companyId: string,
    query: QueryDivergenceDto,
    period?: DatePeriod,
  ) {
    const where: Prisma.SettlementWhereInput = {
      companyId,
      isReversed: false,
      reversalOfId: null,
      bankAccountId: query.bankAccountId ?? { not: null },
      ...(period ? { settlementDate: period } : {}),
    };

    const candidates = await this.prisma.db.settlement.findMany({
      where,
      orderBy: [{ settlementDate: 'desc' }],
      take: 500,
      select: {
        id: true,
        settlementDate: true,
        totalAmount: true,
        bankAccountId: true,
        installmentId: true,
        transactionId: true,
      },
    });

    if (candidates.length === 0) {
      return { count: 0, sample: [] };
    }

    // Uma consulta só para todas as baixas da amostra: perguntar por baixa
    // seria N+1 numa lista que costuma ter centenas de linhas.
    const linked = await this.prisma.db.reconciliation.findMany({
      where: {
        companyId,
        undoneAt: null,
        settlementId: { in: candidates.map((settlement) => settlement.id) },
      },
      select: { settlementId: true },
    });
    const reconciledIds = new Set(linked.map((link) => link.settlementId));

    const orphans = candidates.filter((settlement) => !reconciledIds.has(settlement.id));

    return { count: orphans.length, sample: orphans.slice(0, SAMPLE_SIZE) };
  }

  /** Saldo que o banco informou no último extrato, por conta (RF-076). */
  private async balances(companyId: string, bankAccountId?: string) {
    const accounts = await this.prisma.db.companyBankAccount.findMany({
      where: { companyId, isActive: true, ...(bankAccountId ? { id: bankAccountId } : {}) },
      orderBy: [{ description: 'asc' }],
      select: {
        id: true,
        description: true,
        bankCode: true,
        agency: true,
        account: true,
        currentBalance: true,
        balanceDate: true,
      },
    });

    const pending = await this.prisma.db.bankTransaction.groupBy({
      by: ['bankAccountId'],
      where: {
        companyId,
        ...(bankAccountId ? { bankAccountId } : {}),
        reconciliationStatus: {
          in: [ReconciliationStatus.NAO_CONCILIADO, ReconciliationStatus.DIVERGENTE],
        },
      },
      _count: { _all: true },
      _sum: { amount: true },
    });

    return accounts.map((account) => {
      const row = pending.find((entry) => entry.bankAccountId === account.id);
      return {
        ...account,
        pendingCount: row?._count._all ?? 0,
        pendingAmount: row?._sum.amount ?? ZERO,
      };
    });
  }
}
