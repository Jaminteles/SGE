import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@ApiTags('Filiais')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.BRANCHES_CREATE)
  @ApiOperation({ summary: 'Cadastrar filial (RF-002)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateBranchDto) {
    return this.branches.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.BRANCHES_READ)
  @ApiOperation({ summary: 'Listar filiais (paginado)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.branches.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BRANCHES_READ)
  @ApiOperation({ summary: 'Detalhar filial' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.branches.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BRANCHES_UPDATE)
  @ApiOperation({ summary: 'Editar filial (RF-002)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branches.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BRANCHES_DELETE)
  @ApiOperation({ summary: 'Inativar filial (RF-002)' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.branches.remove(companyId, id);
  }
}
