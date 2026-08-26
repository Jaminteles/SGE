import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JobStatus, Prisma } from '@prisma/client';
import { PERMISSION_BY_CODE } from '../../common/authorization/permission-catalog';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AutomationActionDto,
  AutomationConditionsDto,
  CreateAutomationRuleDto,
  QueryAutomationRuleDto,
  UpdateAutomationRuleDto,
} from './dto/automation-rule.dto';
import { AutomationTrigger } from './notifications.constants';

const ruleSelect = {
  id: true,
  name: true,
  description: true,
  triggerEvent: true,
  conditions: true,
  actions: true,
  isActive: true,
  lastRunAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AutomationRuleSelect;

/** Uma regra já validada, na forma em que o motor de varredura a consome. */
export interface CompiledRule {
  id: string;
  name: string;
  conditions: AutomationConditionsDto;
  actions: AutomationActionDto[];
}

/**
 * Regras de automação (RF-125).
 *
 * A regra diz **quando avisar e quem avisar**, nunca o que fazer com o dinheiro:
 * a única ação possível é `NOTIFICAR` (ver `AutomationActionDto`). O motor que
 * as consome é a varredura de alertas — as regras não têm agendamento próprio
 * nesta sprint, e é a varredura periódica que as aplica.
 *
 * Duas validações não são cosméticas:
 *
 *  - **a permissão precisa existir no catálogo** (RF-011). Um código digitado
 *    errado não resolve destinatário nenhum, e a regra passaria a vida
 *    aparecendo como ativa sem nunca avisar ninguém;
 *  - **o usuário nomeado precisa ser da empresa**. Sem isso, uma regra
 *    endereçaria avisos com valor, parceiro e número de título para o id de
 *    alguém de outra empresa — o banco recusaria na gravação (bd/16 §2), mas o
 *    erro apareceria só na varredura, longe de quem configurou.
 *
 * Cadastro, alteração e desativação vão para a trilha pelo trigger de DML
 * (bd/16 §7) — como `alcada` e `perfil_permissao`, e pelo mesmo motivo: quem
 * passa a ser avisado, e quem deixa de ser, é decisão de governança. Não há
 * chamada de auditoria aqui, para não gravar o mesmo evento duas vezes.
 */
@Injectable()
export class AutomationRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateAutomationRuleDto) {
    await this.assertActions(companyId, dto.actions);

    try {
      return await this.prisma.db.automationRule.create({
        data: {
          companyId,
          name: dto.name,
          description: dto.description,
          triggerEvent: dto.triggerEvent,
          conditions: (dto.conditions ?? {}) as unknown as Prisma.InputJsonValue,
          actions: dto.actions as unknown as Prisma.InputJsonValue,
          isActive: dto.isActive ?? true,
        },
        select: ruleSelect,
      });
    } catch (error) {
      throw this.translateUniqueness(error);
    }
  }

  async findAll(companyId: string, query: QueryAutomationRuleDto) {
    const where: Prisma.AutomationRuleWhereInput = {
      companyId,
      ...(query.triggerEvent ? { triggerEvent: query.triggerEvent } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.automationRule.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        skip: query.skip,
        take: query.take,
        select: ruleSelect,
      }),
      this.prisma.db.automationRule.count({ where }),
    ]);

    return new PaginatedResult(rows, total, query.page, query.pageSize);
  }

  /** Uma regra da empresa ativa. Id de outra empresa é 404, não 403. */
  async findOne(companyId: string, id: string) {
    const rule = await this.prisma.db.automationRule.findFirst({
      where: { id, companyId },
      select: ruleSelect,
    });
    if (!rule) {
      throw new NotFoundException('Regra de automação não encontrada.');
    }
    return rule;
  }

  async update(companyId: string, id: string, dto: UpdateAutomationRuleDto) {
    await this.findOne(companyId, id);
    if (dto.actions) {
      await this.assertActions(companyId, dto.actions);
    }

    try {
      return await this.prisma.db.automationRule.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.triggerEvent !== undefined ? { triggerEvent: dto.triggerEvent } : {}),
          ...(dto.conditions !== undefined
            ? { conditions: dto.conditions as unknown as Prisma.InputJsonValue }
            : {}),
          ...(dto.actions !== undefined
            ? { actions: dto.actions as unknown as Prisma.InputJsonValue }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: ruleSelect,
      });
    } catch (error) {
      throw this.translateUniqueness(error);
    }
  }

  /**
   * Desativa a regra. A configuração permanece: religar não é reconfigurar, e
   * apagar levaria junto a explicação de por que alguém deixou de ser avisado.
   */
  async deactivate(companyId: string, id: string): Promise<void> {
    await this.findOne(companyId, id);
    await this.prisma.db.automationRule.update({ where: { id }, data: { isActive: false } });
  }

  /** Histórico de execuções da regra — a resposta para "por que não avisou?". */
  async runs(companyId: string, id: string, take = 50) {
    await this.findOne(companyId, id);
    return this.prisma.db.automationRuleRun.findMany({
      where: { companyId, ruleId: id },
      orderBy: { executedAt: 'desc' },
      take: Math.min(take, 200),
      select: { id: true, status: true, result: true, error: true, executedAt: true },
    });
  }

  /** Regras ativas de um gatilho, já na forma que o motor consome. */
  async compiledFor(companyId: string, trigger: AutomationTrigger): Promise<CompiledRule[]> {
    const rules = await this.prisma.db.automationRule.findMany({
      where: { companyId, triggerEvent: trigger, isActive: true },
      select: { id: true, name: true, conditions: true, actions: true },
      orderBy: { createdAt: 'asc' },
    });

    return rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      conditions: (rule.conditions ?? {}) as AutomationConditionsDto,
      actions: Array.isArray(rule.actions)
        ? (rule.actions as unknown as AutomationActionDto[])
        : [],
    }));
  }

  /**
   * Registra o que a rodada produziu (append-only, bd/16 §8).
   *
   * `lastRunAt` na regra e a linha de execução são gravados juntos: uma regra
   * que diz ter rodado sem execução correspondente é a pior das duas versões
   * para quem investiga um aviso que não chegou.
   */
  async recordRun(
    companyId: string,
    ruleId: string,
    status: JobStatus,
    result: Prisma.InputJsonValue,
    error?: string,
  ): Promise<void> {
    await this.prisma.db.automationRuleRun.create({
      data: { companyId, ruleId, status, result, error: error?.slice(0, 2000) },
    });
    await this.prisma.db.automationRule.update({
      where: { id: ruleId },
      data: { lastRunAt: new Date() },
    });
  }

  /** Ações válidas: permissão conhecida e usuários da própria empresa. */
  private async assertActions(companyId: string, actions: AutomationActionDto[]): Promise<void> {
    const userIds = new Set<string>();

    for (const action of actions) {
      if (!action.permission && (!action.userIds || action.userIds.length === 0)) {
        throw new BadRequestException(
          'Cada ação precisa de `permission` ou de `userIds`: sem destinatário, a regra não avisa ninguém.',
        );
      }
      if (action.permission && !PERMISSION_BY_CODE.has(action.permission)) {
        throw new BadRequestException(
          `Permissão desconhecida: ${action.permission}. Use um código do catálogo (recurso:AÇÃO).`,
        );
      }
      for (const userId of action.userIds ?? []) {
        userIds.add(userId);
      }
    }

    if (userIds.size === 0) return;

    const found = await this.prisma.db.membership.findMany({
      where: { companyId, isActive: true, userId: { in: [...userIds] } },
      select: { userId: true },
      distinct: ['userId'],
    });
    if (found.length !== userIds.size) {
      // Não diz qual id falhou: a resposta confirmaria a existência de usuários
      // de outras empresas para quem testar ids na regra.
      throw new BadRequestException(
        'Há usuários que não estão associados a esta empresa entre os destinatários.',
      );
    }
  }

  /** A unique `uq_regra_automacao` vira uma mensagem, não um 500. */
  private translateUniqueness(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Já existe uma regra de automação com este nome.');
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
