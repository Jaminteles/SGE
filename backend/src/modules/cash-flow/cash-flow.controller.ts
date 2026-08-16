import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { CashFlowService } from './cash-flow.service';
import { QueryCashFlowDto } from './dto/query-cash-flow.dto';
import { QueryProjectionDto } from './dto/query-projection.dto';

/**
 * Fluxo de caixa consolidado e projetado (RF-101 a RF-103).
 *
 * Somente leitura: são agregações da carteira no instante da consulta. O
 * recurso de permissão é próprio porque ler o fluxo é ler a posição de caixa da
 * empresa inteira — mais do que consultar um título.
 */
@ApiTags('Financeiro — Fluxo de Caixa')
@ApiBearerAuth()
@Controller('cash-flow')
export class CashFlowController {
  constructor(private readonly cashFlow: CashFlowService) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.CASH_FLOW_READ)
  @ApiOperation({
    summary: 'Consolidar entradas e saídas por situação e categoria (RF-101/RF-103)',
  })
  summary(@ActiveCompanyId() companyId: string, @Query() query: QueryCashFlowDto) {
    return this.cashFlow.summary(companyId, query);
  }

  @Get('projection')
  @RequirePermissions(PERMISSIONS.CASH_FLOW_READ)
  @ApiOperation({
    summary: 'Projetar o fluxo por período, com saldo acumulado (RF-102/RF-104)',
  })
  projection(@ActiveCompanyId() companyId: string, @Query() query: QueryProjectionDto) {
    return this.cashFlow.projection(companyId, query);
  }

  @Get('balance')
  @RequirePermissions(PERMISSIONS.CASH_FLOW_READ)
  @ApiOperation({ summary: 'Saldo de caixa disponível hoje (RF-105)' })
  async balance(@ActiveCompanyId() companyId: string) {
    return { balance: await this.cashFlow.currentCashBalance(companyId) };
  }
}
