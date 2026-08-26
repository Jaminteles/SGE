import { Injectable } from '@nestjs/common';
import { EntryStatus, InstallmentStatus, Prisma } from '@prisma/client';
import { PERMISSIONS } from '../../../common/authorization/permission-catalog';
import { formatDateOnly, toDateOnly } from '../../../common/utils/date-only';
import { PrismaService } from '../../../prisma/prisma.service';
import { AutomationConditionsDto } from '../dto/automation-rule.dto';
import {
  DEFAULT_DUE_DAYS_AHEAD,
  LOOKBACK_DAYS,
  NOTIFICATION_TYPES,
  SCAN_BATCH_LIMIT,
} from '../notifications.constants';
import { AlertNotification, AlertRunnerService } from './alert-runner.service';

const DAY_MS = 86_400_000;

/** A parcela como o alerta precisa dela — nada além do que vai no texto. */
interface DueInstallment {
  id: string;
  number: number;
  totalInstallments: number;
  dueDate: Date;
  balance: Prisma.Decimal;
  entry: { id: string; type: string; number: string; description: string };
}

/**
 * Alerta de vencimento (RF-121).
 *
 * Avisa sobre **parcela**, não sobre título: é a parcela que vence, e um título
 * em seis parcelas geraria um aviso genérico e cinco silêncios se o alerta
 * olhasse só o cabeçalho.
 *
 * Duas janelas, e a distinção é do destinatário, não do sistema: o que **vai**
 * vencer ainda é decisão (pagar, prorrogar, cobrar); o que **já** venceu é
 * problema. Por isso a chave de dedupe separa as duas — quem foi avisado na
 * véspera é avisado de novo no dia em que a parcela virou atraso, e só nesse
 * dia: `VENCIDO` carrega a data da varredura, não a de vencimento, e é isso que
 * transforma o atraso em um lembrete diário em vez de um aviso único.
 *
 * O saldo em aberto é `Decimal` do início ao fim (RN-012); o texto formata na
 * saída, e nenhum float participa da comparação com `minAmount`.
 */
@Injectable()
export class DueDateAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AlertRunnerService,
  ) {}

  run(companyId: string): Promise<number> {
    return this.runner.run<DueInstallment>(companyId, {
      trigger: 'TITULO_VENCENDO',
      defaultPermission: PERMISSIONS.FINANCIAL_ENTRIES_READ,
      collect: (conditions) => this.collect(companyId, conditions),
      build: (installment) => this.build(installment),
    });
  }

  private async collect(
    companyId: string,
    conditions: AutomationConditionsDto,
  ): Promise<DueInstallment[]> {
    const today = this.today();
    const daysAhead = conditions.daysAhead ?? DEFAULT_DUE_DAYS_AHEAD;
    const includeOverdue = conditions.includeOverdue ?? true;

    const rows = await this.prisma.db.financialInstallment.findMany({
      where: {
        companyId,
        status: { in: [InstallmentStatus.ABERTA, InstallmentStatus.PARCIALMENTE_LIQUIDADA] },
        // Um único filtro de saldo: `minAmount` restringe o piso, mas nunca
        // deixa entrar parcela sem saldo em aberto.
        balance: {
          gt: 0,
          ...(conditions.minAmount ? { gte: new Prisma.Decimal(conditions.minAmount) } : {}),
        },
        dueDate: {
          // Sem o piso, a varredura reencontraria toda parcela em atraso desde
          // sempre a cada rodada — inclusive as que a cobrança já assumiu.
          gte: includeOverdue ? new Date(today.getTime() - LOOKBACK_DAYS * DAY_MS) : today,
          lte: new Date(today.getTime() + daysAhead * DAY_MS),
        },
        entry: {
          status: { notIn: [EntryStatus.CANCELADO, EntryStatus.LIQUIDADO] },
          ...(conditions.entryType ? { type: conditions.entryType } : {}),
        },
      },
      orderBy: { dueDate: 'asc' },
      take: SCAN_BATCH_LIMIT,
      select: {
        id: true,
        number: true,
        totalInstallments: true,
        dueDate: true,
        balance: true,
        entry: { select: { id: true, type: true, number: true, description: true } },
      },
    });

    return rows;
  }

  private build(installment: DueInstallment): AlertNotification {
    const today = this.today();
    const due = formatDateOnly(installment.dueDate);
    const overdue = installment.dueDate.getTime() < today.getTime();
    const amount = installment.balance.toFixed(2);
    const label = `${installment.entry.type} nº ${installment.entry.number}`;
    const part = `parcela ${installment.number}/${installment.totalInstallments}`;

    return {
      type: NOTIFICATION_TYPES.DUE_DATE,
      title: overdue ? `Parcela vencida: ${label}` : `Parcela a vencer: ${label}`,
      message: overdue
        ? `${label} (${part}) venceu em ${due} com R$ ${amount} em aberto: ${installment.entry.description}.`
        : `${label} (${part}) vence em ${due}, R$ ${amount}: ${installment.entry.description}.`,
      // Atraso é mais urgente do que véspera, e a caixa de entrada ordena por
      // prioridade antes de ordenar por data.
      priority: overdue ? 2 : 3,
      entity: 'titulo_parcela',
      entityId: installment.id,
      // O vencido relembra por dia; o a vencer avisa uma vez por vencimento.
      dedupeKey: overdue
        ? `VENCIMENTO:${installment.id}:VENCIDO:${formatDateOnly(today)}`
        : `VENCIMENTO:${installment.id}:${due}`,
    };
  }

  /** Hoje como dia civil — vencimento é `date`, não instante. */
  private today(): Date {
    return toDateOnly(formatDateOnly(new Date()));
  }
}
