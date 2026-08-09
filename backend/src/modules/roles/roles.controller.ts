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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@ApiTags('Perfis e Permissões')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'Listar catálogo de permissões (RF-011)' })
  listPermissions() {
    return this.roles.listPermissionCatalog();
  }

  @Post('roles')
  @RequirePermissions(PERMISSIONS.ROLES_CREATE)
  @ApiOperation({ summary: 'Criar perfil de acesso (RF-010)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateRoleDto) {
    return this.roles.create(companyId, dto);
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'Listar perfis (paginado)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.roles.findAll(companyId, query);
  }

  @Get('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'Detalhar perfil e suas permissões' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.roles.findOne(companyId, id);
  }

  @Patch('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_UPDATE)
  @ApiOperation({ summary: 'Editar perfil e permissões (RF-010, RF-011)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roles.update(companyId, id, dto);
  }

  @Delete('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover perfil (RF-010)' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.roles.remove(companyId, id);
  }
}
