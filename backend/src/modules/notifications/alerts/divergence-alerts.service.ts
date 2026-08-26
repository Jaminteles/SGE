import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '../../../common/authorization/permission-catalog';
import { PrismaService } from '../../../prisma/prisma.service';
import { AutomationConditionsDto } from '../dto/automation-rule.dto';
import { LOOKBACK_DAYS, NOTIFICATION_TYPES, SCAN_BATCH_LIMIT } from '../notifications.constants';
import { AlertNotification, AlertRunnerService } from './alert-runner.service';

const DAY_MS = 86_400_000;

/** A conciliação divergente como o alerta precisa dela. */
interface DivergenceFact {
  id: string;
  difference: Prisma.Decimal;
  reconciledAmount: Prisma.Decimal;
  justification: string | null;
  createdAt: Date;
}

/**
 * Alerta de divergência na conciliação (RF-124).
 *
 * O fato observado é o vínculo confirmado **com diferença** (RF-076): alguém
 * conciliou aceitando que o valor do extrato não bate com o do lançamento, e
 * justificou. Cada uma dessas linhas é uma diferença que a contabilidade vai
 * precisar explicar no fechamento — e descobrir isso no fechamento é descobrir
 * tarde demais, quando o extrato do mês já foi arquivado.
 *
 * Só o vínculo **vivo** entra: uma conciliação desfeita (`undoneAt`) deixou de
 * afirmar qualquer coisa sobre o dinheiro, e reavisar sobre ela mandaria alguém
 * investigar um fato que não existe mais.
 *
 * O sinal da diferença é preservado no texto porque sobra e falta são problemas
 * diferentes para quem investiga: a primeira costuma ser recebimento a mais, a
 * segunda, tarifa não lançada.
 */
@Injectable()
export class DivergenceAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: AlertRunnerService,
  ) {}

  run(companyId: string): Promise<number> {
    return this.runner.run<DivergenceFact>(companyId, {
      trigger: 'DIVERGENCIA_CONCILIACAO',
      defaultPermission: PERMISSIONS.RECONCILIATION_READ,
      collect: (conditions) => this.collect(companyId, conditions),
      build: (divergence) => this.build(divergence),
    });
  }

  private collect(
    companyId: string,
    conditions: AutomationConditionsDto,
  ): Promise<DivergenceFact[]> {
    return this.prisma.db.reconciliation
      .findMany({
        where: {
          companyId,
          hasDivergence: true,
          confirmed: true,
          undoneAt: null,
          createdAt: { gte: new Date(Date.now() - LOOKBACK_DAYS * DAY_MS) },
        },
        orderBy: { createdAt: 'desc' },
        take: SCAN_BATCH_LIMIT,
        select: {
          id: true,
          difference: true,
          reconciledAmount: true,
          justification: true,
          createdAt: true,
        },
      })
      .then((rows) =>
        // `minAmount` compara o **tamanho** da diferença, não o valor conciliado:
        // uma diferença de R$ 500 num vínculo de R$ 20 é o caso grave, e filtrar
        // pelo valor conciliado o deixaria passar.
        conditions.minAmount
          ? rows.filter((row) =>
              row.difference.abs().gte(new Prisma.Decimal(conditions.minAmount!)),
            )
          : rows,
      );
  }

  private build(divergence: DivergenceFact): AlertNotification {
    const difference = divergence.difference;
    const direction = difference.isNegative() ? 'a menos' : 'a mais';

    return {
      type: NOTIFICATION_TYPES.DIVERGENCE,
      title: 'Conciliação com divergência de valor',
      message:
        `Movimento conciliado por R$ ${divergence.reconciledAmount.toFixed(2)} com ` +
        `R$ ${difference.abs().toFixed(2)} ${direction} em relação ao lançamento` +
        `${divergence.justification ? `: ${divergence.justification}` : '.'}`,
      priority: 2,
      entity: 'conciliacao',
      entityId: divergence.id,
      dedupeKey: `DIVERGENCIA:${divergence.id}`,
    };
  }
}
