import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { ReferencesService } from '../../common/references/references.service';
import { toDateOnly } from '../../common/utils/date-only';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTaxRuleDto,
  QueryTaxRuleDto,
  ResolveTaxRuleDto,
  UpdateTaxRuleDto,
} from './dto/tax-rule.dto';
import { TaxClassificationsService } from './tax-classifications.service';

const ruleSelect = {
  id: true,
  name: true,
  priority: true,
  originState: true,
  destinationState: true,
  operationType: true,
  classificationId: true,
  productId: true,
  productCategoryId: true,
  cfop: true,
  icmsCst: true,
  icmsRate: true,
  icmsBaseReduction: true,
  conditions: true,
  effectiveFrom: true,
  effectiveTo: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TaxRuleSelect;

export type TaxRuleRow = Prisma.TaxRuleGetPayload<{ select: typeof ruleSelect }>;

/** Resultado da simulação: a regra vencedora e as que também casaram. */
export interface TaxRuleResolution {
  matched: TaxRuleRow | null;
  /** Demais regras que casaram, na mesma ordem de desempate. */
  alternatives: TaxRuleRow[];
}

/**
 * Peso de cada critério no desempate.
 *
 * Produto identifica um item; categoria, um grupo; NCM, uma mercadoria em geral;
 * UF e tipo de operação, o contexto. Sem esta ordem, duas regras de mesma
 * prioridade seriam decididas por ordem de leitura do banco — e a tributação de
 * uma nota passaria a depender do plano de execução da consulta.
 */
const SPECIFICITY = {
  productId: 16,
  productCategoryId: 8,
  classificationId: 4,
  operationType: 2,
  originState: 1,
  destinationState: 1,
} as const;

/**
 * Regras fiscais por operação e produto (RF-091).
 *
 * A regra **resolve**, e só: devolve o CFOP, o CST e a alíquota que deveriam
 * valer para uma operação. Ela não escreve tributo em documento nenhum — a nota
 * recebida é declaração de terceiro e não se reescreve (bd/18). Onde o esperado
 * difere do declarado, quem aponta a divergência é o RF-090.
 *
 * A escolha é determinística: menor prioridade primeiro; empatou, a regra com os
 * critérios mais específicos; empatou de novo, a mais recente. Regra sem
 * critério nenhum é recusada aqui e no banco (bd/18 §5) — ela casaria com toda
 * operação da empresa.
 */
@Injectable()
export class TaxRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
    private readonly classifications: TaxClassificationsService,
  ) {}

  async create(companyId: string, dto: CreateTaxRuleDto): Promise<TaxRuleRow> {
    // Só os critérios: `name`, `cfop` e `priority` descrevem a regra, não a
    // condição em que ela se aplica — contá-los como critério deixaria passar a
    // regra que casa com toda operação da empresa.
    await this.assertCriteria(companyId, {
      productId: dto.productId,
      productCategoryId: dto.productCategoryId,
      classificationId: dto.classificationId,
      operationType: dto.operationType,
      originState: dto.originState,
      destinationState: dto.destinationState,
    });

    const effectiveFrom = dto.effectiveFrom ? toDateOnly(dto.effectiveFrom) : new Date();
    const effectiveTo = dto.effectiveTo ? toDateOnly(dto.effectiveTo) : null;
    this.assertPeriod(effectiveFrom, effectiveTo);

    try {
      return await this.prisma.db.taxRule.create({
        data: {
          companyId,
          name: dto.name,
          priority: dto.priority ?? 100,
          originState: dto.originState,
          destinationState: dto.destinationState,
          operationType: dto.operationType,
          classificationId: dto.classificationId,
          productId: dto.productId,
          productCategoryId: dto.productCategoryId,
          cfop: dto.cfop,
          icmsCst: dto.icmsCst,
          icmsRate: dto.icmsRate,
          icmsBaseReduction: dto.icmsBaseReduction,
          ...(dto.conditions ? { conditions: dto.conditions as Prisma.InputJsonValue } : {}),
          effectiveFrom,
          effectiveTo,
        },
        select: ruleSelect,
      });
    } catch (error) {
      throw this.translateUniqueness(error);
    }
  }

  async findAll(companyId: string, query: QueryTaxRuleDto): Promise<PaginatedResult<TaxRuleRow>> {
    const where: Prisma.TaxRuleWhereInput = {
      companyId,
      ...(query.operationType ? { operationType: query.operationType } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.classificationId ? { classificationId: query.classificationId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.taxRule.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { name: 'asc' }],
        skip: query.skip,
        take: query.take,
        select: ruleSelect,
      }),
      this.prisma.db.taxRule.count({ where }),
    ]);

    return new PaginatedResult(rows, total, query.page, query.pageSize);
  }

  /** Uma regra da empresa ativa. Id de outra empresa é 404, não 403. */
  findOne(companyId: string, id: string): Promise<TaxRuleRow> {
    return this.findEntity(companyId, id);
  }

  async update(companyId: string, id: string, dto: UpdateTaxRuleDto): Promise<TaxRuleRow> {
    const rule = await this.findEntity(companyId, id);

    const merged = {
      productId: dto.productId === undefined ? rule.productId : dto.productId,
      productCategoryId:
        dto.productCategoryId === undefined ? rule.productCategoryId : dto.productCategoryId,
      classificationId:
        dto.classificationId === undefined ? rule.classificationId : dto.classificationId,
      operationType: dto.operationType === undefined ? rule.operationType : dto.operationType,
      originState: dto.originState === undefined ? rule.originState : dto.originState,
      destinationState:
        dto.destinationState === undefined ? rule.destinationState : dto.destinationState,
    };
    await this.assertCriteria(companyId, merged);

    const effectiveFrom = dto.effectiveFrom ? toDateOnly(dto.effectiveFrom) : rule.effectiveFrom;
    const effectiveTo =
      dto.effectiveTo === undefined
        ? rule.effectiveTo
        : dto.effectiveTo === null
          ? null
          : toDateOnly(dto.effectiveTo);
    this.assertPeriod(effectiveFrom, effectiveTo);

    try {
      return await this.prisma.db.taxRule.update({
        where: { id: rule.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
          ...(dto.originState !== undefined ? { originState: dto.originState } : {}),
          ...(dto.destinationState !== undefined ? { destinationState: dto.destinationState } : {}),
          ...(dto.operationType !== undefined ? { operationType: dto.operationType } : {}),
          ...(dto.classificationId !== undefined ? { classificationId: dto.classificationId } : {}),
          ...(dto.productId !== undefined ? { productId: dto.productId } : {}),
          ...(dto.productCategoryId !== undefined
            ? { productCategoryId: dto.productCategoryId }
            : {}),
          ...(dto.cfop !== undefined ? { cfop: dto.cfop } : {}),
          ...(dto.icmsCst !== undefined ? { icmsCst: dto.icmsCst } : {}),
          ...(dto.icmsRate !== undefined ? { icmsRate: dto.icmsRate } : {}),
          ...(dto.icmsBaseReduction !== undefined
            ? { icmsBaseReduction: dto.icmsBaseReduction }
            : {}),
          ...(dto.conditions !== undefined
            ? { conditions: dto.conditions as Prisma.InputJsonValue }
            : {}),
          ...(dto.effectiveFrom !== undefined ? { effectiveFrom } : {}),
          ...(dto.effectiveTo !== undefined ? { effectiveTo } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: ruleSelect,
      });
    } catch (error) {
      throw this.translateUniqueness(error);
    }
  }

  /** Inativa a regra. Nunca apaga: o histórico de decisão continua explicável. */
  async deactivate(companyId: string, id: string): Promise<void> {
    const rule = await this.findEntity(companyId, id);
    await this.prisma.db.taxRule.update({
      where: { id: rule.id },
      data: { isActive: false },
    });
  }

  /**
   * Que regra decide esta operação (RF-091).
   *
   * Um critério preenchido na regra precisa bater com o informado; critério nulo
   * na regra é curinga. O contrário não vale: informar menos do que a regra
   * exige não a torna aplicável — uma regra de um produto específico não decide
   * uma operação em que o produto sequer foi informado.
   */
  async resolve(companyId: string, query: ResolveTaxRuleDto): Promise<TaxRuleResolution> {
    const onDate = query.onDate ? toDateOnly(query.onDate) : new Date();

    const candidates = await this.prisma.db.taxRule.findMany({
      where: {
        companyId,
        isActive: true,
        effectiveFrom: { lte: onDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
        AND: [
          this.criterion('operationType', query.operationType),
          this.criterion('originState', query.originState),
          this.criterion('destinationState', query.destinationState),
          this.criterion('productId', query.productId),
          this.criterion('productCategoryId', query.productCategoryId),
          this.criterion('classificationId', query.classificationId),
        ],
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      select: ruleSelect,
    });

    const ordered = [...candidates].sort(
      (a, b) =>
        a.priority - b.priority ||
        this.specificity(b) - this.specificity(a) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );

    return { matched: ordered[0] ?? null, alternatives: ordered.slice(1) };
  }

  /** Critério nulo na regra é curinga; preenchido, tem de bater. */
  private criterion(field: keyof typeof SPECIFICITY, value?: string): Prisma.TaxRuleWhereInput {
    return value ? { OR: [{ [field]: value }, { [field]: null }] } : { [field]: null };
  }

  private specificity(rule: TaxRuleRow): number {
    return (Object.keys(SPECIFICITY) as (keyof typeof SPECIFICITY)[]).reduce(
      (total, field) => total + (rule[field] ? SPECIFICITY[field] : 0),
      0,
    );
  }

  private async findEntity(companyId: string, id: string): Promise<TaxRuleRow> {
    const rule = await this.prisma.db.taxRule.findFirst({
      where: { id, companyId },
      select: ruleSelect,
    });
    if (!rule) {
      throw new NotFoundException('Regra fiscal não encontrada.');
    }
    return rule;
  }

  private assertPeriod(from: Date, to: Date | null): void {
    if (to && to < from) {
      throw new BadRequestException('`effectiveTo` não pode ser anterior a `effectiveFrom`.');
    }
  }

  /**
   * A regra precisa de pelo menos um critério, e todo critério informado precisa
   * existir dentro da empresa (RN-001).
   */
  private async assertCriteria(
    companyId: string,
    criteria: {
      productId?: string | null;
      productCategoryId?: string | null;
      classificationId?: string | null;
      operationType?: string | null;
      originState?: string | null;
      destinationState?: string | null;
    },
  ): Promise<void> {
    const hasCriterion = Object.values(criteria).some((value) => Boolean(value));
    if (!hasCriterion) {
      throw new BadRequestException(
        'Informe ao menos um critério: uma regra sem critério casa com toda operação da empresa.',
      );
    }

    await this.references.assert(companyId, {
      productId: criteria.productId,
      productCategoryId: criteria.productCategoryId,
    });

    if (criteria.classificationId) {
      const classification = await this.classifications.findUsable(
        companyId,
        criteria.classificationId,
      );
      if (!classification) {
        throw new BadRequestException(
          'Classificação fiscal inválida ou inativa para esta empresa.',
        );
      }
    }
  }

  /** A unique `uq_regra_fiscal_nome` vira uma mensagem, não um 500. */
  private translateUniqueness(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Já existe uma regra fiscal com este nome.');
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
