import { Injectable, Logger } from '@nestjs/common';
import { AuditEvent, EntryType, PaymentMethodType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_ENTITY, AuditService } from '../../common/audit/audit.service';

const ZERO = new Prisma.Decimal(0);

/**
 * Baixa do título a partir da ordem confirmada (RF-057 + RF-062, RN-004).
 *
 * É o ponto onde o módulo bancário toca o financeiro, e ele é estreito de
 * propósito: uma única função, chamada só quando a transação chega a
 * CONFIRMADA, e idempotente por construção.
 *
 * Três camadas garantem que o mesmo pagamento não vire duas baixas:
 *   1. a consulta prévia por `transactionId`, que resolve o caso comum
 *      (webhook duplicado, retry do worker);
 *   2. o índice único `ux_baixa_transacao_pagamento` (bd/13 §6), que resolve o
 *      caso concorrente — dois processos ao mesmo tempo;
 *   3. o trigger `trg_valida_baixa_transacao`, que recusa a baixa de uma
 *      transação não confirmada ou emitida para outra parcela.
 *
 * Sobre a divisão do valor: o principal abate o saldo da parcela, e é ele que
 * define a situação dela (bd/09). O que exceder o saldo é encargo — pagar
 * R$ 1.030 numa parcela de R$ 1.000 é quitar o principal e R$ 30 de juros, não
 * criar saldo negativo.
 */
@Injectable()
export class PaymentSettlementsService {
  private readonly logger = new Logger(PaymentSettlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Gera a baixa da parcela vinculada à transação, se ainda não existir.
   * Devolve o id da baixa, ou `null` quando a ordem não liquida parcela alguma.
   */
  async settle(transaction: {
    id: string;
    companyId: string;
    bankAccountId: string;
    installmentId: string | null;
    amount: Prisma.Decimal;
    method: PaymentMethodType;
    description: string | null;
    confirmedAt: Date | null;
  }): Promise<string | null> {
    if (!transaction.installmentId) {
      return null;
    }

    const existing = await this.prisma.db.settlement.findFirst({
      where: { transactionId: transaction.id, reversalOfId: null },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }

    const installment = await this.prisma.db.financialInstallment.findFirst({
      where: { id: transaction.installmentId, companyId: transaction.companyId },
      select: {
        id: true,
        number: true,
        totalInstallments: true,
        balance: true,
        entry: { select: { number: true, type: true } },
      },
    });
    if (!installment) {
      // A FK composta (bd/13 §1) impede que isso aconteça por id de outra
      // empresa; sobra o caso de a parcela ter sido removida com o título.
      this.logger.error(
        `Transação ${transaction.id} confirmada aponta para parcela inexistente ${transaction.installmentId}.`,
      );
      return null;
    }

    const principal = Prisma.Decimal.min(transaction.amount, installment.balance);
    const charges = transaction.amount.minus(principal);

    const settlement = await this.prisma.db.settlement.create({
      data: {
        companyId: transaction.companyId,
        installmentId: installment.id,
        settlementDate: transaction.confirmedAt ?? new Date(),
        principalAmount: principal,
        interestAmount: charges.greaterThan(ZERO) ? charges : ZERO,
        method: transaction.method,
        bankAccountId: transaction.bankAccountId,
        transactionId: transaction.id,
        note: transaction.description ?? undefined,
      },
      select: { id: true },
    });

    await this.audit.record({
      event:
        installment.entry.type === EntryType.PAGAR ? AuditEvent.PAGAMENTO : AuditEvent.RECEBIMENTO,
      entity: AUDIT_ENTITY.SETTLEMENT,
      entityId: installment.id,
      companyId: transaction.companyId,
      note:
        `Baixa gerada pela transação bancária ${transaction.id}: título ${installment.entry.number}, ` +
        `parcela ${installment.number}/${installment.totalInstallments}, principal ${principal.toFixed(2)}.`,
    });

    return settlement.id;
  }
}
