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
import { RecurrencesService } from './recurrences.service';
import { CreateRecurrenceDto } from './dto/create-recurrence.dto';
import { UpdateRecurrenceDto } from './dto/update-recurrence.dto';
import { GenerateRecurrenceDto } from './dto/generate-recurrence.dto';

/** Contratos que geram títulos periodicamente (RF-053). */
@ApiTags('Financeiro — Recorrências')
@ApiBearerAuth()
@Controller('recurrences')
export class RecurrencesController {
  constructor(private readonly recurrences: RecurrencesService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.RECURRENCES_CREATE)
  @ApiOperation({ summary: 'Cadastrar recorrência (RF-053)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateRecurrenceDto) {
    return this.recurrences.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.RECURRENCES_READ)
  @ApiOperation({ summary: 'Consultar recorrências' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: PaginationQueryDto) {
    return this.recurrences.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.RECURRENCES_READ)
  @ApiOperation({ summary: 'Detalhar recorrência' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.recurrences.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.RECURRENCES_UPDATE)
  @ApiOperation({ summary: 'Editar recorrência' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurrenceDto,
  ) {
    return this.recurrences.update(companyId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.RECURRENCES_DELETE)
  @ApiOperation({ summary: 'Encerrar recorrência — os títulos gerados permanecem' })
  remove(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.recurrences.deactivate(companyId, id);
  }

  @Post(':id/generate')
  @RequirePermissions(PERMISSIONS.RECURRENCES_UPDATE, PERMISSIONS.FINANCIAL_ENTRIES_CREATE)
  @ApiOperation({ summary: 'Gerar os títulos devidos até a data informada (RF-053)' })
  generate(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateRecurrenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recurrences.generate(companyId, id, dto, user.id);
  }
}
