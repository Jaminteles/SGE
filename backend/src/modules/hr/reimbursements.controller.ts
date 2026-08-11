import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ReimbursementsService } from './reimbursements.service';
import { CreateReimbursementDto } from './dto/create-reimbursement.dto';
import { QueryReimbursementDto } from './dto/query-reimbursement.dto';
import { ApproveReimbursementDto, RejectReimbursementDto } from './dto/review-reimbursement.dto';

@ApiTags('RH — Reembolsos')
@ApiBearerAuth()
@Controller('reimbursements')
export class ReimbursementsController {
  constructor(private readonly reimbursements: ReimbursementsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.REIMBURSEMENTS_CREATE)
  @ApiOperation({ summary: 'Solicitar reembolso com as despesas (RF-018)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateReimbursementDto) {
    return this.reimbursements.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.REIMBURSEMENTS_READ)
  @ApiOperation({ summary: 'Listar reembolsos (paginado, com filtros)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryReimbursementDto) {
    return this.reimbursements.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.REIMBURSEMENTS_READ)
  @ApiOperation({ summary: 'Detalhar reembolso com despesas e comprovantes' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.reimbursements.findOne(companyId, id);
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.REIMBURSEMENTS_UPDATE)
  @ApiOperation({ summary: 'Enviar para análise (exige comprovante em cada despesa)' })
  submit(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.reimbursements.submit(companyId, id);
  }

  @Post(':id/review')
  @RequirePermissions(PERMISSIONS.REIMBURSEMENTS_APPROVE)
  @ApiOperation({ summary: 'Colocar em análise' })
  startReview(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.reimbursements.startReview(companyId, id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.REIMBURSEMENTS_APPROVE)
  @ApiOperation({ summary: 'Aprovar reembolso, respeitando a alçada (RF-018/RN-003)' })
  approve(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: ApproveReimbursementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reimbursements.approve(companyId, id, dto, user);
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.REIMBURSEMENTS_APPROVE)
  @ApiOperation({ summary: 'Reprovar reembolso com motivo' })
  reject(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: RejectReimbursementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reimbursements.reject(companyId, id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.REIMBURSEMENTS_DELETE)
  @ApiOperation({ summary: 'Cancelar reembolso (o registro é preservado — RN-009)' })
  @ApiQuery({ name: 'reason', required: false, description: 'Motivo do cancelamento' })
  cancel(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    return this.reimbursements.cancel(companyId, id, reason);
  }
}
