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
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateTaxClassificationDto,
  QueryTaxClassificationDto,
  UpdateTaxClassificationDto,
} from './dto/tax-classification.dto';
import { TaxClassificationsService } from './tax-classifications.service';

/**
 * Classificações fiscais (RF-089).
 *
 * `DELETE` inativa, nunca apaga: a classificação pode já estar apontada por
 * itens de notas recebidas, e removê-la reescreveria a leitura de documentos
 * fechados.
 */
@ApiTags('Fiscal')
@ApiBearerAuth()
@Controller('fiscal/classifications')
export class TaxClassificationsController {
  constructor(private readonly classifications: TaxClassificationsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.TAX_CLASSIFICATIONS_CREATE)
  @ApiOperation({ summary: 'Cadastrar classificação fiscal (RF-089)' })
  create(@ActiveCompanyId() companyId: string, @Body() dto: CreateTaxClassificationDto) {
    return this.classifications.create(companyId, dto);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.TAX_CLASSIFICATIONS_READ)
  @ApiOperation({ summary: 'Listar classificações por tipo e código (RF-089)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryTaxClassificationDto) {
    return this.classifications.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TAX_CLASSIFICATIONS_READ)
  @ApiOperation({ summary: 'Consultar uma classificação fiscal (RF-089)' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.classifications.findOne(companyId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TAX_CLASSIFICATIONS_UPDATE)
  @ApiOperation({ summary: 'Alterar descrição e alíquotas da classificação (RF-089)' })
  update(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaxClassificationDto,
  ) {
    return this.classifications.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.TAX_CLASSIFICATIONS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Inativar a classificação; o histórico permanece (RF-089)' })
  deactivate(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.classifications.deactivate(companyId, id);
  }
}
