import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { AuditQueryService } from './audit-query.service';
import { QueryAuditDto } from './dto/query-audit.dto';

/**
 * Trilha de auditoria (M16) — somente leitura.
 *
 * Não há POST, PATCH nem DELETE por decisão de requisito (RF-118): a trilha é
 * append-only e escrever nela é responsabilidade do banco (trigger de DML) e do
 * AuditService (eventos de negócio). O banco recusa alteração e remoção mesmo
 * que uma rota venha a ser adicionada por engano.
 */
@ApiTags('Auditoria')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'Consultar e filtrar a trilha de auditoria (RF-117)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryAuditDto) {
    return this.audit.findAll(companyId, query);
  }

  @Get('entities/:entity/:entityId')
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'Histórico de um registro específico (RF-117)' })
  findByEntity(
    @ActiveCompanyId() companyId: string,
    @Param('entity') entity: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Query() query: QueryAuditDto,
  ) {
    return this.audit.findByEntity(companyId, entity, entityId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'Detalhar um evento da trilha (RF-116)' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.audit.findOne(companyId, id);
  }
}
