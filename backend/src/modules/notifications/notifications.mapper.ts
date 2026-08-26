import { NotificationChannel, NotificationStatus } from '@prisma/client';

/**
 * Forma da notificação na API (RF-119).
 *
 * `recipientEmail`, `dedupeKey`, `error` e `attempts` ficam de fora: são o
 * mecanismo de entrega, não o aviso. O endereço é dado pessoal do destinatário
 * e a chave de dedupe descreve o funcionamento interno da varredura — nenhum
 * dos dois muda a decisão de quem lê a caixa de entrada (RNF-005).
 */
export interface NotificationResponse {
  id: string;
  userId: string | null;
  channel: NotificationChannel;
  type: string;
  title: string;
  message: string;
  priority: number;
  entity: string | null;
  entityId: string | null;
  link: string | null;
  status: NotificationStatus;
  sentAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
}

/** Linha de `notificacao` na forma em que a API a devolve. */
export function toNotificationResponse(row: NotificationResponse): NotificationResponse {
  return {
    id: row.id,
    userId: row.userId,
    channel: row.channel,
    type: row.type,
    title: row.title,
    message: row.message,
    priority: row.priority,
    entity: row.entity,
    entityId: row.entityId,
    link: row.link,
    status: row.status,
    sentAt: row.sentAt,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}
