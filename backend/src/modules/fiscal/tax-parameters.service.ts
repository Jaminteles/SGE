import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TaxRegime } from '@prisma/client';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { ReferencesService } from '../../common/references/references.service';
import { toDateOnly } from '../../common/utils/date-only';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTaxParameterDto,
  QueryTaxParameterDto,
  UpdateTaxParameterDto,
} from './dto/tax-parameter.dto';

const parameterSelect = {
  id: true,
  branchId: true,
  taxRegime: true,
  effectiveFrom: true,
  effectiveTo: true,
  simplesRate: true,
  issRate: true,
  ipiTaxpayer: true,
  taxSubstitute: true,
  additionalParameters: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TaxParameterSelect;

export type TaxParameterRow = Prisma.TaxParameterGetPayload<{ select: typeof parameterSelect }>;

/**
 * Parâmetros fiscais da empresa (RF-088).
 *
 * O parâmetro responde uma pergunta só: **qual era o regime tributário desta
 * empresa naquela data**. Daí as duas regras que este serviço aplica:
 *
 *  1. **vigências não se sobrepõem** por empresa/filial. Duas linhas cobrindo a
 *     mesma data dariam duas respostas à mesma pergunta, e quem apura escolheria
 *     uma delas por ordem de leitura — que muda com o plano de execução. O banco
 *     garante por EXCLUDE (bd/18 §2); aqui a checagem existe para produzir
 *     mensagem legível em vez de erro de restrição;
 *  2. **a alíquota precisa caber no regime**. Alíquota do Simples numa empresa
 *     de Lucro Real não é um campo a mais: é um número que entra na apuração de
 *     quem não está no Simples.
 *
 * O parâmetro da filial é exceção ao da empresa: os dois convivem porque só um
 * deles é da filial. A resolução (`resolve`) prefere o mais específico.
 */
@Injectable()
export class TaxParametersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
  ) {}

  async create(companyId: string, dto: CreateTaxParameterDto): Promise<TaxParameterRow> {
    await this.references.assert(companyId, { branchId: dto.branchId });

    const effectiveFrom = toDateOnly(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? toDateOnly(dto.effectiveTo) : null;

    this.assertPeriod(effectiveFrom, effectiveTo);
    this.assertRegime(dto.taxRegime, dto.simplesRate, dto.ipiTaxpayer ?? false);
    await this.assertNoOverlap(companyId, dto.branchId ?? null, effectiveFrom, effectiveTo);

    return this.prisma.db.taxParameter.create({
      data: {
        companyId,
        branchId: dto.branchId,
        taxRegime: dto.taxRegime,
        effectiveFrom,
        effectiveTo,
        simplesRate: dto.simplesRate,
        issRate: dto.issRate,
        ipiTaxpayer: dto.ipiTaxpayer ?? false,
        taxSubstitute: dto.taxSubstitute ?? false,
        ...(dto.additionalParameters
          ? { additionalParameters: dto.additionalParameters as Prisma.InputJsonValue }
          : {}),
      },
      select: parameterSelect,
    });
  }

  async findAll(
    companyId: string,
    query: QueryTaxParameterDto,
  ): Promise<PaginatedResult<TaxParameterRow>> {
    const onDate = query.onDate ? toDateOnly(query.onDate) : undefined;

    const where: Prisma.TaxParameterWhereInput = {
      companyId,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.taxRegime ? { taxRegime: query.taxRegime } : {}),
      ...(onDate
        ? {
            effectiveFrom: { lte: onDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.db.taxParameter.findMany({
        where,
        orderBy: [{ effectiveFrom: 'desc' }],
        skip: query.skip,
        take: query.take,
        select: parameterSelect,
      }),
      this.prisma.db.taxParameter.count({ where }),
    ]);

    return new PaginatedResult(rows, total, query.page, query.pageSize);
  }

  /** Um parâmetro da empresa ativa. Id de outra empresa é 404, não 403. */
  findOne(companyId: string, id: string): Promise<TaxParameterRow> {
    return this.findEntity(companyId, id);
  }

  /**
   * O parâmetro que vale para uma data, preferindo o da filial (RF-088).
   *
   * A filial é a exceção; a empresa é a regra. Sem parâmetro nenhum a resposta é
   * `null` — quem chama decide se isso é erro de requisição ou cadastro pendente.
   */
  async resolve(
    companyId: string,
    onDate: Date,
    branchId?: string | null,
  ): Promise<TaxParameterRow | null> {
    const specific = await this.prisma.db.taxParameter.findFirst({
      where: {
        companyId,
        branchId: branchId ?? null,
        effectiveFrom: { lte: onDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }],
      select: parameterSelect,
    });

    if (specific) {
      return specific;
    }

    // Filial sem parâmetro próprio cai no da empresa.
    if (!branchId) {
      return null;
    }

    return this.prisma.db.taxParameter.findFirst({
      where: {
        companyId,
        branchId: null,
        effectiveFrom: { lte: onDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }],
      select: parameterSelect,
    });
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateTaxParameterDto,
  ): Promise<TaxParameterRow> {
    const current = await this.findEntity(companyId, id);

    const effectiveFrom = dto.effectiveFrom ? toDateOnly(dto.effectiveFrom) : current.effectiveFrom;
    const effectiveTo =
      dto.effectiveTo === undefined
        ? current.effectiveTo
        : dto.effectiveTo === null
          ? null
          : toDateOnly(dto.effectiveTo);

    const taxRegime = dto.taxRegime ?? current.taxRegime;
    const simplesRate =
      dto.simplesRate === undefined ? current.simplesRate?.toString() : dto.simplesRate;
    const ipiTaxpayer = dto.ipiTaxpayer ?? current.ipiTaxpayer;

    this.assertPeriod(effectiveFrom, effectiveTo);
    this.assertRegime(taxRegime, simplesRate, ipiTaxpayer);
    await this.assertNoOverlap(companyId, current.branchId, effectiveFrom, effectiveTo, id);

    return this.prisma.db.taxParameter.update({
      where: { id: current.id },
      data: {
        ...(dto.taxRegime !== undefined ? { taxRegime: dto.taxRegime } : {}),
        ...(dto.effectiveFrom !== undefined ? { effectiveFrom } : {}),
        ...(dto.effectiveTo !== undefined ? { effectiveTo } : {}),
        ...(dto.simplesRate !== undefined ? { simplesRate: dto.simplesRate } : {}),
        ...(dto.issRate !== undefined ? { issRate: dto.issRate } : {}),
        ...(dto.ipiTaxpayer !== undefined ? { ipiTaxpayer: dto.ipiTaxpayer } : {}),
        ...(dto.taxSubstitute !== undefined ? { taxSubstitute: dto.taxSubstitute } : {}),
        ...(dto.additionalParameters !== undefined
          ? { additionalParameters: dto.additionalParameters as Prisma.InputJsonValue }
          : {}),
      },
      select: parameterSelect,
    });
  }

  /**
   * Encerra a vigência do parâmetro na data informada — nunca apaga.
   *
   * Apagar um parâmetro reescreveria o passado: a apuração de um mês já entregue
   * passaria a ser lida com o regime de outro período.
   */
  async close(companyId: string, id: string, on?: string): Promise<TaxParameterRow> {
    const current = await this.findEntity(companyId, id);
    const effectiveTo = on ? toDateOnly(on) : new Date(new Date().toISOString().slice(0, 10));

    if (effectiveTo < current.effectiveFrom) {
      throw new BadRequestException(
        'A data de encerramento é anterior ao início da vigência do parâmetro.',
      );
    }

    return this.prisma.db.taxParameter.update({
      where: { id: current.id },
      data: { effectiveTo },
      select: parameterSelect,
    });
  }

  private async findEntity(companyId: string, id: string): Promise<TaxParameterRow> {
    const parameter = await this.prisma.db.taxParameter.findFirst({
      where: { id, companyId },
      select: parameterSelect,
    });
    if (!parameter) {
      throw new NotFoundException('Parâmetro fiscal não encontrado.');
    }
    return parameter;
  }

  private assertPeriod(from: Date, to: Date | null): void {
    if (to && to < from) {
      throw new BadRequestException('`effectiveTo` não pode ser anterior a `effectiveFrom`.');
    }
  }

  /** As alíquotas precisam fazer sentido no regime; o banco confere de novo. */
  private assertRegime(
    regime: TaxRegime,
    simplesRate: string | null | undefined,
    ipiTaxpayer: boolean,
  ): void {
    if (regime !== TaxRegime.SIMPLES_NACIONAL && simplesRate) {
      throw new BadRequestException(
        'Alíquota do Simples só se aplica ao regime SIMPLES_NACIONAL: no restante ela entraria na apuração de quem não está no Simples.',
      );
    }
    if (regime === TaxRegime.MEI && ipiTaxpayer) {
      throw new BadRequestException('MEI não é contribuinte de IPI.');
    }
  }

  /**
   * Duas vigências não cobrem a mesma data para a mesma empresa/filial.
   *
   * A conferência aqui é de mensagem: a garantia é o EXCLUDE de bd/18 §2, que é
   * também o único ponto onde duas requisições simultâneas se encontram.
   */
  private async assertNoOverlap(
    companyId: string,
    branchId: string | null,
    from: Date,
    to: Date | null,
    ignoreId?: string,
  ): Promise<void> {
    const overlapping = await this.prisma.db.taxParameter.findFirst({
      where: {
        companyId,
        branchId,
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
        effectiveFrom: to ? { lte: to } : undefined,
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
      },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    });

    if (overlapping) {
      throw new ConflictException(
        'Já existe parâmetro fiscal vigente neste período para esta empresa/filial: encerre a vigência do anterior antes.',
      );
    }
  }
}
