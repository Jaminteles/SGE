import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditEvent, EntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, AUDIT_ENTITY } from '../../common/audit/audit.service';
import { ReferencesService } from '../../common/references/references.service';
import { toDateOnly } from '../../common/utils/date-only';
import { CreateSettlementDto, ReverseSettlementDto } from './dto/create-settlement.dto';
import { InstallmentsService, OPEN_INSTALLMENT_STATUSES } from './installments.service';

/** Encargos apurados pelo banco para a parcela na data de hoje (bd/09). */
interface LateChargesRow {
  dias_atraso: number;
  encargos: Prisma.Decimal;
  saldo: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Pagamentos e recebimentos (RF-057) — `gestao.titulo_baixa`.
 *
 * A baixa é a única porta de entrada da liquidação: saldo, situação e encargos
 * acumulados da parcela — e, por consequência, do título — são projetados pelo
 * banco a partir dela (bd/09). Não existe alteração nem remoção: a role da
 * aplicação não tem esses privilégios, e estornar é inserir o lançamento
 * espelho, que marca a baixa original.
 *
 * As validações abaixo repetem regras que o banco também aplica. A duplicação é
 * proposital: aqui elas viram 400/409 com a mensagem do domínio, em vez de 500
 * de violação de integridade.
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly installments: InstallmentsService,
    private readonly references: ReferencesService,
    private readonly audit: AuditService,
  ) {}

  async create(
    companyId: string,
    entryId: string,
    installmentId: string,
    dto: CreateSettlementDto,
    userId: string,
  ) {
    const installment = await this.installments.findOne(companyId, entryId, installmentId);
    await this.references.assert(companyId, { paymentMethodId: dto.paymentMethodId });

    if (!OPEN_INSTALLMENT_STATUSES.includes(installment.status)) {
      throw new ConflictException(
        `A parcela ${installment.number}/${installment.totalInstallments} está ${installment.status} e não aceita baixa.`,
      );
    }

    const principal = new Prisma.Decimal(dto.principalAmount);
    if (principal.lessThanOrEqualTo(0)) {
      throw new BadRequestException('O principal quitado deve ser maior que zero.');
    }
    if (principal.greaterThan(installment.balance)) {
      throw new BadRequestException(
        `A baixa de ${principal.toFixed(2)} excede o saldo de ${installment.balance.toFixed(2)} da parcela.`,
      );
    }

    const { interest, penalty } = await this.resolveCharges(installmentId, dto);
    const discount = new Prisma.Decimal(dto.discountAmount ?? '0');
    if (discount.greaterThan(principal.plus(interest).plus(penalty))) {
      throw new BadRequestException('O desconto não pode superar o valor da baixa.');
    }

    return this.prisma.transaction(async () => {
      await this.prisma.db.settlement.create({
        data: {
          companyId,
          installmentId,
          settlementDate: dto.settlementDate ? toDateOnly(dto.settlementDate) : new Date(),
          principalAmount: principal,
          interestAmount: interest,
          penaltyAmount: penalty,
          discountAmount: discount,
          // `totalAmount` é calculado pelo trigger de bd/09 a partir das quatro
          // parcelas acima; enviá-lo daqui criaria uma segunda fórmula.
          paymentMethodId: dto.paymentMethodId,
          method: dto.method,
          note: dto.note,
          createdById: userId,
        },
        select: { id: true },
      });

      // RF-114: pagamento e recebimento são eventos de negócio, e a trilha os
      // distingue de uma inserção qualquer — é por eles que se audita caixa.
      await this.audit.record({
        event:
          installment.entry.type === EntryType.PAGAR
            ? AuditEvent.PAGAMENTO
            : AuditEvent.RECEBIMENTO,
        entity: AUDIT_ENTITY.SETTLEMENT,
        entityId: installmentId,
        note: `Título ${installment.entry.number}, parcela ${installment.number}/${installment.totalInstallments}: principal ${principal.toFixed(2)}.`,
      });

      return this.installments.findOne(companyId, entryId, installmentId);
    });
  }

  /**
   * Estorna a baixa (RF-057).
   *
   * Não apaga nada: insere o lançamento espelho apontando para a original, e o
   * banco marca a original como estornada e devolve o saldo à parcela. O par
   * (baixa, estorno) continua visível — que é a diferença entre corrigir um
   * lançamento e fazer o registro dele desaparecer.
   */
  async reverse(
    companyId: string,
    entryId: string,
    installmentId: string,
    settlementId: string,
    dto: ReverseSettlementDto,
    userId: string,
  ) {
    const installment = await this.installments.findOne(companyId, entryId, installmentId);
    const original = installment.settlements.find((s) => s.id === settlementId);

    if (!original) {
      throw new NotFoundException('Baixa não encontrada nesta parcela.');
    }
    if (original.reversalOfId) {
      throw new ConflictException('Um lançamento de estorno não é estornado.');
    }
    if (original.isReversed) {
      throw new ConflictException('Esta baixa já foi estornada.');
    }

    return this.prisma.transaction(async () => {
      await this.prisma.db.settlement.create({
        data: {
          companyId,
          installmentId,
          settlementDate: new Date(),
          principalAmount: original.principalAmount,
          interestAmount: original.interestAmount,
          penaltyAmount: original.penaltyAmount,
          discountAmount: original.discountAmount,
          paymentMethodId: original.paymentMethodId,
          method: original.method,
          reversalOfId: settlementId,
          reversalReason: dto.reason,
          createdById: userId,
        },
        select: { id: true },
      });

      await this.audit.record({
        event: AuditEvent.ESTORNO,
        entity: AUDIT_ENTITY.SETTLEMENT,
        entityId: settlementId,
        note: `Estorno da baixa de ${original.totalAmount.toFixed(2)} no título ${installment.entry.number}: ${dto.reason}`,
      });

      return this.installments.findOne(companyId, entryId, installmentId);
    });
  }

  /**
   * Juros e multa da baixa (RF-055).
   *
   * Informados, valem os informados — negociar encargo é decisão de quem cobra.
   * Com `applyLateCharges`, vêm da mesma conta que a carteira mostra
   * (`vw_parcela_posicao`), para que o valor cobrado seja exatamente o valor
   * exibido ao cliente.
   */
  private async resolveCharges(installmentId: string, dto: CreateSettlementDto) {
    const informed = {
      interest: dto.interestAmount != null ? new Prisma.Decimal(dto.interestAmount) : null,
      penalty: dto.penaltyAmount != null ? new Prisma.Decimal(dto.penaltyAmount) : null,
    };

    if (!dto.applyLateCharges || (informed.interest && informed.penalty)) {
      return { interest: informed.interest ?? ZERO, penalty: informed.penalty ?? ZERO };
    }

    const [position] = await this.prisma.db.$queryRaw<LateChargesRow[]>`
      SELECT dias_atraso, encargos, saldo
        FROM vw_parcela_posicao
       WHERE titulo_parcela_id = ${installmentId}::uuid
    `;

    if (!position || position.dias_atraso <= 0) {
      return { interest: informed.interest ?? ZERO, penalty: informed.penalty ?? ZERO };
    }

    // A view devolve o encargo total; a separação entre multa e juros é
    // refeita aqui pelas mesmas taxas, para que a baixa registre cada natureza
    // na sua coluna — o relatório fiscal precisa delas separadas.
    const installment = await this.prisma.db.financialInstallment.findUniqueOrThrow({
      where: { id: installmentId },
      select: { balance: true, dailyInterestRate: true, penaltyRate: true },
    });

    const penalty = installment.balance
      .times(installment.penaltyRate)
      .dividedBy(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const interest = position.encargos.minus(penalty);

    return {
      interest: informed.interest ?? (interest.isNegative() ? ZERO : interest),
      penalty: informed.penalty ?? penalty,
    };
  }
}
