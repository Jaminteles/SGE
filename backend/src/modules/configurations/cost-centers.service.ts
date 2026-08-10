import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateCostCenterDto } from './dto/create-cost-center.dto';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto';

/** Centros de custo (RF-006) — `gestao.centro_custo`, hierárquico. */
@Injectable()
export class CostCentersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateCostCenterDto) {
    if (dto.parentId) {
      await this.ensureParent(companyId, dto.parentId);
    }
    return this.prisma.db.costCenter.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        parentId: dto.parentId,
        branchId: dto.branchId,
        ...(dto.acceptsEntry !== undefined ? { acceptsEntry: dto.acceptsEntry } : {}),
      },
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.CostCenterWhereInput = {
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

    const data = await this.prisma.db.costCenter.findMany({
      where,
      orderBy: { code: 'asc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.costCenter.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const costCenter = await this.prisma.db.costCenter.findFirst({ where: { id, companyId } });
    if (!costCenter) {
      throw new NotFoundException('Centro de custo não encontrado.');
    }
    return costCenter;
  }

  async update(companyId: string, id: string, dto: UpdateCostCenterDto) {
    await this.findOne(companyId, id);
    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('Um centro de custo não pode ser pai de si mesmo.');
      }
      await this.ensureParent(companyId, dto.parentId);
    }
    return this.prisma.db.costCenter.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
        ...(dto.acceptsEntry !== undefined ? { acceptsEntry: dto.acceptsEntry } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.db.costCenter.update({ where: { id }, data: { isActive: false } });
  }

  private async ensureParent(companyId: string, parentId: string) {
    const parent = await this.prisma.db.costCenter.findFirst({
      where: { id: parentId, companyId },
      select: { id: true },
    });
    if (!parent) {
      throw new BadRequestException('Centro de custo pai inválido.');
    }
  }
}
