import { NotificationChannel } from '@prisma/client';

/**
 * Vocabulário do M17 (RF-119 a RF-125).
 *
 * Tipo de notificação e gatilho de automação são coisas diferentes de propósito:
 * o gatilho descreve **o fato observado** pela varredura, e o tipo descreve **o
 * aviso** que sai dela. Hoje há uma correspondência quase um-para-um, mas
 * amarrar os dois faria de qualquer novo canal de aviso um novo gatilho — e o
 * CHECK de `regra_automacao.evento_gatilho` (bd/16 §7) é fechado.
 */

/** `notificacao.tipo` — o que aconteceu, do ponto de vista de quem lê. */
export const NOTIFICATION_TYPES = {
  DUE_DATE: 'VENCIMENTO',
  PAYMENT_SETTLED: 'PAGAMENTO_PROCESSADO',
  PAYMENT_FAILED: 'PAGAMENTO_FALHOU',
  APPROVAL_PENDING: 'APROVACAO_PENDENTE',
  DIVERGENCE: 'DIVERGENCIA',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/** `regra_automacao.evento_gatilho` — o fato que a varredura procura (bd/16 §7). */
export const AUTOMATION_TRIGGERS = [
  'TITULO_VENCENDO',
  'PAGAMENTO_PROCESSADO',
  'PAGAMENTO_FALHOU',
  'APROVACAO_PENDENTE',
  'DIVERGENCIA_CONCILIACAO',
] as const;

export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

/**
 * Canais com adaptador nesta sprint.
 *
 * SMS, PUSH e WEBHOOK existem no tipo do banco (bd/01) e são recusados pela
 * API: aceitar um canal sem entregador gravaria avisos que nunca saem e que
 * ninguém procura, porque a tela os mostraria como enfileirados.
 */
export const SUPPORTED_CHANNELS: NotificationChannel[] = [
  NotificationChannel.INTERNO,
  NotificationChannel.EMAIL,
];

/** Nomes dos jobs do módulo na fila (RF-069/RF-070). */
export const NOTIFICATION_JOBS = {
  /** Enfileira uma varredura por empresa e se reagenda. Roda sem empresa. */
  SCHEDULE: 'notificacoes.agenda',
  /** Procura os fatos que merecem aviso na empresa (RF-121 a RF-124). */
  SCAN: 'notificacoes.varredura',
  /** Entrega uma notificação pelo canal dela (RF-120). */
  DISPATCH: 'notificacoes.enviar',
} as const;

/**
 * Intervalo entre varreduras.
 *
 * Cinco minutos porque é o que separa "avisei a tempo" de "avisei depois" nos
 * fatos que este módulo observa — nenhum deles muda em segundos. Menos do que
 * isso multiplica a leitura das mesmas tabelas sem antecipar decisão nenhuma.
 */
export const SCAN_INTERVAL_MS = 5 * 60_000;

/** Teto de avisos gerados por varredura, por tipo. */
export const SCAN_BATCH_LIMIT = 200;

/**
 * Horizonte padrão do alerta de vencimento (RF-121), em dias.
 *
 * É o padrão de quem não cadastrou regra: avisar do que vence nos próximos três
 * dias. Uma regra `TITULO_VENCENDO` com `daysAhead` substitui este número.
 */
export const DEFAULT_DUE_DAYS_AHEAD = 3;

/** Quanto tempo para trás a varredura olha fatos já ocorridos, em dias. */
export const LOOKBACK_DAYS = 7;

/** Teto de tentativas de entrega de uma notificação (RF-120). */
export const MAX_DELIVERY_ATTEMPTS = 5;
