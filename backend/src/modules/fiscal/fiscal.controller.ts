import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DocumentTaxesService } from './document-taxes.service';
import { ClassifyDocumentItemDto } from './dto/document-tax.dto';
import {
  CreateFiscalEventDto,
  QueryFiscalEventDto,
  SettleFiscalEventDto,
} from './dto/fiscal-event.dto';
import { QueryFiscalLedgerDto, QueryFiscalReportDto } from './dto/fiscal-report.dto';
import { FiscalEventsService } from './fiscal-events.service';
import { FiscalReportsService } from './fiscal-reports.service';
import { FiscalTransmissionService } from './fiscal-transmission.service';

/**
 * Tributação dos documentos, eventos fiscais e relatórios (RF-090, RF-092 a RF-094).
 *
 * Três recursos com consequências diferentes, e permissões separadas por isso:
 *
 *  - ler a tributação da nota (`document-taxes:READ`) é consulta; classificar a
 *    linha (`document-taxes:UPDATE`) escreve — mas só o vínculo com o NCM
 *    cadastrado, nunca o que o emitente declarou;
 *  - o evento fiscal não tem alteração nem remoção: `:CREATE` registra, `:READ`
 *    consulta e `:APPROVE` transmite, que é a única ação que fala com o fisco;
 *  - o relatório separa ler de exportar, porque exportar tira o movimento fiscal
 *    de dentro do sistema.
 */
@ApiTags('Fiscal')
@ApiBearerAuth()
@Controller('fiscal')
export class FiscalController {
  constructor(
    private readonly taxes: DocumentTaxesService,
    private readonly events: FiscalEventsService,
    private readonly transmission: FiscalTransmissionService,
    private readonly reports: FiscalReportsService,
  ) {}

  // --- RF-090: tributação do documento -------------------------------------

  @Get('documents/:documentId/taxes')
  @RequirePermissions(PERMISSIONS.DOCUMENT_TAXES_READ)
  @ApiOperation({
    summary: 'Tributação declarada da nota, com divergências apontadas (RF-090)',
  })
  documentTaxes(
    @ActiveCompanyId() companyId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.taxes.summary(companyId, documentId);
  }

  @Patch('documents/:documentId/taxes/classify')
  @RequirePermissions(PERMISSIONS.DOCUMENT_TAXES_UPDATE)
  @ApiOperation({ summary: 'Ligar uma linha da nota à classificação de NCM (RF-090)' })
  classifyItem(
    @ActiveCompanyId() companyId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ClassifyDocumentItemDto,
  ) {
    return this.taxes.classify(companyId, documentId, dto);
  }

  @Post('documents/:documentId/taxes/auto-classify')
  @RequirePermissions(PERMISSIONS.DOCUMENT_TAXES_UPDATE)
  @ApiOperation({
    summary: 'Classificar as linhas cujo NCM já existe no cadastro (RF-090)',
  })
  autoClassify(
    @ActiveCompanyId() companyId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.taxes.autoClassify(companyId, documentId);
  }

  // --- RF-092/RF-094: eventos fiscais --------------------------------------

  @Post('events')
  @RequirePermissions(PERMISSIONS.FISCAL_EVENTS_CREATE)
  @ApiOperation({ summary: 'Registrar evento fiscal do documento (RF-092)' })
  createEvent(@ActiveCompanyId() companyId: string, @Body() dto: CreateFiscalEventDto) {
    return this.events.create(companyId, dto);
  }

  @Get('events')
  @RequirePermissions(PERMISSIONS.FISCAL_EVENTS_READ)
  @ApiOperation({ summary: 'Listar eventos fiscais e seus protocolos (RF-092)' })
  findEvents(@ActiveCompanyId() companyId: string, @Query() query: QueryFiscalEventDto) {
    return this.events.findAll(companyId, query);
  }

  @Get('events/:id')
  @RequirePermissions(PERMISSIONS.FISCAL_EVENTS_READ)
  @ApiOperation({ summary: 'Consultar um evento fiscal (RF-092)' })
  findEvent(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.events.findOne(companyId, id);
  }

  @Post('events/:id/transmit')
  @RequirePermissions(PERMISSIONS.FISCAL_EVENTS_APPROVE)
  @ApiOperation({ summary: 'Enfileirar a transmissão do evento ao provedor (RF-094)' })
  transmitEvent(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.transmission.request(companyId, id);
  }

  @Patch('events/:id/settle')
  @RequirePermissions(PERMISSIONS.FISCAL_EVENTS_APPROVE)
  @ApiOperation({ summary: 'Lançar a resposta do fisco recebida por fora (RF-092)' })
  settleEvent(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SettleFiscalEventDto,
  ) {
    return this.events.settle(companyId, id, dto);
  }

  // --- RF-093: relatórios ---------------------------------------------------

  @Get('reports/assessment')
  @RequirePermissions(PERMISSIONS.FISCAL_REPORTS_READ)
  @ApiOperation({ summary: 'Apuração fiscal por competência e sentido (RF-093)' })
  assessment(@ActiveCompanyId() companyId: string, @Query() query: QueryFiscalReportDto) {
    return this.reports.assessment(companyId, query);
  }

  @Get('reports/ledger')
  @RequirePermissions(PERMISSIONS.FISCAL_REPORTS_READ)
  @ApiOperation({ summary: 'Livro de entradas e saídas por CFOP e NCM (RF-093)' })
  ledger(@ActiveCompanyId() companyId: string, @Query() query: QueryFiscalLedgerDto) {
    return this.reports.ledger(companyId, query);
  }
}
