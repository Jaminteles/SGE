import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecordStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(companyId: string, dto: CreateCategoryDto) {
    if (dto.parentId) {
      await this.ensureParent(companyId, dto.parentId);
    }
    return this.prisma.category.create({
      data: {
        companyId,
        name: dto.name,
        scope: dto.scope,
        parentId: dto.parentId,
      },
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.CategoryWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where,
        orderBy: [{ scope: 'asc' }, { name: 'asc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.category.count({ where }),
    ]);

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const category = await this.prisma.category.findFirst({ where: { id, companyId } });
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
    return this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.scope !== undefined ? { scope: dto.scope } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.category.update({
      where: { id },
      data: { status: RecordStatus.INACTIVE },
    });
  }

  private async ensureParent(companyId: string, parentId: string) {
    const parent = await this.prisma.category.findFirst({
      where: { id: parentId, companyId },
      select: { id: true },
    });
    if (!parent) {
      throw new BadRequestException('Categoria pai inválida.');
    }
  }
}
