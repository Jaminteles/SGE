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
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/authorization/authenticated-user';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { ScenariosService } from './scenarios.service';
import { CreateScenarioDto } from './dto/create-scenario.dto';
import { UpdateScenarioDto } from './dto/update-scenario.dto';
import { CreateProjectionDto } from './dto/create-projection.dto';

/** Cenários e projeções manuais de fluxo de caixa (RF-104). */
@ApiTags('Financeiro — Cenários de Fluxo de Caixa')
@ApiBearerAuth()
@Controller('cash-flow/scenarios')
export class ScenariosController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.CASH_FLOW_SCENARIOS_CREATE)
  @ApiOperation({ summary: 'Criar cenário de fluxo de caixa (RF-104)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Body() dto: CreateScenarioDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scenarios.create(companyId, dto, user.id);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CASH_FLOW_SCENARIOS_READ)
  @ApiOperation({ summary: 'Consultar cenários' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.scenarios.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CASH_FLOW_SCENARIOS_READ)
  @ApiOperation({ summary: 'Detalhar cenário' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.scenarios.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CASH_FLOW_SCENARIOS_UPDATE)
  @ApiOperation({ summary: 'Editar cenário, janela e premissas' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScenarioDto,
  ) {
    return this.scenarios.update(companyId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.CASH_FLOW_SCENARIOS_DELETE)
  @ApiOperation({ summary: 'Remover cenário e suas projeções manuais' })
  remove(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.scenarios.remove(companyId, id);
  }

  @Get(':id/projections')
  @RequirePermissions(PERMISSIONS.CASH_FLOW_SCENARIOS_READ)
  @ApiOperation({ summary: 'Consultar as projeções manuais do cenário (RF-104)' })
  listProjections(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.scenarios.listProjections(companyId, id);
  }

  @Post(':id/projections')
  @RequirePermissions(PERMISSIONS.CASH_FLOW_SCENARIOS_CREATE)
  @ApiOperation({ summary: 'Lançar movimento previsto no cenário (RF-104)' })
  addProjection(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProjectionDto,
  ) {
    return this.scenarios.addProjection(companyId, id, dto);
  }

  @Delete(':id/projections/:projectionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.CASH_FLOW_SCENARIOS_DELETE)
  @ApiOperation({ summary: 'Remover movimento previsto do cenário' })
  removeProjection(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('projectionId', ParseUUIDPipe) projectionId: string,
  ) {
    return this.scenarios.removeProjection(companyId, id, projectionId);
  }
}
