import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { EmployeeEventsService } from './employee-events.service';
import { CreateEmployeeEventDto } from './dto/create-employee-event.dto';

@ApiTags('RH — Histórico funcional')
@ApiBearerAuth()
@Controller('employees/:employeeId/events')
export class EmployeeEventsController {
  constructor(private readonly events: EmployeeEventsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.EMPLOYEE_EVENTS_CREATE)
  @ApiOperation({ summary: 'Registrar férias, afastamento, promoção ou retorno (RF-020)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Param('employeeId') employeeId: string,
    @Body() dto: CreateEmployeeEventDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.events.create(companyId, employeeId, dto, userId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.EMPLOYEE_EVENTS_READ)
  @ApiOperation({ summary: 'Consultar o histórico funcional (RF-015)' })
  findAll(
    @ActiveCompanyId() companyId: string,
    @Param('employeeId') employeeId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.events.findAll(companyId, employeeId, query);
  }
}
