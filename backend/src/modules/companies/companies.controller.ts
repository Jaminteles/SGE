import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RecordStatus } from '@prisma/client';
import { RequireSuperAdmin } from '../../common/decorators/super-admin.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@ApiTags('Empresas')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  // ---- Autoatendimento da empresa ativa (administrador da empresa) ----------
  // Declaradas antes de ":id" para não colidir com o parâmetro de rota.

  @Get('current')
  @RequirePermissions(PERMISSIONS.COMPANY_READ)
  @ApiOperation({ summary: 'Dados cadastrais da empresa ativa (RF-003)' })
  findCurrent(@ActiveCompanyId() companyId: string) {
    return this.companies.findOne(companyId);
  }

  @Patch('current')
  @RequirePermissions(PERMISSIONS.COMPANY_UPDATE)
  @ApiOperation({ summary: 'Manter dados cadastrais da empresa ativa (RF-003)' })
  updateCurrent(@ActiveCompanyId() companyId: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(companyId, dto);
  }

  // ---- Ciclo de vida (administrador de plataforma) --------------------------

  @Post()
  @RequireSuperAdmin()
  @ApiOperation({ summary: 'Cadastrar empresa e provisionar perfil admin (RF-001)' })
  create(@Body() dto: CreateCompanyDto) {
    return this.companies.create(dto);
  }

  @Get()
  @RequireSuperAdmin()
  @ApiOperation({ summary: 'Listar empresas (paginado)' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.companies.findAll(query);
  }

  @Get(':id')
  @RequireSuperAdmin()
  @ApiOperation({ summary: 'Detalhar empresa' })
  findOne(@Param('id') id: string) {
    return this.companies.findOne(id);
  }

  @Patch(':id')
  @RequireSuperAdmin()
  @ApiOperation({ summary: 'Editar dados cadastrais da empresa (RF-003)' })
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(id, dto);
  }

  @Post(':id/activate')
  @RequireSuperAdmin()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ativar empresa (RF-001)' })
  activate(@Param('id') id: string) {
    return this.companies.setStatus(id, RecordStatus.ACTIVE);
  }

  @Post(':id/inactivate')
  @RequireSuperAdmin()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inativar empresa (RF-001)' })
  inactivate(@Param('id') id: string) {
    return this.companies.setStatus(id, RecordStatus.INACTIVE);
  }
}
