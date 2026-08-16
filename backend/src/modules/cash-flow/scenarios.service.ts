import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { ReferencesService } from '../../common/references/references.service';
import { formatDateOnly, toDateOnly } from '../../common/utils/date-only';
import { CreateScenarioDto } from './dto/create-scenario.dto';
import { UpdateScenarioDto } from './dto/update-scenario.dto';
import { CreateProjectionDto } from './dto/create-projection.dto';

/** Premissas aceitas pelo cenário — a mesma lista que o banco valida (bd/10). */
export interface ScenarioAssumptions {
  entradas_percentual?: number;
  saidas_percentual?: number;
}

const scenarioSelect = {
  id: true,
  name: true,
  description: true,
  startDate: true,
  endDate: true,
  openingBalance: true,
  assumptions: true,
  isBaseline: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CashFlowScenarioSelect;

const projectionInclude = {
  category: { select: { id: true, code: true, name: true } },
  costCenter: { select: { id: true, code: true, name: true } },
} satisfies Prisma.CashFlowProjectionInclude;

/**
 * Cenários e projeções manuais (RF-104).
 *
 * Um cenário é uma pergunta — "e se as vendas caírem 10%?" — respondida sobre o
 * mesmo consolidado real: ele não copia a carteira, apenas guarda a janela, o
 * caixa de partida, as premissas e os movimentos que alguém digitou. Por isso
 * criar cenário não muda número nenhum do financeiro, e apagá-lo também não.
 *
 * O banco é quem recusa premissa desconhecida, projeção fora da janela e
 * situação diferente de PREVISTO (bd/10); esta camada existe para responder 400
 * com mensagem de campo em vez de deixar o trigger virar 500.
 */
@Injectable()
export class ScenariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
  ) {}

  async create(companyId: string, dto: CreateScenarioDto, userId: string) {
    const startDate = toDateOnly(dto.startDate);
    const endDate = toDateOnly(dto.endDate);
    this.assertWindow(startDate, endDate);

    return this.prisma.transaction(async () => {
      if (dto.isBaseline) await this.clearBaseline(companyId);

      const created = await this.prisma.db.cashFlowScenario.create({
        data: {
          companyId,
          name: dto.name,
          description: dto.description,
          startDate,
          endDate,
          openingBalance: dto.openingBalance
            ? new Prisma.Decimal(dto.openingBalance)
            : await this.currentCashBalance(companyId),
          assumptions: (dto.assumptions ?? {}) as Prisma.InputJsonValue,
          isBaseline: dto.isBaseline ?? false,
          createdById: userId,
        },
        select: scenarioSelect,
      });

      return created;
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.CashFlowScenarioWhereInput = {
      companyId,
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const data = await this.prisma.db.cashFlowScenario.findMany({
      where,
      select: scenarioSelect,
      orderBy: [{ isBaseline: 'desc' }, { startDate: 'desc' }],
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.cashFlowScenario.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const scenario = await this.prisma.db.cashFlowScenario.findFirst({
      where: { id, companyId },
      select: scenarioSelect,
    });
    if (!scenario) {
      throw new NotFoundException('Cenário não encontrado.');
    }
    return scenario;
  }

  async update(companyId: string, id: string, dto: UpdateScenarioDto) {
    const current = await this.findOne(companyId, id);

    const startDate = dto.startDate ? toDateOnly(dto.startDate) : current.startDate;
    const endDate = dto.endDate ? toDateOnly(dto.endDate) : current.endDate;
    this.assertWindow(startDate, endDate);

    // Encurtar a janela deixaria projeções manuais fora dela — linhas com data e
    // valor que o cenário não cobre mais, e que nenhuma consulta traria de
    // volta. O banco recusaria a inserção dessas mesmas linhas; recusar aqui
    // impede que a edição produza o que a inserção não permitiria.
    if (dto.startDate || dto.endDate) {
      const orphans = await this.prisma.db.cashFlowProjection.count({
        where: {
          scenarioId: id,
          OR: [{ referenceDate: { lt: startDate } }, { referenceDate: { gt: endDate } }],
        },
      });
      if (orphans > 0) {
        throw new ConflictException(
          `A nova janela deixaria ${orphans} projeção(ões) manual(is) fora do cenário. ` +
            'Remova-as antes de encurtar o período.',
        );
      }
    }

    return this.prisma.transaction(async () => {
      if (dto.isBaseline) await this.clearBaseline(companyId, id);

      return this.prisma.db.cashFlowScenario.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.startDate ? { startDate } : {}),
          ...(dto.endDate ? { endDate } : {}),
          ...(dto.openingBalance !== undefined
            ? { openingBalance: new Prisma.Decimal(dto.openingBalance) }
            : {}),
          ...(dto.assumptions !== undefined
            ? { assumptions: dto.assumptions as Prisma.InputJsonValue }
            : {}),
          ...(dto.isBaseline !== undefined ? { isBaseline: dto.isBaseline } : {}),
        },
        select: scenarioSelect,
      });
    });
  }

  /** Remove o cenário e, com ele, as projeções que só existiam dentro dele. */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    await this.prisma.db.cashFlowScenario.delete({ where: { id } });
  }

  async listProjections(companyId: string, scenarioId: string) {
    await this.findOne(companyId, scenarioId);

    return this.prisma.db.cashFlowProjection.findMany({
      where: { scenarioId, companyId },
      include: projectionInclude,
      orderBy: [{ referenceDate: 'asc' }],
    });
  }

  async addProjection(companyId: string, scenarioId: string, dto: CreateProjectionDto) {
    const scenario = await this.findOne(companyId, scenarioId);
    await this.references.assert(companyId, {
      categoryId: dto.categoryId,
      costCenterId: dto.costCenterId,
    });

    const referenceDate = toDateOnly(dto.referenceDate);
    if (referenceDate < scenario.startDate || referenceDate > scenario.endDate) {
      throw new BadRequestException(
        `A data precisa cair entre ${formatDateOnly(scenario.startDate)} e ` +
          `${formatDateOnly(scenario.endDate)}, a janela do cenário.`,
      );
    }

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'O valor precisa ser maior que zero — a direção vem do tipo (PAGAR/RECEBER).',
      );
    }

    return this.prisma.db.cashFlowProjection.create({
      data: {
        companyId,
        scenarioId,
        referenceDate,
        type: dto.type,
        amount,
        description: dto.description,
        categoryId: dto.categoryId,
        costCenterId: dto.costCenterId,
      },
      include: projectionInclude,
    });
  }

  async removeProjection(companyId: string, scenarioId: string, projectionId: string) {
    const projection = await this.prisma.db.cashFlowProjection.findFirst({
      where: { id: projectionId, scenarioId, companyId },
      select: { id: true },
    });
    if (!projection) {
      throw new NotFoundException('Projeção não encontrada neste cenário.');
    }
    await this.prisma.db.cashFlowProjection.delete({ where: { id: projectionId } });
  }

  /**
   * Só um cenário base por empresa (índice parcial em bd/10).
   *
   * Desmarcar o anterior antes de marcar o novo é o que evita que a promoção
   * bata na unicidade — e é feito dentro da mesma transação, para não existir
   * instante em que a empresa fica sem base.
   */
  private async clearBaseline(companyId: string, exceptId?: string): Promise<void> {
    await this.prisma.db.cashFlowScenario.updateMany({
      where: { companyId, isBaseline: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      data: { isBaseline: false },
    });
  }

  private assertWindow(startDate: Date, endDate: Date): void {
    if (endDate < startDate) {
      throw new BadRequestException('O fim da janela não pode ser anterior ao início.');
    }
  }

  /** Saldo de hoje como partida padrão do cenário (RF-105, `bd/10`). */
  private async currentCashBalance(companyId: string): Promise<Prisma.Decimal> {
    const [row] = await this.prisma.db.$queryRaw<{ saldo: Prisma.Decimal }[]>`
      SELECT fn_saldo_caixa_atual(${companyId}::uuid, NULL::uuid) AS saldo
    `;
    return row?.saldo ?? new Prisma.Decimal(0);
  }
}
