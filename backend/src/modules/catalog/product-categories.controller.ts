import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ProductCategoriesService } from './product-categories.service';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';

@ApiTags('Catálogo — Categorias')
@ApiBearerAuth()
@Controller('product-categories')
export class ProductCategoriesController {
  constructor(private readonly categories: ProductCategoriesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCT_CATEGORIES_CREATE)
  @ApiOperation({ summary: 'Cadastrar categoria de produto (RF-029)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateProductCategoryDto) {
    return this.categories.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCT_CATEGORIES_READ)
  @ApiOperation({ summary: 'Listar categorias de produto (paginado)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.categories.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PRODUCT_CATEGORIES_READ)
  @ApiOperation({ summary: 'Detalhar categoria de produto' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.categories.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PRODUCT_CATEGORIES_UPDATE)
  @ApiOperation({ summary: 'Editar categoria de produto' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductCategoryDto,
  ) {
    return this.categories.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PRODUCT_CATEGORIES_DELETE)
  @ApiOperation({ summary: 'Inativar categoria de produto' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.categories.remove(companyId, id);
  }
}
