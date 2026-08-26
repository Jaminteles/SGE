import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationChannel, NotificationStatus, Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { JobQueueService } from '../../common/queue/job-queue.service';
import { QUEUES } from '../../common/queue/job.types';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryNotificationDto } from './dto/notification.dto';
import { NotificationResponse, toNotificationResponse } from './notifications.mapper';
import { NOTIFICATION_JOBS } from './notifications.constants';

/** O aviso a emitir, antes de saber para quem. */
export interface NotificationInput {
  /** `NOTIFICATION_TYPES`. */
  type: string;
  title: string;
  message: string;
  /** 1 (mais urgente) a 5. Padrão 3. */
  priority?: number;
  /** Tabela de `gestao` a que o aviso se refere, e o id dentro dela. */
  entity?: string;
  entityId?: string;
  link?: string;
  /**
   * Identifica o **fato** avisado, não a rodada da varredura. O destinatário é
   * acrescentado aqui dentro: a mesma parcela vencendo avisa cada pessoa uma vez.
   */
  dedupeKey?: string;
}

/** Quem recebe. `userId` nulo é o aviso da empresa, sem dono. */
export interface NotificationRecipient {
  userId: string | null;
  email?: string | null;
}

/** Limite de `notificacao.chave_dedupe` (bd/16 §3). */
const DEDUPE_KEY_MAX = 200;

const notificationSelect = {
  id: true,
  userId: true,
  channel: true,
  type: true,
  title: true,
  message: true,
  priority: true,
  entity: true,
  entityId: true,
  link: true,
  status: true,
  sentAt: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

/**
 * Notificações internas (RF-119).
 *
 * Três propriedades sustentam este serviço, e cada uma resolve um modo de falha
 * concreto:
 *
 *  1. **idempotência do aviso** — `dedupeKey` descreve o fato (a parcela, o
 *     pagamento, a divergência) e não a varredura. Sem ela, o mesmo vencimento
 *     seria reavisado a cada cinco minutos, e um destinatário que aprende a
 *     ignorar avisos ignora também o único que importava;
 *  2. **destinatário dentro da empresa** — quem recebe é resolvido por
 *     permissão, sempre a partir de `usuario_empresa` da empresa ativa. O banco
 *     confere de novo por trigger (bd/16 §2), porque o corpo da mensagem carrega
 *     valor, parceiro e número do título: endereçar errado é vazar;
 *  3. **leitura é do dono** — um aviso pessoal só aparece para o próprio
 *     destinatário. A RLS garante o limite entre empresas; o limite entre
 *     pessoas da mesma empresa é aplicado aqui, porque depende do usuário
 *     autenticado e não do tenant.
 *
 * O canal INTERNO nasce `ENVIADA`: a entrega é a própria gravação. Só o que
 * precisa sair da aplicação (EMAIL) entra na fila de despacho (RF-120).
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
  ) {}

  /**
   * Emite um aviso para cada destinatário, nos canais pedidos.
   *
   * Devolve quantas notificações foram criadas — as que o dedupe descartou não
   * contam, e é esse número que a execução da regra registra (RF-125).
   *
   * `skipDuplicates` em vez de tratar P2002: um conflito dentro da transação da
   * varredura abortaria o lote inteiro no PostgreSQL, e o aviso seguinte —
   * legítimo — morreria junto com o repetido.
   */
  async emit(
    companyId: string,
    input: NotificationInput,
    recipients: NotificationRecipient[],
    channels: NotificationChannel[] = [NotificationChannel.INTERNO],
  ): Promise<number> {
    const rows: Prisma.NotificationCreateManyInput[] = [];

    for (const recipient of recipients) {
      for (const channel of channels) {
        const email = channel === NotificationChannel.EMAIL ? recipient.email : undefined;
        // Canal EMAIL sem endereço é recusado pelo banco (bd/16 §5); descartar
        // aqui evita perder o aviso interno do mesmo lote por causa dele.
        if (channel === NotificationChannel.EMAIL && !email) {
          continue;
        }

        rows.push({
          companyId,
          userId: recipient.userId,
          channel,
          type: input.type,
          title: input.title,
          message: input.message,
          priority: input.priority ?? 3,
          entity: input.entity,
          entityId: input.entityId,
          link: input.link,
          recipientEmail: email ?? undefined,
          dedupeKey: this.dedupeKeyFor(input.dedupeKey, recipient.userId, channel),
          // INTERNO é entregue no ato de gravar; EMAIL espera o despacho.
          status:
            channel === NotificationChannel.INTERNO
              ? NotificationStatus.ENVIADA
              : NotificationStatus.PENDENTE,
          sentAt: channel === NotificationChannel.INTERNO ? new Date() : undefined,
        });
      }
    }

    if (rows.length === 0) {
      return 0;
    }

    const { count } = await this.prisma.db.notification.createMany({
      data: rows,
      skipDuplicates: true,
    });

    if (count > 0) {
      await this.enqueuePending(companyId, input.entity, input.entityId);
    }

    return count;
  }

  /**
   * Usuários da empresa que têm a permissão informada (`recurso:AÇÃO`).
   *
   * É assim que os alertas escolhem destinatário: quem pode aprovar título é
   * quem precisa saber que há título parado esperando aprovação. Amarrar o
   * aviso a um perfil pelo nome quebraria em toda empresa que renomeia perfis;
   * amarrar à permissão acompanha o RBAC que já existe (RF-011).
   */
  async recipientsWithPermission(
    companyId: string,
    permissionCode: string,
  ): Promise<NotificationRecipient[]> {
    const [resource, action] = permissionCode.split(':');

    const memberships = await this.prisma.db.membership.findMany({
      where: {
        companyId,
        isActive: true,
        user: { isActive: true },
        role: { permissions: { some: { permission: { resource, action } } } },
      },
      select: { userId: true, user: { select: { email: true } } },
    });

    // Um usuário com dois perfis na mesma empresa aparece duas vezes.
    const unique = new Map<string, NotificationRecipient>();
    for (const membership of memberships) {
      unique.set(membership.userId, {
        userId: membership.userId,
        email: membership.user.email,
      });
    }
    return [...unique.values()];
  }

  /** Um destinatário específico, se ele ainda pertencer à empresa. */
  async recipientById(companyId: string, userId: string): Promise<NotificationRecipient | null> {
    const membership = await this.prisma.db.membership.findFirst({
      where: { companyId, userId, isActive: true, user: { isActive: true } },
      select: { userId: true, user: { select: { email: true } } },
    });
    return membership ? { userId: membership.userId, email: membership.user.email } : null;
  }

  /**
   * Caixa de entrada do usuário autenticado (RF-119).
   *
   * Traz o que é dele e o que é da empresa (`usuario_id` nulo). Nunca o aviso
   * pessoal de outra pessoa — mesmo com a permissão de leitura do módulo.
   */
  async findAll(
    companyId: string,
    userId: string,
    query: QueryNotificationDto,
  ): Promise<PaginatedResult<NotificationResponse>> {
    const where: Prisma.NotificationWhereInput = {
      companyId,
      OR: [{ userId }, { userId: null }],
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.unreadOnly ? { status: { not: NotificationStatus.LIDA } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.notification.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        skip: query.skip,
        take: query.take,
        select: notificationSelect,
      }),
      this.prisma.db.notification.count({ where }),
    ]);

    return new PaginatedResult(rows.map(toNotificationResponse), total, query.page, query.pageSize);
  }

  /** Quantos avisos ainda não foram lidos — o número do sininho. */
  unreadCount(companyId: string, userId: string): Promise<number> {
    return this.prisma.db.notification.count({
      where: {
        companyId,
        OR: [{ userId }, { userId: null }],
        status: { in: [NotificationStatus.PENDENTE, NotificationStatus.ENVIADA] },
      },
    });
  }

  /**
   * Marca como lido. Só o destinatário: ler é um ato dele, e um aviso lido por
   * outra pessoa desapareceria da caixa de quem precisava agir.
   *
   * O aviso da empresa (`usuario_id` nulo) não é marcável — não é de ninguém, e
   * o banco recusa `LIDA` sem destinatário (bd/16 §5).
   */
  async markRead(companyId: string, userId: string, id: string): Promise<NotificationResponse> {
    const notification = await this.prisma.db.notification.findFirst({
      where: { id, companyId },
      select: { id: true, userId: true, status: true },
    });
    if (!notification) {
      throw new NotFoundException('Notificação não encontrada.');
    }
    if (notification.userId !== userId) {
      throw new ForbiddenException('Esta notificação não é sua.');
    }
    if (notification.status === NotificationStatus.LIDA) {
      return toNotificationResponse(
        await this.prisma.db.notification.findFirstOrThrow({
          where: { id },
          select: notificationSelect,
        }),
      );
    }

    // `updateMany` com o estado esperado no `where`: duas abas marcando ao
    // mesmo tempo não tentam a transição ENVIADA -> LIDA duas vezes, que o
    // banco recusaria como transição inválida (bd/16 §4).
    await this.prisma.db.notification.updateMany({
      where: { id, companyId, userId, status: NotificationStatus.ENVIADA },
      data: { status: NotificationStatus.LIDA, readAt: new Date() },
    });

    return toNotificationResponse(
      await this.prisma.db.notification.findFirstOrThrow({
        where: { id },
        select: notificationSelect,
      }),
    );
  }

  /** Marca toda a caixa do usuário como lida. Devolve quantos mudaram. */
  async markAllRead(companyId: string, userId: string): Promise<{ updated: number }> {
    const { count } = await this.prisma.db.notification.updateMany({
      where: { companyId, userId, status: NotificationStatus.ENVIADA },
      data: { status: NotificationStatus.LIDA, readAt: new Date() },
    });
    return { updated: count };
  }

  /**
   * Enfileira o despacho das notificações de canal externo recém-criadas.
   *
   * Um job por notificação, e não um job por lote: uma falha de entrega para um
   * endereço não pode impedir a entrega para os outros, e o backoff da fila é
   * por job (RF-070).
   *
   * A consulta não se limita ao que acabou de ser criado, e isso é deliberado:
   * a chave de idempotência do job já impede o envio duplicado, e varrer o que
   * está `PENDENTE` faz esta chamada recuperar avisos cujo job se perdeu — um
   * deploy no meio da fila, um job cancelado a mão. Sem isso, um aviso ficaria
   * pendente para sempre sem ninguém perceber, que é a pior falha possível num
   * módulo cujo produto é avisar.
   */
  private async enqueuePending(
    companyId: string,
    entity?: string,
    entityId?: string,
  ): Promise<void> {
    const pending = await this.prisma.db.notification.findMany({
      where: {
        companyId,
        status: NotificationStatus.PENDENTE,
        channel: { not: NotificationChannel.INTERNO },
        ...(entity ? { entity } : {}),
        ...(entityId ? { entityId } : {}),
      },
      select: { id: true },
      take: 500,
    });

    for (const notification of pending) {
      await this.queue.enqueue({
        queue: QUEUES.NOTIFICATIONS,
        name: NOTIFICATION_JOBS.DISPATCH,
        companyId,
        payload: { notificationId: notification.id },
        // O mesmo aviso enfileirado duas vezes é um envio só.
        idempotencyKey: `${NOTIFICATION_JOBS.DISPATCH}:${notification.id}`,
      });
    }
  }

  /**
   * Chave de dedupe por destinatário e canal.
   *
   * O fato é o mesmo para todo mundo, mas o aviso é de cada um: sem o
   * destinatário na chave, a primeira pessoa notificada calaria as demais.
   */
  private dedupeKeyFor(
    base: string | undefined,
    userId: string | null,
    channel: NotificationChannel,
  ): string | undefined {
    if (!base) return undefined;
    return `${base}:${userId ?? 'EMPRESA'}:${channel}`.slice(0, DEDUPE_KEY_MAX);
  }
}
