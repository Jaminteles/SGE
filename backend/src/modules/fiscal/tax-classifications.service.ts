import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { TaxClassificationType } from '../../common/enums';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTaxClassificationDto,
  QueryTaxClassificationDto,
  UpdateTaxClassificationDto,
} from './dto/tax-classification.dto';
import { CLASSIFICATION_CODE_PATTERN } from './fiscal.constants';

const classificationSelect = {
  id: true,
  type: true,
  code: true,
  description: true,
  icmsRate: true,
  ipiRate: true,
  pisRate: true,
  cofinsRate: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TaxClassificationSelect;

export type TaxClassificationRow = Prisma.TaxClassificationGetPayload<{
  select: typeof classificationSelect;
}>;

/**
 * Classificações fiscais da empresa (RF-089).
 *
 * NCM, CEST, CFOP, CST e LC 116 são o cadastro contra o qual a nota recebida é
 * comparada (RF-090) e de onde a regra fiscal tira a alíquota esperada (RF-091).
 *
 * Duas decisões:
 *
 *  1. **o código é conferido contra o tipo**. NCM tem oito dígitos, CEST sete,
 *     CFOP quatro. Um NCM com sete dígitos não gera erro nenhum — ele só nunca
 *     casa com item algum, e a regra fiscal presa a ele deixa de valer sem que
 *     ninguém perceba;
 *  2. **classificação não se apaga, se inativa**. Ela pode já estar apontada por
 *     itens de notas recebidas; removê-la reescreveria a leitura de documentos
 *     fechados.
 */
@Injectable()
export class TaxClassificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateTaxClassificationDto): Promise<TaxClassificationRow> {
    this.assertCode(dto.type, dto.code);

    try {
      return await this.prisma.db.taxClassification.create({
        data: {
          companyId,
          type: dto.type,
          code: dto.code,
          description: dto.description,
          icmsRate: dto.icmsRate,
          ipiRate: dto.ipiRate,
          pisRate: dto.pisRate,
          cofinsRate: dto.cofinsRate,
        },
        select: classificationSelect,
      });
    } catch (error) {
      throw this.translateUniqueness(error);
    }
  }

  async findAll(
    companyId: string,
    query: QueryTaxClassificationDto,
  ): Promise<PaginatedResult<TaxClassificationRow>> {
    const where: Prisma.TaxClassificationWhereInput = {
      companyId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { startsWith: query.q } },
              { description: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.taxClassification.findMany({
        where,
        orderBy: [{ type: 'asc' }, { code: 'asc' }],
        skip: query.skip,
        take: query.take,
        select: classificationSelect,
      }),
      this.prisma.db.taxClassification.count({ where }),
    ]);

    return new PaginatedResult(rows, total, query.page, query.pageSize);
  }

  /** Uma classificação da empresa ativa. Id de outra empresa é 404, não 403. */
  findOne(companyId: string, id: string): Promise<TaxClassificationRow> {
    return this.findEntity(companyId, id);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateTaxClassificationDto,
  ): Promise<TaxClassificationRow> {
    const classification = await this.findEntity(companyId, id);

    return this.prisma.db.taxClassification.update({
      where: { id: classification.id },
      data: {
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.icmsRate !== undefined ? { icmsRate: dto.icmsRate } : {}),
        ...(dto.ipiRate !== undefined ? { ipiRate: dto.ipiRate } : {}),
        ...(dto.pisRate !== undefined ? { pisRate: dto.pisRate } : {}),
        ...(dto.cofinsRate !== undefined ? { cofinsRate: dto.cofinsRate } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: classificationSelect,
    });
  }

  /**
   * Inativa a classificação. Nunca apaga.
   *
   * Regra fiscal ativa apontando para ela impede: a regra continuaria casando e
   * passaria a decidir com um cadastro que ninguém mais enxerga na listagem.
   */
  async deactivate(companyId: string, id: string): Promise<void> {
    const classification = await this.findEntity(companyId, id);

    const rules = await this.prisma.db.taxRule.count({
      where: { companyId, classificationId: id, isActive: true },
    });
    if (rules > 0) {
      throw new ConflictException(
        'Existem regras fiscais ativas usando esta classificação: inative as regras antes.',
      );
    }

    await this.prisma.db.taxClassification.update({
      where: { id: classification.id },
      data: { isActive: false },
    });
  }

  /**
   * Classificação ativa da empresa, para uso das regras e da classificação de
   * itens (RF-090/RF-091).
   *
   * Devolve `null` em vez de lançar: quem chama decide se a ausência é id
   * inválido ou cadastro pendente.
   */
  findUsable(
    companyId: string,
    id: string,
    type?: TaxClassificationType,
  ): Promise<TaxClassificationRow | null> {
    return this.prisma.db.taxClassification.findFirst({
      where: { id, companyId, isActive: true, ...(type ? { type } : {}) },
      select: classificationSelect,
    });
  }

  private async findEntity(companyId: string, id: string): Promise<TaxClassificationRow> {
    const classification = await this.prisma.db.taxClassification.findFirst({
      where: { id, companyId },
      select: classificationSelect,
    });
    if (!classification) {
      throw new NotFoundException('Classificação fiscal não encontrada.');
    }
    return classification;
  }

  /** O formato do código segue o tipo; o banco confere de novo (bd/18 §3). */
  private assertCode(type: TaxClassificationType, code: string): void {
    if (!CLASSIFICATION_CODE_PATTERN[type].test(code)) {
      throw new BadRequestException(
        `O código informado não tem o formato de ${type}: uma classificação malformada nunca casa com item nenhum.`,
      );
    }
  }

  /** A unique `uq_classificacao_fiscal` vira uma mensagem, não um 500. */
  private translateUniqueness(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Já existe uma classificação fiscal com este tipo e código.');
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
