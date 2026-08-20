import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import {
  CreateReconciliationRuleDto,
  QueryReconciliationRuleDto,
  ReconciliationRuleActionsDto,
  ReconciliationRuleConditionsDto,
  UpdateReconciliationRuleDto,
} from './dto/reconciliation-rule.dto';

const RULE_FIELDS = {
  id: true,
  name: true,
  priority: true,
  conditions: true,
  actions: true,
  valueTolerance: true,
  dayTolerance: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ReconciliationRuleSelect;

/**
 * Regras de conciliação automática (RF-075).
 *
 * Cadastro comum, com uma exceção que justifica o serviço próprio: a regra é a
 * peça que concilia sozinha, e uma regra vazia ou incoerente concilia **tudo**.
 * Por isso três validações que o CRUD genérico não teria:
 *
 *  1. condição vazia é recusada — o banco também recusa (`ck_regra_conciliacao_json`);
 *  2. `autoReconcile` sem `minScore` é recusado: conciliar sem revisão humana e
 *     sem piso de confiança é o modo de falha que a conciliação existe para
 *     evitar;
 *  3. faixa de valor invertida é recusada, porque ela não casaria com nada e
 *     ficaria no cadastro parecendo ativa.
 *
 * Regra não é removida: ela é referida por conciliações já feitas, e apagá-la
 * apagaria a explicação de por que aquele vínculo existe (RF-077). Desativar é
 * o que existe.
 */
@Injectable()
export class ReconciliationRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateReconciliationRuleDto) {
    this.assertCoherent(dto.conditions, dto.actions);

    await this.assertNameAvailable(companyId, dto.name);

    return this.prisma.db.reconciliationRule.create({
      data: {
        companyId,
        name: dto.name,
        priority: dto.priority ?? 100,
        conditions: this.clean(dto.conditions),
        actions: this.clean(dto.actions),
        valueTolerance: new Prisma.Decimal(dto.valueTolerance ?? '0'),
        dayTolerance: dto.dayTolerance ?? 3,
        isActive: dto.isActive ?? true,
      },
      select: RULE_FIELDS,
    });
  }

  async update(companyId: string, id: string, dto: UpdateReconciliationRuleDto) {
    const existing = await this.findOne(companyId, id);

    const conditions = (dto.conditions ??
      existing.conditions) as unknown as ReconciliationRuleConditionsDto;
    const actions = (dto.actions ?? existing.actions) as unknown as ReconciliationRuleActionsDto;
    this.assertCoherent(conditions, actions);

    if (dto.name && dto.name !== existing.name) {
      await this.assertNameAvailable(companyId, dto.name);
    }

    return this.prisma.db.reconciliationRule.update({
      where: { id: existing.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.conditions !== undefined ? { conditions: this.clean(dto.conditions) } : {}),
        ...(dto.actions !== undefined ? { actions: this.clean(dto.actions) } : {}),
        ...(dto.valueTolerance !== undefined
          ? { valueTolerance: new Prisma.Decimal(dto.valueTolerance) }
          : {}),
        ...(dto.dayTolerance !== undefined ? { dayTolerance: dto.dayTolerance } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: RULE_FIELDS,
    });
  }

  async deactivate(companyId: string, id: string) {
    const existing = await this.findOne(companyId, id);
    return this.prisma.db.reconciliationRule.update({
      where: { id: existing.id },
      data: { isActive: false },
      select: RULE_FIELDS,
    });
  }

  async findAll(companyId: string, query: QueryReconciliationRuleDto) {
    const where: Prisma.ReconciliationRuleWhereInput = {
      companyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.db.reconciliationRule.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { name: 'asc' }],
        skip: query.skip,
        take: query.take,
        select: RULE_FIELDS,
      }),
      this.prisma.db.reconciliationRule.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const rule = await this.prisma.db.reconciliationRule.findFirst({
      where: { id, companyId },
      select: RULE_FIELDS,
    });
    if (!rule) {
      throw new NotFoundException('Regra de conciliação não encontrada.');
    }
    return rule;
  }

  private assertCoherent(
    conditions: ReconciliationRuleConditionsDto,
    actions: ReconciliationRuleActionsDto,
  ): void {
    if (Object.values(this.clean(conditions)).length === 0) {
      throw new BadRequestException(
        'A regra precisa de ao menos uma condição: uma regra sem critério casa com todo movimento.',
      );
    }

    if (actions.autoReconcile && !actions.minScore) {
      throw new BadRequestException(
        'Conciliação automática exige `minScore`: sem piso de confiança a regra concilia ' +
          'correspondências fracas sem revisão.',
      );
    }

    if (actions.minScore) {
      const score = new Prisma.Decimal(actions.minScore);
      if (score.lessThan(0) || score.greaterThan(100)) {
        throw new BadRequestException('`minScore` é uma confiança de 0 a 100.');
      }
    }

    if (actions.autoReconcile && actions.markIgnored) {
      throw new BadRequestException(
        'Uma regra não pode, ao mesmo tempo, conciliar o movimento e marcá-lo como sem par.',
      );
    }

    if (conditions.minAmount && conditions.maxAmount) {
      const min = new Prisma.Decimal(conditions.minAmount);
      const max = new Prisma.Decimal(conditions.maxAmount);
      if (min.greaterThan(max)) {
        throw new BadRequestException('`minAmount` não pode ser maior que `maxAmount`.');
      }
    }
  }

  private async assertNameAvailable(companyId: string, name: string): Promise<void> {
    const duplicate = await this.prisma.db.reconciliationRule.findFirst({
      where: { companyId, name },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(`Já existe uma regra de conciliação chamada "${name}".`);
    }
  }

  /** Remove as chaves ausentes: `undefined` em `jsonb` viraria `null`. */
  private clean<T extends object>(value: T): Prisma.JsonObject {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
    ) as Prisma.JsonObject;
  }
}
