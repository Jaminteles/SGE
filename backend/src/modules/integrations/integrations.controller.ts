import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ApiDocsService } from './api-docs.service';
import {
  CreateIntegrationDto,
  QueryFailedWorkDto,
  QueryIntegrationDto,
  QueryIntegrationEventDto,
  ReprocessDto,
  SetIntegrationParametersDto,
  SuspendIntegrationDto,
  UpdateIntegrationDto,
} from './dto/integration.dto';
import { IntegrationMonitorService } from './integration-monitor.service';
import { IntegrationReprocessService } from './integration-reprocess.service';
import { IntegrationsService } from './integrations.service';

/**
 * M18 — Administração e Integrações (RF-126 a RF-131).
 *
 * Toda rota é autenticada (JwtAuthGuard global), passa pelo PermissionsGuard e
 * resolve a empresa por `@ActiveCompanyId` — o id da empresa nunca vem do corpo
 * nem da rota, que é o que fecha a porta de trocar o id para operar a
 * integração de outra empresa.
 *
 * As rotas fixas (`/health`, `/events`, `/failed`, `/api-docs`) são declaradas
 * antes de `/:id` de propósito: o Nest casa na ordem de declaração, e
 * `GET /integrations/health` bateria em `findOne('health')` se viesse depois.
 */
@ApiTags('M18 — Administração e Integrações')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly monitor: IntegrationMonitorService,
    private readonly reprocessing: IntegrationReprocessService,
    private readonly docs: ApiDocsService,
  ) {}

  // ---------------------------------------------------------------------------
  // RF-128 — Monitoramento
  // ---------------------------------------------------------------------------

  @Get('health')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_READ)
  @ApiOperation({ summary: 'Painel de saúde das integrações e da fila — RF-128' })
  health(@ActiveCompanyId() companyId: string) {
    return this.monitor.health(companyId);
  }

  // ---------------------------------------------------------------------------
  // RF-129 — Diário de eventos e erros
  // ---------------------------------------------------------------------------

  @Get('events')
  @RequirePermissions(PERMISSIONS.INTEGRATION_EVENTS_READ)
  @ApiOperation({ summary: 'Consultar eventos e erros das integrações — RF-129' })
  events(@ActiveCompanyId() companyId: string, @Query() query: QueryIntegrationEventDto) {
    return this.monitor.findEvents(companyId, query);
  }

  // ---------------------------------------------------------------------------
  // RF-130 — Reprocessamento
  // ---------------------------------------------------------------------------

  @Get('failed')
  @RequirePermissions(PERMISSIONS.INTEGRATION_EVENTS_READ)
  @ApiOperation({ summary: 'Listar jobs e webhooks parados em falha — RF-130' })
  failed(@ActiveCompanyId() companyId: string, @Query() query: QueryFailedWorkDto) {
    return this.reprocessing.findFailed(companyId, query);
  }

  @Post('reprocess')
  @RequirePermissions(PERMISSIONS.INTEGRATION_EVENTS_APPROVE)
  @ApiOperation({ summary: 'Reprocessar job ou webhook que falhou — RF-130' })
  reprocess(@ActiveCompanyId() companyId: string, @Body() dto: ReprocessDto) {
    return this.reprocessing.reprocess(companyId, dto);
  }

  // ---------------------------------------------------------------------------
  // RF-131 — Documentação da API
  // ---------------------------------------------------------------------------

  @Get('api-docs')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_READ)
  @ApiOperation({ summary: 'Sumário navegável dos endpoints da API — RF-131' })
  apiDocs() {
    return this.docs.summary();
  }

  @Get('api-docs/openapi.json')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_READ)
  @ApiOperation({ summary: 'Especificação OpenAPI completa (autenticada) — RF-131' })
  openapi() {
    return this.docs.spec();
  }

  // ---------------------------------------------------------------------------
  // RF-126 / RF-127 — Cadastro e configuração
  // ---------------------------------------------------------------------------

  @Post()
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_CREATE)
  @ApiOperation({ summary: 'Cadastrar integração externa — RF-126' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateIntegrationDto) {
    return this.integrations.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_READ)
  @ApiOperation({ summary: 'Listar integrações da empresa — RF-126' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryIntegrationDto) {
    return this.integrations.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_READ)
  @ApiOperation({ summary: 'Detalhar integração (sem segredo) — RF-126' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_UPDATE)
  @ApiOperation({ summary: 'Alterar integração — RF-126/RF-127' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIntegrationDto,
  ) {
    return this.integrations.update(companyId, id, dto);
  }

  @Patch(':id/parameters')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_UPDATE)
  @ApiOperation({ summary: 'Substituir os parâmetros da integração — RF-127' })
  setParameters(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetIntegrationParametersDto,
  ) {
    return this.integrations.setParameters(companyId, id, dto);
  }

  @Post(':id/activate')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_UPDATE)
  @ApiOperation({ summary: 'Ativar integração — RF-126' })
  activate(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.activate(companyId, id);
  }

  @Post(':id/suspend')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_UPDATE)
  @ApiOperation({ summary: 'Suspender integração com motivo — RF-128' })
  suspend(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendIntegrationDto,
  ) {
    return this.integrations.suspend(companyId, id, dto);
  }

  @Post(':id/resume')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_UPDATE)
  @ApiOperation({ summary: 'Retomar integração suspensa — RF-128' })
  resume(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.resume(companyId, id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_DELETE)
  @ApiOperation({ summary: 'Desativar integração (o histórico é preservado) — RF-126' })
  deactivate(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.deactivate(companyId, id);
  }
}
