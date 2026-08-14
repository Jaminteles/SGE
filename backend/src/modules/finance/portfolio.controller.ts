import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { InstallmentsService } from './installments.service';
import { DelinquencyService } from './delinquency.service';
import { QueryPortfolioDto } from './dto/query-portfolio.dto';

/**
 * Posição da carteira e inadimplência (RF-055/RF-058).
 *
 * Somente leitura: são agregações da carteira no instante da consulta. A
 * inadimplência fica num recurso de permissão próprio porque expõe quem deve,
 * há quanto tempo e quanto — leitura de cobrança, não de lançamento.
 */
@ApiTags('Financeiro — Carteira')
@ApiBearerAuth()
@Controller()
export class PortfolioController {
  constructor(
    private readonly installments: InstallmentsService,
    private readonly delinquency: DelinquencyService,
  ) {}

  @Get('installments')
  @RequirePermissions(PERMISSIONS.FINANCIAL_ENTRIES_READ)
  @ApiOperation({ summary: 'Parcelas em aberto com atraso e encargos (RF-055)' })
  portfolio(@ActiveCompanyId() companyId: string, @Query() query: QueryPortfolioDto) {
    return this.installments.portfolio(companyId, query);
  }

  @Get('delinquency')
  @RequirePermissions(PERMISSIONS.DELINQUENCY_READ)
  @ApiOperation({ summary: 'Inadimplência por faixa de atraso e por parceiro (RF-058)' })
  summary(@ActiveCompanyId() companyId: string, @Query() query: QueryPortfolioDto) {
    return this.delinquency.summary(companyId, query);
  }
}
