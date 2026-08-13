import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ReferencesService } from '../../common/references/references.service';
import { CreateStockLocationDto } from './dto/create-stock-location.dto';
import { UpdateStockLocationDto } from './dto/update-stock-location.dto';

const locationInclude = {
  branch: { select: { id: true, code: true, name: true } },
} satisfies Prisma.StockLocationInclude;

/**
 * Locais de estoque (RF-031) — `gestao.local_estoque`.
 *
 * O local é o endereço físico do saldo: sem ele, "quantidade em estoque" é um
 * número sem lugar, e a contagem de uma filial não bate com a de outra.
 */
@Injectable()
export class StockLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
  ) {}

  async create(companyId: string, dto: CreateStockLocationDto) {
    await this.references.assert(companyId, { branchId: dto.branchId });

    return this.prisma.transaction(async () => {
      if (dto.isDefault) {
        await this.clearDefault(companyId, dto.branchId);
      }
      const created = await this.prisma.db.stockLocation.create({
        data: {
          companyId,
          branchId: dto.branchId,
          code: dto.code,
          name: dto.name,
          isDefault: dto.isDefault ?? false,
        },
        select: { id: true },
      });
      return this.findOne(companyId, created.id);
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.StockLocationWhereInput = {
      companyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.stockLocation.findMany({
      where,
      include: locationInclude,
      orderBy: [{ code: 'asc' }],
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.stockLocation.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const location = await this.prisma.db.stockLocation.findFirst({
      where: { id, companyId },
      include: locationInclude,
    });
    if (!location) {
      throw new NotFoundException('Local de estoque não encontrado.');
    }
    return location;
  }

  async update(companyId: string, id: string, dto: UpdateStockLocationDto) {
    const current = await this.findOne(companyId, id);
    await this.references.assert(companyId, { branchId: dto.branchId });

    if (dto.isActive === false) {
      await this.assertEmpty(id);
    }

    return this.prisma.transaction(async () => {
      const branchId = dto.branchId ?? current.branchId;
      if (dto.isDefault) {
        await this.clearDefault(companyId, branchId, id);
      }
      await this.prisma.db.stockLocation.update({
        where: { id },
        data: {
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      return this.findOne(companyId, id);
    });
  }

  /**
   * Inativa: o local já movimentado é histórico (RN-009). Inativar com saldo
   * esconderia estoque que existe — a mercadoria some do alerta de mínimo e da
   * valorização sem nunca ter saído.
   */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    await this.assertEmpty(id);
    await this.prisma.db.stockLocation.update({ where: { id }, data: { isActive: false } });
    return this.findOne(companyId, id);
  }

  private async assertEmpty(locationId: string): Promise<void> {
    const withBalance = await this.prisma.db.stockBalance.findFirst({
      where: { locationId, quantity: { gt: 0 } },
      select: { id: true },
    });
    if (withBalance) {
      throw new BadRequestException(
        'O local ainda tem saldo. Transfira ou baixe o estoque antes de inativá-lo.',
      );
    }
  }

  /** Um padrão por filial — o índice único de bd/08 recusaria o segundo. */
  private async clearDefault(
    companyId: string,
    branchId: string,
    exceptId?: string,
  ): Promise<void> {
    await this.prisma.db.stockLocation.updateMany({
      where: {
        companyId,
        branchId,
        isDefault: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isDefault: false },
    });
  }
}
