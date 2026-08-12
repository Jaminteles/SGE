import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ItemType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResult } from '../../common/dto/paginated-result';
import { ReferencesService } from '../../common/references/references.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';

const productInclude = {
  category: { select: { id: true, code: true, name: true } },
  unit: { select: { id: true, symbol: true, description: true } },
} satisfies Prisma.ProductInclude;

/** Converte decimal opcional preservando `null` (desvincular) e `undefined`. */
function decimal(value?: string | null): Prisma.Decimal | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Prisma.Decimal(value);
}

/**
 * Produtos e serviços (RF-028 a RF-030) — `gestao.produto`.
 *
 * Serviço não tem estoque: o banco recusa `SERVICO` com `controla_estoque`
 * (CHECK em bd/01), e aqui a regra é aplicada antes, para virar 400 e não 500.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferencesService,
  ) {}

  async create(companyId: string, dto: CreateProductDto) {
    const type = dto.type ?? ItemType.PRODUTO;
    const tracksStock = this.resolveTracksStock(type, dto.tracksStock);
    this.assertStockRange(dto.minStock, dto.maxStock);
    this.assertServiceCode(type, dto.serviceCodeLc116);
    await this.references.assert(companyId, {
      productCategoryId: dto.categoryId,
      unitId: dto.unitId,
    });

    const product = await this.prisma.db.product.create({
      data: {
        companyId,
        type,
        tracksStock,
        code: dto.code,
        barcode: dto.barcode,
        description: dto.description,
        extraDescription: dto.extraDescription,
        categoryId: dto.categoryId,
        unitId: dto.unitId,
        ncm: dto.ncm,
        cest: dto.cest,
        defaultInboundCfop: dto.defaultInboundCfop,
        defaultOutboundCfop: dto.defaultOutboundCfop,
        goodsOrigin: dto.goodsOrigin,
        serviceCodeLc116: dto.serviceCodeLc116,
        salePrice: decimal(dto.salePrice),
        defaultMargin: decimal(dto.defaultMargin),
        ...(dto.minStock !== undefined ? { minStock: new Prisma.Decimal(dto.minStock) } : {}),
        maxStock: decimal(dto.maxStock),
        netWeight: decimal(dto.netWeight),
        grossWeight: decimal(dto.grossWeight),
      },
    });

    return this.findOne(companyId, product.id);
  }

  async findAll(companyId: string, query: QueryProductDto) {
    const where: Prisma.ProductWhereInput = {
      companyId,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.supplierId ? { suppliers: { some: { partnerId: query.supplierId } } } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
              { barcode: { contains: query.q } },
            ],
          }
        : {}),
    };

    const data = await this.prisma.db.product.findMany({
      where,
      include: productInclude,
      orderBy: { description: 'asc' },
      skip: query.skip,
      take: query.take,
    });
    const total = await this.prisma.db.product.count({ where });

    return new PaginatedResult(data, total, query.page, query.pageSize);
  }

  async findOne(companyId: string, id: string) {
    const product = await this.prisma.db.product.findFirst({
      where: { id, companyId },
      include: productInclude,
    });
    if (!product) {
      throw new NotFoundException('Produto ou serviço não encontrado.');
    }
    return product;
  }

  async update(companyId: string, id: string, dto: UpdateProductDto) {
    const current = await this.findOne(companyId, id);
    const type = dto.type ?? current.type;
    const tracksStock = this.resolveTracksStock(
      type,
      dto.tracksStock ?? (dto.type ? current.tracksStock : undefined),
    );
    this.assertStockRange(
      dto.minStock ?? current.minStock.toString(),
      dto.maxStock ?? current.maxStock?.toString(),
    );
    this.assertServiceCode(type, dto.serviceCodeLc116 ?? current.serviceCodeLc116);
    await this.references.assert(companyId, {
      productCategoryId: dto.categoryId,
      unitId: dto.unitId,
    });

    await this.prisma.db.product.update({
      where: { id: current.id },
      data: {
        ...(dto.type !== undefined ? { type } : {}),
        ...(dto.type !== undefined || dto.tracksStock !== undefined ? { tracksStock } : {}),
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.extraDescription !== undefined ? { extraDescription: dto.extraDescription } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.unitId !== undefined ? { unitId: dto.unitId } : {}),
        ...(dto.ncm !== undefined ? { ncm: dto.ncm } : {}),
        ...(dto.cest !== undefined ? { cest: dto.cest } : {}),
        ...(dto.defaultInboundCfop !== undefined
          ? { defaultInboundCfop: dto.defaultInboundCfop }
          : {}),
        ...(dto.defaultOutboundCfop !== undefined
          ? { defaultOutboundCfop: dto.defaultOutboundCfop }
          : {}),
        ...(dto.goodsOrigin !== undefined ? { goodsOrigin: dto.goodsOrigin } : {}),
        ...(dto.serviceCodeLc116 !== undefined ? { serviceCodeLc116: dto.serviceCodeLc116 } : {}),
        ...(dto.salePrice !== undefined ? { salePrice: decimal(dto.salePrice) } : {}),
        ...(dto.defaultMargin !== undefined ? { defaultMargin: decimal(dto.defaultMargin) } : {}),
        ...(dto.minStock !== undefined ? { minStock: new Prisma.Decimal(dto.minStock) } : {}),
        ...(dto.maxStock !== undefined ? { maxStock: decimal(dto.maxStock) } : {}),
        ...(dto.netWeight !== undefined ? { netWeight: decimal(dto.netWeight) } : {}),
        ...(dto.grossWeight !== undefined ? { grossWeight: decimal(dto.grossWeight) } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    return this.findOne(companyId, id);
  }

  /** Inativa: item com movimento de estoque ou nota não é removido (RN-009). */
  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    await this.prisma.db.product.update({ where: { id }, data: { isActive: false } });
    return this.findOne(companyId, id);
  }

  private resolveTracksStock(type: ItemType, tracksStock?: boolean): boolean {
    if (type === ItemType.SERVICO) {
      if (tracksStock) {
        throw new BadRequestException('Serviço não controla estoque.');
      }
      return false;
    }
    return tracksStock ?? true;
  }

  private assertStockRange(minStock?: string | null, maxStock?: string | null): void {
    if (!maxStock) return;
    const min = new Prisma.Decimal(minStock ?? 0);
    if (new Prisma.Decimal(maxStock).lessThan(min)) {
      throw new BadRequestException('O estoque máximo não pode ser menor que o mínimo.');
    }
  }

  /** Serviço sem código da LC 116 não é classificável na NFS-e (RF-030). */
  private assertServiceCode(type: ItemType, serviceCode?: string | null): void {
    if (type === ItemType.SERVICO && !serviceCode?.trim()) {
      throw new BadRequestException('Serviço exige o código de serviço da LC 116 (RF-030).');
    }
  }
}
