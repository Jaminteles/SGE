import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { toDateOnly } from '../../common/utils/date-only';
import {
  CreateTaxParameterDto,
  QueryCurrentTaxParameterDto,
  QueryTaxParameterDto,
  UpdateTaxParameterDto,
} from './dto/tax-parameter.dto';
import { TaxParametersService } from './tax-parameters.service';

/**
 * Parâmetros fiscais da empresa (RF-088).
 *
 * A escrita é separada da leitura porque trocar o regime tributário muda a
 * apuração inteira da empresa — quem consulta a apuração não precisa poder
 * reescrevê-la. `DELETE` encerra a vigência; não apaga, porque apagar reescreve
 * o passado de um mês já entregue ao contador.
 */
@ApiTags('Fiscal')
@ApiBearerAuth()
@Controller('fiscal/parameters')
export class TaxParametersController {
  constructor(private readonly parameters: TaxParametersService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.TAX_PARAMETERS_CREATE)
  @ApiOperation({ summary: 'Cadastrar parâmetro fiscal vigente (RF-088)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateTaxParameterDto) {
    return this.parameters.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.TAX_PARAMETERS_READ)
  @ApiOperation({ summary: 'Listar parâmetros fiscais, com filtro por vigência (RF-088)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryTaxParameterDto) {
    return this.parameters.findAll(companyId, query);
  }

  @Get('current')
  @RequirePermissions(PERMISSIONS.TAX_PARAMETERS_READ)
  @ApiOperation({
    summary: 'Parâmetro vigente numa data, preferindo o da filial (RF-088)',
  })
  current(@ActiveCompanyId() companyId: string, @Query() query: QueryCurrentTaxParameterDto) {
    return this.parameters.resolve(
      companyId,
      query.onDate ? toDateOnly(query.onDate) : new Date(),
      query.branchId,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TAX_PARAMETERS_READ)
  @ApiOperation({ summary: 'Consultar um parâmetro fiscal (RF-088)' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.parameters.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TAX_PARAMETERS_UPDATE)
  @ApiOperation({ summary: 'Alterar regime, alíquotas e vigência (RF-088)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaxParameterDto,
  ) {
    return this.parameters.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.TAX_PARAMETERS_DELETE)
  @ApiOperation({ summary: 'Encerrar a vigência do parâmetro; o histórico permanece (RF-088)' })
  close(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.parameters.close(companyId, id);
  }
}
