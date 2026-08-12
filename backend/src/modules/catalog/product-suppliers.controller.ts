import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ProductSuppliersService } from './product-suppliers.service';
import { CreateProductSupplierDto } from './dto/create-product-supplier.dto';
import { UpdateProductSupplierDto } from './dto/update-product-supplier.dto';

@ApiTags('Catálogo — Fornecedores do item')
@ApiBearerAuth()
@Controller('products/:productId/suppliers')
export class ProductSuppliersController {
  constructor(private readonly suppliers: ProductSuppliersService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCT_SUPPLIERS_CREATE)
  @ApiOperation({ summary: 'Associar fornecedor ao produto ou serviço (RF-027)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Param('productId') productId: string,
    @Body() dto: CreateProductSupplierDto,
  ) {
    return this.suppliers.create(companyId, productId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCT_SUPPLIERS_READ)
  @ApiOperation({ summary: 'Listar fornecedores do item' })
  findAll(@ActiveCompanyId() companyId: string, @Param('productId') productId: string) {
    return this.suppliers.findAllByProduct(companyId, productId);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PRODUCT_SUPPLIERS_UPDATE)
  @ApiOperation({ summary: 'Editar preço de referência, prazo e preferência' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('productId') productId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductSupplierDto,
  ) {
    return this.suppliers.update(companyId, productId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.PRODUCT_SUPPLIERS_DELETE)
  @ApiOperation({ summary: 'Remover o vínculo com o fornecedor' })
  remove(
    @ActiveCompanyId() companyId: string,
    @Param('productId') productId: string,
    @Param('id') id: string,
  ) {
    return this.suppliers.remove(companyId, productId, id);
  }
}
