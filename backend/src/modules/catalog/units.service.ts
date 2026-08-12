import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

/** Unidades de medida (RF-029) — `gestao.unidade_medida`. */
@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  create(companyId: string, dto: CreateUnitDto) {
    return this.prisma.db.unitOfMeasure.create({
      data: { companyId, symbol: dto.symbol, description: dto.description },
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.UnitOfMeasureWhereInput = {
      companyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            OR: [
              { symbol: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.unitOfMeasure.findMany({
      where,
      orderBy: { symbol: 'asc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.unitOfMeasure.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const unit = await this.prisma.db.unitOfMeasure.findFirst({ where: { id, companyId } });
    if (!unit) {
      throw new NotFoundException('Unidade de medida não encontrada.');
    }
    return unit;
  }

  async update(companyId: string, id: string, dto: UpdateUnitDto) {
    await this.findOne(companyId, id);
    return this.prisma.db.unitOfMeasure.update({
      where: { id },
      data: {
        ...(dto.symbol !== undefined ? { symbol: dto.symbol } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  /** Inativa: a unidade já usada em item e movimento não é removida (RN-009). */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.db.unitOfMeasure.update({ where: { id }, data: { isActive: false } });
  }
}
