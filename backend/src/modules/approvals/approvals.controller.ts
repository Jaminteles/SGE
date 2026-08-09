import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ApprovalThresholdsService } from './approval-thresholds.service';
import { CreateApprovalThresholdDto } from './dto/create-approval-threshold.dto';
import { UpdateApprovalThresholdDto } from './dto/update-approval-threshold.dto';

@ApiTags('Alçadas de Aprovação')
@ApiBearerAuth()
@Controller('approval-thresholds')
export class ApprovalsController {
  constructor(private readonly thresholds: ApprovalThresholdsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.APPROVAL_THRESHOLDS_CREATE)
  @ApiOperation({ summary: 'Definir alçada de aprovação (RF-012)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateApprovalThresholdDto) {
    return this.thresholds.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.APPROVAL_THRESHOLDS_READ)
  @ApiOperation({ summary: 'Listar alçadas (paginado)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.thresholds.findAll(companyId, query);
  }

  @Get('evaluate')
  @RequirePermissions(PERMISSIONS.APPROVAL_THRESHOLDS_READ)
  @ApiOperation({ summary: 'Avaliar se uma operação exige aprovação (RF-012)' })
  @ApiQuery({ name: 'operation', required: true })
  @ApiQuery({ name: 'amount', required: true, example: '1500.00' })
  evaluate(
    @ActiveCompanyId() companyId: string,
    @Query('operation') operation: string,
    @Query('amount') amount: string,
  ) {
    return this.thresholds.evaluate(companyId, operation, amount);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.APPROVAL_THRESHOLDS_READ)
  @ApiOperation({ summary: 'Detalhar alçada' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.thresholds.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.APPROVAL_THRESHOLDS_UPDATE)
  @ApiOperation({ summary: 'Editar alçada (RF-012)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateApprovalThresholdDto,
  ) {
    return this.thresholds.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.APPROVAL_THRESHOLDS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover alçada (RF-012)' })
  remove(@ActiveCompanyId() companyId: string, @Param('id') id: string) {
    return this.thresholds.remove(companyId, id);
  }
}
