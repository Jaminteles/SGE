import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PartnerHistoryService } from './partner-history.service';
import { QueryPartnerHistoryDto } from './dto/query-partner-history.dto';

@ApiTags('Parceiros — Histórico')
@ApiBearerAuth()
@Controller('partners/:partnerId/history')
export class PartnerHistoryController {
  constructor(private readonly history: PartnerHistoryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PARTNER_HISTORY_READ)
  @ApiOperation({
    summary: 'Consultar o histórico comercial e financeiro do parceiro (RF-025)',
    description:
      'Consolida títulos (M08) e pedidos de compra (M06) do parceiro. As alterações do ' +
      'cadastro ficam na trilha de auditoria: GET /audit/entities/parceiro/:id.',
  })
  summary(
    @ActiveCompanyId() companyId: string,
    @Param('partnerId') partnerId: string,
    @Query() query: QueryPartnerHistoryDto,
  ) {
    return this.history.summary(companyId, partnerId, query);
  }
}
