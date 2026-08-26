import { Injectable } from '@nestjs/common';
import { ApprovalStatus, EntryStatus, Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PERMISSIONS } from '../../../common/authorization/permission-catalog';
import { formatDateOnly, toDateOnly } from '../../../common/utils/date-only';
import { PrismaService } from '../../../prisma/prisma.service';
import { AutomationConditionsDto } from '../dto/automation-rule.dto';
import { NOTIFICATION_TYPES, SCAN_BATCH_LIMIT } from '../notifications.constants';
import { AlertNotification, AlertRunnerService } from './alert-runner.service';

/**
 * Um item parado esperando decisão, seja qual for a tabela de origem.
 *
 * `permission` viaja com o fato porque quem aprova título não é necessariamente
 * quem aprova pedido de compra — e essa separação é intencional no RBAC (M06/M08).
 */
interface PendingApproval {
  entity: string;
  id: string;
  label: string;
  description: string;
  amount: Prisma.Decimal;
  waitingSince: Date;
  permission: string;
}

/**
 * Alerta de aprovação pendente (RF-123).
 *
 * O que este alerta combate não é o esquecimento de uma pessoa: é a aprovação
 * que ninguém sabe que existe. Título parado em `PENDENTE` bloqueia a baixa
 * (RN-003) e pedido parado em `AGUARDANDO_APROVACAO` bloqueia a compra — nos
 * dois casos o processo para em silêncio, e quem cobra é o fornecedor, dias
 * depois.
 *
 * O lembrete é diário, não por rodada: a chave de dedupe carrega a data da
 * varredura. Uma aprovação parada há uma semana produz sete avisos, um por dia
 * — que é o comportamento desejado de um lembrete — e não um a cada cinco
 * minutos, que é ruído.
 */
@Injectable()
export class ApprovalAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AlertRunnerService,
  ) {}

  run(companyId: string): Promise<number> {
    return this.runner.run<PendingApproval>(companyId, {
      trigger: 'APROVACAO_PENDENTE',
      defaultPermission: PERMISSIONS.FINANCIAL_ENTRIES_APPROVE,
      collect: (conditions) => this.collect(companyId, conditions),
      build: (pending) => this.build(pending),
    });
  }

  private async collect(
    companyId: string,
    conditions: AutomationConditionsDto,
  ): Promise<PendingApproval[]> {
    const minAmount = conditions.minAmount ? new Prisma.Decimal(conditions.minAmount) : undefined;

    const [entries, orders] = await Promise.all([
      this.prisma.db.financialEntry.findMany({
        where: {
          companyId,
          approvalStatus: ApprovalStatus.PENDENTE,
          status: { notIn: [EntryStatus.CANCELADO] },
          ...(conditions.entryType ? { type: conditions.entryType } : {}),
          ...(minAmount ? { netAmount: { gte: minAmount } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: SCAN_BATCH_LIMIT,
        select: {
          id: true,
          type: true,
          number: true,
          description: true,
          netAmount: true,
          createdAt: true,
        },
      }),
      // Pedido de compra não tem `entryType`: a condição de tipo de título não
      // se aplica a ele, e filtrá-lo por ela esconderia pedidos sem motivo.
      this.prisma.db.purchaseOrder.findMany({
        where: {
          companyId,
          status: PurchaseOrderStatus.AGUARDANDO_APROVACAO,
          ...(minAmount ? { totalAmount: { gte: minAmount } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: SCAN_BATCH_LIMIT,
        select: { id: true, number: true, totalAmount: true, createdAt: true },
      }),
    ]);

    return [
      ...entries.map((entry) => ({
        entity: 'titulo',
        id: entry.id,
        label: `Título ${entry.type} nº ${entry.number}`,
        description: entry.description,
        amount: entry.netAmount,
        waitingSince: entry.createdAt,
        permission: PERMISSIONS.FINANCIAL_ENTRIES_APPROVE,
      })),
      ...orders.map((order) => ({
        entity: 'pedido_compra',
        id: order.id,
        label: `Pedido de compra nº ${order.number}`,
        description: 'aguardando aprovação',
        amount: order.totalAmount,
        waitingSince: order.createdAt,
        permission: PERMISSIONS.PURCHASE_ORDERS_APPROVE,
      })),
    ];
  }

  private build(pending: PendingApproval): AlertNotification {
    const since = formatDateOnly(pending.waitingSince);
    const days = this.daysWaiting(pending.waitingSince);

    return {
      type: NOTIFICATION_TYPES.APPROVAL_PENDING,
      title: `Aprovação pendente: ${pending.label}`,
      message:
        `${pending.label}, R$ ${pending.amount.toFixed(2)}, aguarda aprovação desde ${since} ` +
        `(${days} ${days === 1 ? 'dia' : 'dias'}): ${pending.description}.`,
      // O que espera há mais de três dias já é gargalo, não fila.
      priority: days >= 3 ? 2 : 3,
      entity: pending.entity,
      entityId: pending.id,
      // Lembrete diário: a data da varredura entra na chave, o horário não.
      dedupeKey: `APROVACAO:${pending.entity}:${pending.id}:${formatDateOnly(new Date())}`,
      defaultPermission: pending.permission,
    };
  }

  private daysWaiting(since: Date): number {
    const start = toDateOnly(formatDateOnly(since)).getTime();
    const today = toDateOnly(formatDateOnly(new Date())).getTime();
    return Math.max(0, Math.round((today - start) / 86_400_000));
  }
}
