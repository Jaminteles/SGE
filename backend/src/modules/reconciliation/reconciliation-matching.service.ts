import { Injectable, NotFoundException } from '@nestjs/common';
import { EntryType, Prisma, TransactionDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toDateOnly } from '../../common/utils/date-only';
import { BankTransactionIdentifierService } from './bank-transaction-identifier.service';
import { QuerySuggestionDto } from './dto/reconciliation.dto';

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/** Peso de cada evidência. Somam 100 — o score é lido como porcentagem. */
const WEIGHT = {
  amount: 45,
  dueDate: 25,
  document: 15,
  partner: 15,
} as const;

/** Acima disto a correspondência é considerada inequívoca (RF-075). */
export const EXACT_MATCH_SCORE = new Prisma.Decimal(95);

export interface MatchCandidate {
  installmentId: string;
  entryId: string;
  entryNumber: string;
  entryType: EntryType;
  partnerId: string | null;
  partnerName: string | null;
  description: string;
  installmentNumber: number;
  totalInstallments: number;
  dueDate: Date;
  balance: Prisma.Decimal;
  /** Dias entre a data do movimento e o vencimento. Negativo = antecipado. */
  dayGap: number;
  /** Movimento menos saldo da parcela. Zero é correspondência exata de valor. */
  difference: Prisma.Decimal;
  score: Prisma.Decimal;
  reasons: string[];
}

export interface MatchOptions {
  dayTolerance: number;
  valueTolerance: Prisma.Decimal;
  limit: number;
}

const DEFAULT_OPTIONS: MatchOptions = {
  dayTolerance: 5,
  valueTolerance: ZERO,
  limit: 5,
};

/**
 * Sugestão de correspondência entre movimento bancário e parcela (RF-073).
 *
 * O serviço **não escreve nada**: ele responde "destas parcelas, estas são as
 * candidatas, nesta ordem, por estes motivos". Quem grava o vínculo é
 * `ReconciliationsService` (manual) ou `AutoReconciliationService` (regra) — e
 * essa separação é o que permite a mesma pontuação servir à tela de conciliação
 * e ao processo em lote sem duas implementações que divergem com o tempo.
 *
 * Três decisões que moldam o resultado:
 *
 *  1. **o sentido restringe antes de pontuar** — crédito no extrato só olha
 *     título a RECEBER, débito só a PAGAR. Não é um critério com peso: é um
 *     filtro. Um pagamento sugerido para o dinheiro que entrou não é uma
 *     sugestão fraca, é uma sugestão errada;
 *  2. **valor pesa mais que data** — vencimento se prorroga o tempo todo; o
 *     valor pago é o que o banco confirma;
 *  3. **o score é `Decimal`, não `number`** — ele é comparado com `minScore`,
 *     que vem da regra cadastrada pelo cliente, e comparação de limiar com
 *     ponto flutuante decide diferente conforme o valor.
 */
@Injectable()
export class ReconciliationMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifier: BankTransactionIdentifierService,
  ) {}

  /** Candidatas para um movimento, da API (RF-073). */
  async suggest(companyId: string, bankTransactionId: string, query: QuerySuggestionDto) {
    const movement = await this.prisma.db.bankTransaction.findFirst({
      where: { id: bankTransactionId, companyId },
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
    if (!movement) {
      throw new NotFoundException('Movimento bancário não encontrado.');
    }

    const options: MatchOptions = {
      dayTolerance: query.dayTolerance ?? DEFAULT_OPTIONS.dayTolerance,
      valueTolerance: query.valueTolerance
        ? new Prisma.Decimal(query.valueTolerance)
        : DEFAULT_OPTIONS.valueTolerance,
      limit: query.limit ?? DEFAULT_OPTIONS.limit,
    };

    const identification = await this.identifier.resolve(companyId, movement);
    const candidates = await this.findCandidates(companyId, movement, options, identification);

    return {
      bankTransactionId: movement.id,
      movementDate: movement.movementDate,
      direction: movement.direction,
      amount: movement.amount,
      reconciliationStatus: movement.reconciliationStatus,
      identification,
      candidates,
    };
  }

  /**
   * Núcleo reaproveitado pela conciliação automática (RF-075).
   *
   * `alreadyReconciled` é descontado do valor do movimento antes de comparar:
   * um crédito de R$ 3.000 que já quitou R$ 1.000 procura parcela de R$ 2.000,
   * não de R$ 3.000.
   */
  async findCandidates(
    companyId: string,
    movement: {
      id: string;
      movementDate: Date;
      direction: TransactionDirection;
      amount: Prisma.Decimal;
      description?: string | null;
      document?: string | null;
      counterpartName?: string | null;
    },
    options: MatchOptions,
    identification?: { partnerId?: string; reference?: string },
    alreadyReconciled: Prisma.Decimal = ZERO,
  ): Promise<MatchCandidate[]> {
    const remaining = movement.amount.minus(alreadyReconciled);
    if (remaining.lessThanOrEqualTo(ZERO)) {
      return [];
    }

    const entryType =
      movement.direction === TransactionDirection.CREDITO ? EntryType.RECEBER : EntryType.PAGAR;

    const windowStart = shiftDays(movement.movementDate, -options.dayTolerance);
    const windowEnd = shiftDays(movement.movementDate, options.dayTolerance);

    // O filtro de valor é uma faixa no banco, e não um `Math.abs` em memória:
    // uma conta com um ano de parcelas em aberto não cabe no processo.
    const minAmount = remaining.minus(options.valueTolerance);
    const maxAmount = remaining.plus(options.valueTolerance);

    const installments = await this.prisma.db.financialInstallment.findMany({
      where: {
        companyId,
        status: { in: ['ABERTA', 'PARCIALMENTE_LIQUIDADA'] },
        dueDate: { gte: windowStart, lte: windowEnd },
        balance: { gte: minAmount.lessThan(ZERO) ? ZERO : minAmount, lte: maxAmount },
        entry: { type: entryType, status: { not: 'CANCELADO' } },
        // Uma parcela já conciliada com este movimento não é candidata de novo.
        reconciliations: { none: { bankTransactionId: movement.id, undoneAt: null } },
      },
      select: {
        id: true,
        number: true,
        totalInstallments: true,
        dueDate: true,
        balance: true,
        bankIdentifier: true,
        digitableLine: true,
        barcode: true,
        entry: {
          select: {
            id: true,
            number: true,
            type: true,
            description: true,
            documentReference: true,
            partnerId: true,
            partner: { select: { legalName: true, tradeName: true } },
          },
        },
      },
      // Teto de segurança: mesmo com a faixa, um período largo pode trazer
      // muita parcela, e pontuar todas não melhora a sugestão.
      take: 200,
    });

    const candidates = installments.map((installment) =>
      this.score(movement, remaining, installment, options, identification),
    );

    return candidates
      .sort((a, b) => b.score.comparedTo(a.score) || a.dayGap - b.dayGap)
      .slice(0, options.limit);
  }

  private score(
    movement: {
      movementDate: Date;
      description?: string | null;
      document?: string | null;
      counterpartName?: string | null;
    },
    remaining: Prisma.Decimal,
    installment: {
      id: string;
      number: number;
      totalInstallments: number;
      dueDate: Date;
      balance: Prisma.Decimal;
      bankIdentifier: string | null;
      digitableLine: string | null;
      barcode: string | null;
      entry: {
        id: string;
        number: string;
        type: EntryType;
        description: string;
        documentReference: string | null;
        partnerId: string | null;
        partner: { legalName: string; tradeName: string | null } | null;
      };
    },
    options: MatchOptions,
    identification?: { partnerId?: string; reference?: string },
  ): MatchCandidate {
    const reasons: string[] = [];
    let score = ZERO;

    const difference = remaining.minus(installment.balance);
    const absDifference = difference.abs();

    if (absDifference.isZero()) {
      score = score.plus(WEIGHT.amount);
      reasons.push('valor idêntico ao saldo da parcela');
    } else if (options.valueTolerance.greaterThan(ZERO)) {
      // Dentro da tolerância, o peso cai proporcionalmente à distância.
      const ratio = Prisma.Decimal.max(
        ZERO,
        HUNDRED.minus(absDifference.div(options.valueTolerance).times(HUNDRED)),
      );
      score = score.plus(ratio.times(WEIGHT.amount).div(HUNDRED));
      reasons.push(`diferença de ${absDifference.toFixed(2)} dentro da tolerância`);
    }

    const dayGap = daysBetween(installment.dueDate, movement.movementDate);
    const absGap = Math.abs(dayGap);
    if (absGap === 0) {
      score = score.plus(WEIGHT.dueDate);
      reasons.push('pago na data do vencimento');
    } else if (options.dayTolerance > 0) {
      const ratio = Math.max(0, 1 - absGap / options.dayTolerance);
      score = score.plus(new Prisma.Decimal(ratio * WEIGHT.dueDate).toDecimalPlaces(2));
      reasons.push(`${absGap} dia(s) do vencimento`);
    }

    if (this.documentMatches(movement, installment, identification)) {
      score = score.plus(WEIGHT.document);
      reasons.push('documento do extrato confere com o título');
    }

    if (identification?.partnerId && identification.partnerId === installment.entry.partnerId) {
      score = score.plus(WEIGHT.partner);
      reasons.push('contraparte identificada é o parceiro do título');
    }

    return {
      installmentId: installment.id,
      entryId: installment.entry.id,
      entryNumber: installment.entry.number,
      entryType: installment.entry.type,
      partnerId: installment.entry.partnerId,
      partnerName:
        installment.entry.partner?.tradeName ?? installment.entry.partner?.legalName ?? null,
      description: installment.entry.description,
      installmentNumber: installment.number,
      totalInstallments: installment.totalInstallments,
      dueDate: installment.dueDate,
      balance: installment.balance,
      dayGap,
      difference,
      score: Prisma.Decimal.min(HUNDRED, score).toDecimalPlaces(2),
      reasons,
    };
  }

  /**
   * Nosso número, linha digitável, código de barras ou referência do título
   * aparecendo no extrato.
   *
   * Comparação por igualdade sobre dígitos, nunca por `includes` de um lado
   * curto: "123" está contido em quase todo identificador bancário.
   */
  private documentMatches(
    movement: { description?: string | null; document?: string | null },
    installment: {
      bankIdentifier: string | null;
      digitableLine: string | null;
      barcode: string | null;
      entry: { documentReference: string | null };
    },
    identification?: { reference?: string },
  ): boolean {
    const known = [
      installment.bankIdentifier,
      installment.digitableLine,
      installment.barcode,
      installment.entry.documentReference,
    ]
      .map((value) => value?.replace(/\D/g, ''))
      .filter((value): value is string => Boolean(value) && value!.length >= 6);

    if (known.length === 0) {
      return false;
    }

    const seen = [movement.document, identification?.reference]
      .map((value) => value?.replace(/\D/g, ''))
      .filter((value): value is string => Boolean(value) && value!.length >= 6);

    if (seen.some((value) => known.includes(value))) {
      return true;
    }

    // O histórico costuma trazer o identificador colado em outro texto; aqui o
    // lado longo é o que contém, e o curto é o identificador conhecido.
    const digits = movement.description?.replace(/\D/g, '') ?? '';
    return digits.length >= 6 && known.some((value) => digits.includes(value));
  }
}

/** Diferença em dias civis entre duas colunas `date` (ambas em UTC). */
function daysBetween(from: Date, to: Date): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / dayMs);
}

function shiftDays(date: Date, days: number): Date {
  const shifted = new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  return toDateOnly(shifted.toISOString().slice(0, 10));
}
