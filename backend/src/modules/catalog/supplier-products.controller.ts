import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ProductSuppliersService } from './product-suppliers.service';

/**
 * Visão inversa do RF-027: os itens fornecidos por um parceiro.
 *
 * Fica no M05 porque o dono do vínculo é o item — a rota é de conveniência
 * para quem parte do fornecedor, e usa a mesma permissão do vínculo.
 */
@ApiTags('Catálogo — Itens do fornecedor')
@ApiBearerAuth()
@Controller('partners/:partnerId/products')
export class SupplierProductsController {
  constructor(private readonly suppliers: ProductSuppliersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCT_SUPPLIERS_READ)
  @ApiOperation({ summary: 'Listar produtos e serviços fornecidos pelo parceiro (RF-027)' })
  findAll(@ActiveCompanyId() companyId: string, @Param('partnerId') partnerId: string) {
    return this.suppliers.findAllByPartner(companyId, partnerId);
  }
}
