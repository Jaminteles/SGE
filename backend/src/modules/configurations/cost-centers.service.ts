import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecordStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';

@Injectable()
export class CostCentersService {
  constructor(private readonly prisma: PrismaService) {}

  create(companyId: string, dto: CreateCostCenterDto) {
    return this.prisma.costCenter.create({
      data: { companyId, code: dto.code, name: dto.name },
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.CostCenterWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.costCenter.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.costCenter.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const costCenter = await this.prisma.costCenter.findFirst({ where: { id, companyId } });
    if (!costCenter) {
      throw new NotFoundException('Centro de custo não encontrado.');
    }
    return costCenter;
  }

  async update(companyId: string, id: string, dto: UpdateCostCenterDto) {
    await this.findOne(companyId, id);
    return this.prisma.costCenter.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.costCenter.update({
      where: { id },
      data: { status: RecordStatus.INACTIVE },
    });
  }
}
