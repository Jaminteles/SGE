import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { AutomationRulesService } from './automation-rules.service';
import {
  CreateAutomationRuleDto,
  QueryAutomationRuleDto,
  UpdateAutomationRuleDto,
} from './dto/automation-rule.dto';

/**
 * Regras de automação de avisos (RF-125).
 *
 * As permissões são separadas por consequência: consultar (`:READ`), cadastrar
 * (`:CREATE`), alterar gatilho, condição e destinatário (`:UPDATE`) e desativar
 * (`:DELETE`). As duas últimas são as que importam — mexer numa condição ou
 * desligar uma regra faz um aviso deixar de sair, e ninguém percebe a ausência
 * de um e-mail que não esperava conscientemente. Por isso não acompanham a
 * leitura, e toda alteração vai para a trilha de auditoria (RF-114).
 *
 * `DELETE` desativa, não apaga: a regra removida levaria junto a explicação de
 * por que alguém deixou de ser avisado.
 */
@ApiTags('Notificações e Automação')
@ApiBearerAuth()
@Controller('automation-rules')
export class AutomationRulesController {
  constructor(private readonly rules: AutomationRulesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.AUTOMATION_RULES_CREATE)
  @ApiOperation({ summary: 'Cadastrar regra de automação de avisos (RF-125)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateAutomationRuleDto) {
    return this.rules.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.AUTOMATION_RULES_READ)
  @ApiOperation({ summary: 'Listar regras de automação, com filtro por gatilho (RF-125)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryAutomationRuleDto) {
    return this.rules.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.AUTOMATION_RULES_READ)
  @ApiOperation({ summary: 'Consultar uma regra de automação (RF-125)' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.findOne(companyId, id);
  }

  @Get(':id/runs')
  @RequirePermissions(PERMISSIONS.AUTOMATION_RULES_READ)
  @ApiOperation({ summary: 'Histórico de execuções da regra (RF-125)' })
  runs(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.runs(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.AUTOMATION_RULES_UPDATE)
  @ApiOperation({ summary: 'Alterar gatilho, condições e destinatários (RF-125)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAutomationRuleDto,
  ) {
    return this.rules.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.AUTOMATION_RULES_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desativar a regra: os avisos deste gatilho param (RF-125)' })
  deactivate(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.deactivate(companyId, id);
  }
}
