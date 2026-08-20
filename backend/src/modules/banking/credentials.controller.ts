import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { CredentialsService } from './credentials.service';
import { CreateCredentialDto } from './dto/create-credential.dto';
import { UpdateCredentialDto } from './dto/update-credential.dto';

/**
 * Provedores e credenciais de integração (RF-061).
 *
 * O catálogo de provedores é global e somente leitura — quem o mantém é o script
 * do banco (bd/13). As credenciais são por empresa, e o segredo **nunca** é
 * devolvido: não existe `GET` que o traga, nem mascarado (RNF-003/RNF-005).
 *
 * `DELETE` desativa em vez de remover: contas e ordens já enviadas apontam para
 * a credencial, e o histórico precisa dizer com qual delas o dinheiro saiu.
 */
@ApiTags('Bancos — Integrações')
@ApiBearerAuth()
@Controller('banking')
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Get('providers')
  @RequirePermissions(PERMISSIONS.INTEGRATION_CREDENTIALS_READ)
  @ApiOperation({ summary: 'Listar provedores financeiros disponíveis e suas capacidades' })
  listProviders() {
    return this.credentials.listProviders();
  }

  @Post('credentials')
  @RequirePermissions(PERMISSIONS.INTEGRATION_CREDENTIALS_CREATE)
  @ApiOperation({ summary: 'Cadastrar credencial de integração (segredo cifrado) — RF-061' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateCredentialDto) {
    return this.credentials.create(companyId, dto);
  }

  @Get('credentials')
  @RequirePermissions(PERMISSIONS.INTEGRATION_CREDENTIALS_READ)
  @ApiOperation({ summary: 'Listar credenciais da empresa (sem o segredo)' })
  findAll(@ActiveCompanyId() companyId: string) {
    return this.credentials.findAll(companyId);
  }

  @Get('credentials/:id')
  @RequirePermissions(PERMISSIONS.INTEGRATION_CREDENTIALS_READ)
  @ApiOperation({ summary: 'Detalhar credencial (sem o segredo)' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.credentials.findOne(companyId, id);
  }

  @Patch('credentials/:id')
  @RequirePermissions(PERMISSIONS.INTEGRATION_CREDENTIALS_UPDATE)
  @ApiOperation({ summary: 'Alterar credencial ou rotacionar o segredo' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCredentialDto,
  ) {
    return this.credentials.update(companyId, id, dto);
  }

  @Delete('credentials/:id')
  @RequirePermissions(PERMISSIONS.INTEGRATION_CREDENTIALS_DELETE)
  @ApiOperation({ summary: 'Desativar credencial (o registro é preservado)' })
  deactivate(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.credentials.deactivate(companyId, id);
  }
}
