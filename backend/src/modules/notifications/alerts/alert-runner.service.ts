import { Injectable, Logger } from '@nestjs/common';
import { JobStatus, NotificationChannel, Prisma } from '@prisma/client';
import { AutomationRulesService, CompiledRule } from '../automation-rules.service';
import { AutomationActionDto, AutomationConditionsDto } from '../dto/automation-rule.dto';
import { AutomationTrigger } from '../notifications.constants';
import {
  NotificationInput,
  NotificationRecipient,
  NotificationsService,
} from '../notifications.service';

/**
 * Aviso pronto, com a permissão que o recebe quando não há regra cadastrada.
 *
 * A permissão viaja com o fato — e não só com o alerta — porque um mesmo gatilho
 * cobre assuntos diferentes: `APROVACAO_PENDENTE` alcança título e pedido de
 * compra, e quem aprova um não é necessariamente quem aprova o outro.
 */
export interface AlertNotification extends NotificationInput {
  defaultPermission?: string;
}

/** O que o alerta precisa saber para rodar uma vez, sobre uma empresa. */
export interface AlertDefinition<T> {
  trigger: AutomationTrigger;
  /**
   * Permissão que recebe o aviso quando a empresa não cadastrou regra.
   *
   * O padrão é o RBAC: quem pode decidir sobre o assunto é quem precisa saber.
   */
  defaultPermission: string;
  /** Procura os fatos que casam com as condições da regra. */
  collect: (conditions: AutomationConditionsDto) => Promise<T[]>;
  /** Escreve o aviso a partir do fato encontrado. */
  build: (fact: T) => AlertNotification;
}

/**
 * Motor comum dos alertas (RF-121 a RF-125).
 *
 * Todo alerta desta sprint tem a mesma forma: procurar fatos, escrever um aviso
 * por fato e entregá-lo a quem a regra manda. O que muda entre RF-121 e RF-124
 * é a consulta e o texto — e é só isso que cada serviço de alerta implementa.
 *
 * Duas decisões que valem para os quatro:
 *
 *  1. **empresa sem regra continua sendo avisada**. A regra (RF-125) refina o
 *     alerta: muda horizonte, canal e destinatário. Sua ausência não desliga o
 *     aviso — desligar é a decisão explícita de desativar a regra. Um sistema
 *     que só alerta depois de configurado é um sistema que não alerta;
 *  2. **cada rodada de regra cadastrada fica registrada** (bd/16 §8). "Por que
 *     ninguém foi avisado?" só tem resposta se a execução que não gerou nada
 *     também estiver lá.
 */
@Injectable()
export class AlertRunnerService {
  private readonly logger = new Logger(AlertRunnerService.name);

  constructor(
    private readonly rules: AutomationRulesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Roda o alerta na empresa. Devolve quantas notificações foram criadas. */
  async run<T>(companyId: string, definition: AlertDefinition<T>): Promise<number> {
    const configured = await this.rules.compiledFor(companyId, definition.trigger);
    const rules: CompiledRule[] =
      configured.length > 0 ? configured : [this.fallbackRule(definition)];

    let created = 0;
    for (const rule of rules) {
      created += await this.runRule(companyId, definition, rule, configured.length > 0);
    }
    return created;
  }

  private async runRule<T>(
    companyId: string,
    definition: AlertDefinition<T>,
    rule: CompiledRule,
    persisted: boolean,
  ): Promise<number> {
    let created = 0;
    let failure: string | undefined;

    try {
      const facts = await definition.collect(rule.conditions);
      for (const fact of facts) {
        const notification = definition.build(fact);
        created += await this.notify(
          companyId,
          notification,
          rule.actions,
          // Só a regra implícita herda a permissão do assunto. Uma regra
          // cadastrada que endereça a três pessoas não pode ganhar de brinde
          // todo mundo que tem a permissão — seria alargar o que se configurou.
          persisted ? undefined : (notification.defaultPermission ?? definition.defaultPermission),
        );
      }
    } catch (error) {
      // A falha de um alerta não derruba os outros: cada um responde por si, e
      // o job da varredura relata no fim. Sem isto, uma consulta que falha em
      // RF-121 calaria RF-122 a RF-124 na mesma rodada.
      failure = error instanceof Error ? error.message : String(error);
      this.logger.error(`Alerta ${definition.trigger} falhou na empresa ${companyId}: ${failure}`);
    }

    if (persisted) {
      await this.rules.recordRun(
        companyId,
        rule.id,
        failure ? JobStatus.FALHA : JobStatus.CONCLUIDO,
        { notificacoes: created } as Prisma.InputJsonValue,
        failure,
      );
    }

    return created;
  }

  /** Entrega o aviso pelos canais e destinatários de cada ação da regra. */
  private async notify(
    companyId: string,
    input: AlertNotification,
    actions: AutomationActionDto[],
    fallbackPermission?: string,
  ): Promise<number> {
    let created = 0;

    for (const action of actions) {
      const recipients = await this.resolveRecipients(companyId, action, fallbackPermission);
      if (recipients.length === 0) continue;

      created += await this.notifications.emit(
        companyId,
        { ...input, priority: action.priority ?? input.priority },
        recipients,
        [action.channel ?? NotificationChannel.INTERNO],
      );
    }

    return created;
  }

  private async resolveRecipients(
    companyId: string,
    action: AutomationActionDto,
    fallbackPermission?: string,
  ): Promise<NotificationRecipient[]> {
    const permission = action.permission ?? fallbackPermission;
    const byPermission = permission
      ? await this.notifications.recipientsWithPermission(companyId, permission)
      : [];

    const named: NotificationRecipient[] = [];
    for (const userId of action.userIds ?? []) {
      // Um usuário desligado da empresa depois de a regra ser criada deixa de
      // ser destinatário aqui — e não na exceção do banco, no meio do lote.
      const recipient = await this.notifications.recipientById(companyId, userId);
      if (recipient) {
        named.push(recipient);
      }
    }

    const unique = new Map<string, NotificationRecipient>();
    for (const recipient of [...byPermission, ...named]) {
      unique.set(recipient.userId ?? 'EMPRESA', recipient);
    }
    return [...unique.values()];
  }

  /**
   * Regra implícita da empresa que não cadastrou nenhuma: avisa por dentro do
   * sistema quem tem a permissão do assunto. Não é gravada e não registra
   * execução — não existe regra para responder por ela.
   */
  private fallbackRule<T>(definition: AlertDefinition<T>): CompiledRule {
    return {
      id: `padrao:${definition.trigger}`,
      name: `Padrão — ${definition.trigger}`,
      conditions: {},
      actions: [{ type: 'NOTIFICAR', channel: NotificationChannel.INTERNO }],
    };
  }
}
