import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { ReferencesService } from '../../common/references/references.service';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';

/** Categorias do catálogo (RF-029) — `gestao.categoria_produto`, hierárquica. */
@Injectable()
export class ProductCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
  ) {}

  async create(companyId: string, dto: CreateProductCategoryDto) {
    await this.references.assert(companyId, { productCategoryId: dto.parentId });
    return this.prisma.db.productCategory.create({
      data: { companyId, code: dto.code, name: dto.name, parentId: dto.parentId },
    });
  }

  async findAll(companyId: string, query: PaginationQueryDto) {
    const where: Prisma.ProductCategoryWhereInput = {
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

    const data = await this.prisma.db.productCategory.findMany({
      where,
      orderBy: { code: 'asc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.productCategory.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const category = await this.prisma.db.productCategory.findFirst({ where: { id, companyId } });
    if (!category) {
      throw new NotFoundException('Categoria de produto não encontrada.');
    }
    return category;
  }

  async update(companyId: string, id: string, dto: UpdateProductCategoryDto) {
    await this.findOne(companyId, id);
    if (dto.parentId === id) {
      throw new BadRequestException('Uma categoria não pode ser superior de si mesma.');
    }
    await this.references.assert(companyId, { productCategoryId: dto.parentId });

    // Ciclos indiretos (A → B → A) são recusados pelo banco (bd/07).
    return this.prisma.db.productCategory.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  /** Inativa: categoria com itens vinculados não é removida (RN-009). */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.db.productCategory.update({ where: { id }, data: { isActive: false } });
  }
}
