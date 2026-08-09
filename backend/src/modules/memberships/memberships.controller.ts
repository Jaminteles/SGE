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
import { MembershipsService } from './memberships.service';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';

@ApiTags('Associações de Usuários')
@ApiBearerAuth()
@Controller('memberships')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.MEMBERSHIPS_CREATE)
  @ApiOperation({ summary: 'Associar usuário à empresa (RF-004)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateMembershipDto) {
    return this.memberships.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.MEMBERSHIPS_READ)
  @ApiOperation({ summary: 'Listar associações da empresa (paginado)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.memberships.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.MEMBERSHIPS_READ)
  @ApiOperation({ summary: 'Detalhar associação' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.memberships.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.MEMBERSHIPS_UPDATE)
  @ApiOperation({ summary: 'Alterar perfil/situação do usuário na empresa (RF-004)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMembershipDto,
  ) {
    return this.memberships.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.MEMBERSHIPS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover associação de usuário (RF-004)' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.memberships.remove(companyId, id);
  }
}
