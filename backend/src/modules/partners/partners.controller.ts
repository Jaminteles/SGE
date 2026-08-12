import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PartnersService } from './partners.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { QueryPartnerDto } from './dto/query-partner.dto';

@ApiTags('Parceiros — Clientes e Fornecedores')
@ApiBearerAuth()
@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.PARTNERS_CREATE)
  @ApiOperation({ summary: 'Cadastrar cliente e/ou fornecedor PF/PJ (RF-022/RF-023)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreatePartnerDto) {
    return this.partners.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.PARTNERS_READ)
  @ApiOperation({ summary: 'Listar parceiros (paginado, filtro por papel e tipo de pessoa)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryPartnerDto) {
    return this.partners.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PARTNERS_READ)
  @ApiOperation({ summary: 'Detalhar parceiro com os dados de cliente e fornecedor' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.partners.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PARTNERS_UPDATE)
  @ApiOperation({ summary: 'Editar parceiro, papéis e condições de pagamento (RF-024/RF-026)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePartnerDto,
  ) {
    return this.partners.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PARTNERS_DELETE)
  @ApiOperation({ summary: 'Inativar parceiro' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.partners.remove(companyId, id);
  }
}
