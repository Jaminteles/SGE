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
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ReconciliationRulesService } from './reconciliation-rules.service';
import {
  CreateReconciliationRuleDto,
  QueryReconciliationRuleDto,
  UpdateReconciliationRuleDto,
} from './dto/reconciliation-rule.dto';

/**
 * Regras de conciliação automática (RF-075).
 *
 * Recurso de permissão próprio, separado de `reconciliation`: quem concilia no
 * dia a dia não precisa poder afrouxar a tolerância que decide o que o sistema
 * aceita como correspondência — e toda alteração aqui vai para a trilha de
 * auditoria (bd/14 §2).
 */
@ApiTags('Bancos — Regras de conciliação')
@ApiBearerAuth()
@Controller('reconciliation-rules')
export class ReconciliationRulesController {
  constructor(private readonly rules: ReconciliationRulesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.RECONCILIATION_RULES_CREATE)
  @ApiOperation({ summary: 'Cadastrar regra de conciliação automática (RF-075)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateReconciliationRuleDto) {
    return this.rules.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.RECONCILIATION_RULES_READ)
  @ApiOperation({ summary: 'Listar regras na ordem em que são avaliadas (paginado)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryReconciliationRuleDto) {
    return this.rules.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.RECONCILIATION_RULES_READ)
  @ApiOperation({ summary: 'Detalhar uma regra de conciliação' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.RECONCILIATION_RULES_UPDATE)
  @ApiOperation({ summary: 'Alterar critérios, tolerâncias e prioridade da regra' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReconciliationRuleDto,
  ) {
    return this.rules.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.RECONCILIATION_RULES_DELETE)
  @ApiOperation({
    summary: 'Desativar a regra — ela não é removida: explica conciliações já feitas (RF-077)',
  })
  deactivate(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.deactivate(companyId, id);
  }
}
