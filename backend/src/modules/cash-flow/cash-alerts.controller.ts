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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { CashAlertsService } from './cash-alerts.service';
import { CreateCashAlertDto } from './dto/create-cash-alert.dto';
import { UpdateCashAlertDto } from './dto/update-cash-alert.dto';

/**
 * Alertas de insuficiência de caixa (RF-105).
 *
 * A avaliação vem antes do CRUD nas rotas por ser o que se consulta todo dia: a
 * configuração muda raramente, a resposta muda a cada baixa.
 */
@ApiTags('Financeiro — Alertas de Caixa')
@ApiBearerAuth()
@Controller('cash-flow/alerts')
export class CashAlertsController {
  constructor(private readonly alerts: CashAlertsService) {}

  @Get('evaluation')
  @RequirePermissions(PERMISSIONS.CASH_ALERTS_READ, PERMISSIONS.CASH_FLOW_READ)
  @ApiOperation({ summary: 'Avaliar os alertas ativos contra o caixa projetado (RF-105)' })
  evaluateAll(@ActiveCompanyId() companyId: string) {
    return this.alerts.evaluateAll(companyId);
  }

  @Get(':id/evaluation')
  @RequirePermissions(PERMISSIONS.CASH_ALERTS_READ, PERMISSIONS.CASH_FLOW_READ)
  @ApiOperation({ summary: 'Avaliar um alerta específico, ativo ou não (RF-105)' })
  evaluate(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.evaluate(companyId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CASH_ALERTS_CREATE)
  @ApiOperation({ summary: 'Configurar alerta de insuficiência de caixa (RF-105)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Body() dto: CreateCashAlertDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.alerts.create(companyId, dto, user.id);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CASH_ALERTS_READ)
  @ApiOperation({ summary: 'Consultar alertas configurados' })
  findAll(@ActiveCompanyId() companyId: string) {
    return this.alerts.findAll(companyId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CASH_ALERTS_READ)
  @ApiOperation({ summary: 'Detalhar alerta' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CASH_ALERTS_UPDATE)
  @ApiOperation({ summary: 'Editar saldo mínimo, horizonte ou conta do alerta' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCashAlertDto,
  ) {
    return this.alerts.update(companyId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.CASH_ALERTS_DELETE)
  @ApiOperation({ summary: 'Desativar alerta — a configuração permanece' })
  remove(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.alerts.deactivate(companyId, id);
  }
}
