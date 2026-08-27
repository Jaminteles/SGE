import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntryType, JournalLineType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JOURNAL_ORIGINS } from './accounting.constants';
import { JournalEntryResponse } from './accounting.mapper';
import { JournalEntriesService, PostingLine } from './journal-entries.service';

const ZERO = new Prisma.Decimal(0);

/**
 * Contabilização das operações financeiras (RF-080/RF-081).
 *
 * A ponte entre o financeiro e a contabilidade é a **classificação**: a conta
 * bancária diz qual é a conta de caixa, e a categoria (ou o próprio título) diz
 * qual é a contrapartida. Sem as duas, este serviço recusa em vez de escolher
 * uma conta plausível — um lançamento em conta errada é pior do que lançamento
 * nenhum, porque some no meio de milhares de linhas certas.
 *
 * A baixa é a operação contabilizada, e não o título: é a baixa que move
 * dinheiro. Um título a pagar em aberto é obrigação registrada no financeiro;
 * o que entra no razão de caixa é o pagamento dele.
 *
 * Idempotência: um lançamento por baixa, sustentado pelo índice parcial
 * `ux_lancamento_origem` (bd/17 §5). Chamar duas vezes devolve o mesmo
 * lançamento — sem isso, um retry dobraria a despesa no resultado do mês.
 */
@Injectable()
export class JournalPostingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entries: JournalEntriesService,
  ) {}

  /**
   * Contabiliza uma baixa de título (RF-080/RF-081).
   *
   * PAGAR:   débito na contrapartida (despesa/obrigação), crédito no banco.
   * RECEBER: débito no banco, crédito na contrapartida (receita/direito).
   */
  async postSettlement(
    companyId: string,
    settlementId: string,
    userId: string,
  ): Promise<JournalEntryResponse> {
    const existing = await this.entries.findByOrigin(
      companyId,
      JOURNAL_ORIGINS.SETTLEMENT,
      settlementId,
    );
    if (existing) {
      // O retry recebe o lançamento que já existe, não um 409: quem chamou
      // precisa do id, não de um erro.
      return existing;
    }

    const settlement = await this.prisma.db.settlement.findFirst({
      where: { id: settlementId, companyId },
      select: {
        id: true,
        settlementDate: true,
        totalAmount: true,
        bankAccountId: true,
        isReversed: true,
        installment: {
          select: {
            number: true,
            entry: {
              select: {
                type: true,
                number: true,
                description: true,
                branchId: true,
                costCenterId: true,
                ledgerAccountId: true,
                category: { select: { code: true, ledgerAccountId: true } },
              },
            },
          },
        },
      },
    });

    if (!settlement) {
      throw new NotFoundException('Baixa não encontrada.');
    }
    if (settlement.isReversed) {
      throw new ConflictException(
        'Baixa estornada não se contabiliza: o estorno é que precisa ser lançado.',
      );
    }
    if (settlement.totalAmount.lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException('Baixa sem valor não produz lançamento.');
    }

    const entry = settlement.installment.entry;
    const cashAccountId = await this.resolveCashAccount(companyId, settlement.bankAccountId);
    const counterpartAccountId = this.resolveCounterpartAccount(entry);

    const history =
      `Baixa do título ${entry.type} ${entry.number}, parcela ${settlement.installment.number}: ` +
      entry.description;

    const isPayable = entry.type === EntryType.PAGAR;
    const lines: PostingLine[] = [
      {
        accountId: isPayable ? counterpartAccountId : cashAccountId,
        type: JournalLineType.DEBITO,
        amount: settlement.totalAmount,
        costCenterId: entry.costCenterId ?? undefined,
      },
      {
        accountId: isPayable ? cashAccountId : counterpartAccountId,
        type: JournalLineType.CREDITO,
        amount: settlement.totalAmount,
        costCenterId: entry.costCenterId ?? undefined,
      },
    ];

    return this.entries.post(companyId, {
      entryDate: settlement.settlementDate,
      // Competência da baixa é a data em que o caixa se moveu — não a
      // competência do título, que já foi reconhecida quando ele nasceu.
      competenceDate: settlement.settlementDate,
      history: history.slice(0, 500),
      lines,
      origin: JOURNAL_ORIGINS.SETTLEMENT,
      originId: settlement.id,
      settlementId: settlement.id,
      branchId: entry.branchId ?? undefined,
      createdById: userId,
    });
  }

  /**
   * Estorna o lançamento de uma baixa (RF-082).
   *
   * Existe porque a baixa estornada no financeiro deixaria, sem isto, um
   * lançamento vivo no razão de um pagamento que foi desfeito.
   */
  async reverseSettlementPosting(
    companyId: string,
    settlementId: string,
    reason: string,
    userId: string,
  ): Promise<JournalEntryResponse> {
    const posted = await this.entries.findByOrigin(
      companyId,
      JOURNAL_ORIGINS.SETTLEMENT,
      settlementId,
    );
    if (!posted) {
      throw new NotFoundException('Esta baixa não foi contabilizada.');
    }
    return this.entries.reverse(companyId, posted.id, { reason }, userId);
  }

  /** A conta de caixa vem da conta bancária da baixa (RF-080). */
  private async resolveCashAccount(
    companyId: string,
    bankAccountId: string | null,
  ): Promise<string> {
    if (!bankAccountId) {
      throw new BadRequestException(
        'A baixa não informa conta bancária: sem ela não há contrapartida de caixa para o lançamento.',
      );
    }

    const account = await this.prisma.db.companyBankAccount.findFirst({
      where: { id: bankAccountId, companyId },
      select: { description: true, ledgerAccountId: true },
    });
    if (!account) {
      throw new BadRequestException('Conta bancária não encontrada nesta empresa.');
    }
    if (!account.ledgerAccountId) {
      throw new BadRequestException(
        `A conta bancária "${account.description}" não tem conta contábil classificada (RF-080).`,
      );
    }
    return account.ledgerAccountId;
  }

  /**
   * A contrapartida vem do título ou, na falta dele, da categoria (RF-080).
   *
   * O título tem precedência porque é a classificação mais específica: uma
   * despesa lançada fora do padrão da categoria foi classificada a mão por
   * alguém que sabia o que estava fazendo.
   */
  private resolveCounterpartAccount(entry: {
    type: EntryType;
    number: string;
    ledgerAccountId: string | null;
    category: { code: string; ledgerAccountId: string | null } | null;
  }): string {
    const accountId = entry.ledgerAccountId ?? entry.category?.ledgerAccountId;
    if (!accountId) {
      throw new BadRequestException(
        entry.category
          ? `A categoria ${entry.category.code} não tem conta contábil classificada (RF-080).`
          : `O título ${entry.number} não tem categoria nem conta contábil: classifique-o antes de contabilizar.`,
      );
    }
    return accountId;
  }
}
