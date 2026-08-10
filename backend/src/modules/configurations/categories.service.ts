import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

/**
 * Categorias financeiras (RF-006) — `gestao.categoria_financeira`.
 * Cada categoria tem código único na empresa e natureza PAGAR/RECEBER.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateCategoryDto) {
    if (dto.parentId) {
      await this.ensureParent(companyId, dto.parentId);
    }
    return this.prisma.db.category.create({
      data: {
        companyId,
        code: dto.code,
        name: dto.name,
        type: dto.type,
        parentId: dto.parentId,
        ...(dto.acceptsEntry !== undefined ? { acceptsEntry: dto.acceptsEntry } : {}),
      },
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.CategoryWhereInput = {
      companyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.category.findMany({
      where,
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.category.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const category = await this.prisma.db.category.findFirst({ where: { id, companyId } });
    if (!category) {
      throw new NotFoundException('Categoria não encontrada.');
    }
    return category;
  }

  async update(companyId: string, id: string, dto: UpdateCategoryDto) {
    await this.findOne(companyId, id);
    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('Uma categoria não pode ser pai de si mesma.');
      }
      await this.ensureParent(companyId, dto.parentId);
    }
    return this.prisma.db.category.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        ...(dto.acceptsEntry !== undefined ? { acceptsEntry: dto.acceptsEntry } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.db.category.update({ where: { id }, data: { isActive: false } });
  }

  private async ensureParent(companyId: string, parentId: string) {
    const parent = await this.prisma.db.category.findFirst({
      where: { id: parentId, companyId },
      select: { id: true },
    });
    if (!parent) {
      throw new BadRequestException('Categoria pai inválida.');
    }
  }
}
