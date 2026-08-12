import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferencesService } from '../../common/references/references.service';
import { ProductsService } from './products.service';
import { CreateProductSupplierDto } from './dto/create-product-supplier.dto';
import { UpdateProductSupplierDto } from './dto/update-product-supplier.dto';

const supplierInclude = {
  partner: {
    select: { id: true, legalName: true, tradeName: true, cnpj: true, cpf: true, isActive: true },
  },
} satisfies Prisma.ProductSupplierInclude;

const productInclude = {
  product: { select: { id: true, code: true, description: true, type: true, isActive: true } },
} satisfies Prisma.ProductSupplierInclude;

/**
 * Fornecedores de um item (RF-027) — `gestao.produto_fornecedor`.
 *
 * Só entra parceiro com o papel de fornecedor: vincular um cliente ao item
 * geraria pedido de compra contra quem não vende (a mesma regra está no
 * trigger de bd/07, que é o que sobrevive a qualquer caminho de escrita).
 */
@Injectable()
export class ProductSuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly references: ReferencesService,
  ) {}

  async create(companyId: string, productId: string, dto: CreateProductSupplierDto) {
    await this.products.findOne(companyId, productId);
    await this.references.assert(companyId, { supplierId: dto.partnerId });

    const existing = await this.prisma.db.productSupplier.findFirst({
      where: { companyId, productId, partnerId: dto.partnerId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Este fornecedor já está vinculado ao item.');
    }

    return this.prisma.transaction(async () => {
      if (dto.isPreferred) {
        await this.clearPreferred(companyId, productId);
      }
      return this.prisma.db.productSupplier.create({
        data: {
          companyId,
          productId,
          partnerId: dto.partnerId,
          supplierCode: dto.supplierCode,
          referencePrice:
            dto.referencePrice !== undefined ? new Prisma.Decimal(dto.referencePrice) : undefined,
          deliveryDays: dto.deliveryDays,
          isPreferred: dto.isPreferred ?? false,
        },
        include: supplierInclude,
      });
    });
  }

  async findAllByProduct(companyId: string, productId: string) {
    await this.products.findOne(companyId, productId);
    return this.prisma.db.productSupplier.findMany({
      where: { companyId, productId },
      include: supplierInclude,
      orderBy: [{ isPreferred: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /** Visão inversa: o que a empresa compra deste fornecedor (RF-027). */
  async findAllByPartner(companyId: string, partnerId: string) {
    await this.references.assert(companyId, { partnerId });
    return this.prisma.db.productSupplier.findMany({
      where: { companyId, partnerId },
      include: productInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(companyId: string, productId: string, id: string, dto: UpdateProductSupplierDto) {
    const current = await this.load(companyId, productId, id);

    return this.prisma.transaction(async () => {
      if (dto.isPreferred) {
        await this.clearPreferred(companyId, productId);
      }
      return this.prisma.db.productSupplier.update({
        where: { id: current.id },
        data: {
          ...(dto.supplierCode !== undefined ? { supplierCode: dto.supplierCode } : {}),
          ...(dto.referencePrice !== undefined
            ? { referencePrice: new Prisma.Decimal(dto.referencePrice) }
            : {}),
          ...(dto.deliveryDays !== undefined ? { deliveryDays: dto.deliveryDays } : {}),
          ...(dto.isPreferred !== undefined ? { isPreferred: dto.isPreferred } : {}),
        },
        include: supplierInclude,
      });
    });
  }

  /** O vínculo não tem coluna `ativo`: desfazer a associação é remover a linha. */
  async remove(companyId: string, productId: string, id: string) {
    const current = await this.load(companyId, productId, id);
    await this.prisma.db.productSupplier.delete({ where: { id: current.id } });
  }

  private async load(companyId: string, productId: string, id: string) {
    const link = await this.prisma.db.productSupplier.findFirst({
      where: { id, companyId, productId },
    });
    if (!link) {
      throw new NotFoundException('Vínculo com fornecedor não encontrado.');
    }
    return link;
  }

  /** Só existe um fornecedor preferencial por item. */
  private async clearPreferred(companyId: string, productId: string) {
    await this.prisma.db.productSupplier.updateMany({
      where: { companyId, productId, isPreferred: true },
      data: { isPreferred: false },
    });
  }
}
