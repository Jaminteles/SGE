import { Module } from '@nestjs/common';

import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductCategoriesController } from './product-categories.controller';
import { ProductCategoriesService } from './product-categories.service';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';
import { ProductSuppliersController } from './product-suppliers.controller';
import { SupplierProductsController } from './supplier-products.controller';
import { ProductSuppliersService } from './product-suppliers.service';

/**
 * M05 — Produtos, Serviços e Estoque: cadastro (RF-028 a RF-030) e o vínculo
 * com fornecedores (RF-027). Controle e movimentação de estoque ficam na
 * Sprint 5.
 */
@Module({
  controllers: [
    ProductsController,
    ProductCategoriesController,
    UnitsController,
    ProductSuppliersController,
    SupplierProductsController,
  ],
  providers: [ProductsService, ProductCategoriesService, UnitsService, ProductSuppliersService],
  exports: [ProductsService],
})
export class CatalogModule {}
