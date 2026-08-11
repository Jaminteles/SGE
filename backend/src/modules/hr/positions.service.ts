import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';

/** Cargos (RF-014) — `gestao.cargo`. */
@Injectable()
export class PositionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreatePositionDto) {
    const { minSalary, maxSalary } = this.parseRange(dto.minSalary, dto.maxSalary);

    return this.prisma.db.position.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        cbo: dto.cbo,
        description: dto.description,
        minSalary,
        maxSalary,
      },
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.PositionWhereInput = {
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

    const data = await this.prisma.db.position.findMany({
      where,
      orderBy: { code: 'asc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.position.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const position = await this.prisma.db.position.findFirst({ where: { id, companyId } });
    if (!position) {
      throw new NotFoundException('Cargo não encontrado.');
    }
    return position;
  }

  async update(companyId: string, id: string, dto: UpdatePositionDto) {
    const current = await this.findOne(companyId, id);
    const { minSalary, maxSalary } = this.parseRange(
      dto.minSalary ?? current.minSalary?.toString(),
      dto.maxSalary ?? current.maxSalary?.toString(),
    );

    return this.prisma.db.position.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.cbo !== undefined ? { cbo: dto.cbo } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.minSalary !== undefined ? { minSalary } : {}),
        ...(dto.maxSalary !== undefined ? { maxSalary } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  /** Inativa: cargo referenciado por funcionário ou histórico não é removido. */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.db.position.update({ where: { id }, data: { isActive: false } });
  }

  private parseRange(min?: string | null, max?: string | null) {
    const minSalary = min != null ? new Prisma.Decimal(min) : null;
    const maxSalary = max != null ? new Prisma.Decimal(max) : null;
    if (minSalary && minSalary.isNegative()) {
      throw new BadRequestException('minSalary não pode ser negativo.');
    }
    if (minSalary && maxSalary && maxSalary.lessThan(minSalary)) {
      throw new BadRequestException('maxSalary deve ser maior ou igual a minSalary.');
    }
    return { minSalary, maxSalary };
  }
}
