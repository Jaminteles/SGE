import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PayrollService } from './payroll.service';
import { QueryPayrollDto } from './dto/query-payroll.dto';

@ApiTags('RH — Folha e contabilidade')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ)
  @ApiOperation({
    summary: 'Consolidar verbas, bases e destino contábil por competência (RF-021)',
    description:
      'Somente leitura. Cada consulta é registrada na trilha de auditoria como EXPORTACAO.',
  })
  summary(@ActiveCompanyId() companyId: string, @Query() query: QueryPayrollDto) {
    return this.payroll.summary(companyId, query);
  }
}
