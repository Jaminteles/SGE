import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('Categorias')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.CATEGORIES_CREATE)
  @ApiOperation({ summary: 'Cadastrar categoria (RF-006)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateCategoryDto) {
    return this.categories.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CATEGORIES_READ)
  @ApiOperation({ summary: 'Listar categorias (paginado)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.categories.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CATEGORIES_READ)
  @ApiOperation({ summary: 'Detalhar categoria' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.categories.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CATEGORIES_UPDATE)
  @ApiOperation({ summary: 'Editar categoria (RF-006)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CATEGORIES_DELETE)
  @ApiOperation({ summary: 'Inativar categoria (RF-006)' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.categories.remove(companyId, id);
  }
}
