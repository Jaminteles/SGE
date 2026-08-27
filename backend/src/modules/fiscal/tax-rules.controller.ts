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
import {
  CreateTaxRuleDto,
  QueryTaxRuleDto,
  ResolveTaxRuleDto,
  UpdateTaxRuleDto,
} from './dto/tax-rule.dto';
import { TaxRulesService } from './tax-rules.service';

/**
 * Regras fiscais por operação e produto (RF-091).
 *
 * `GET /resolve` responde qual regra decide uma operação. É consulta: nenhum
 * documento é alterado e nenhum tributo declarado é reescrito — a nota recebida
 * é declaração de terceiro (bd/18).
 */
@ApiTags('Fiscal')
@ApiBearerAuth()
@Controller('fiscal/rules')
export class TaxRulesController {
  constructor(private readonly rules: TaxRulesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.TAX_RULES_CREATE)
  @ApiOperation({ summary: 'Cadastrar regra fiscal (RF-091)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateTaxRuleDto) {
    return this.rules.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.TAX_RULES_READ)
  @ApiOperation({ summary: 'Listar regras fiscais por critério (RF-091)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryTaxRuleDto) {
    return this.rules.findAll(companyId, query);
  }

  @Get('resolve')
  @RequirePermissions(PERMISSIONS.TAX_RULES_READ)
  @ApiOperation({ summary: 'Simular qual regra decide uma operação (RF-091)' })
  resolve(@ActiveCompanyId() companyId: string, @Query() query: ResolveTaxRuleDto) {
    return this.rules.resolve(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TAX_RULES_READ)
  @ApiOperation({ summary: 'Consultar uma regra fiscal (RF-091)' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TAX_RULES_UPDATE)
  @ApiOperation({ summary: 'Alterar critérios, prioridade e vigência (RF-091)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaxRuleDto,
  ) {
    return this.rules.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.TAX_RULES_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Inativar a regra fiscal (RF-091)' })
  deactivate(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.deactivate(companyId, id);
  }
}
