import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { BankTransactionIdentifierService } from './bank-transaction-identifier.service';
import { ReconciliationMatchingService } from './reconciliation-matching.service';
import { ReconciliationsService } from './reconciliations.service';
import { AutoReconciliationService } from './auto-reconciliation.service';
import { DivergencesService } from './divergences.service';
import {
  CreateReconciliationDto,
  IgnoreBankTransactionDto,
  QueryDivergenceDto,
  QueryPendingDto,
  QueryReconciliationDto,
  QuerySuggestionDto,
  RunAutoReconciliationDto,
  UndoReconciliationDto,
} from './dto/reconciliation.dto';

/**
 * Conciliação bancária (RF-072 a RF-077).
 *
 * As permissões são separadas por consequência, não por verbo HTTP: afirmar o
 * vínculo (`:CREATE`), desfazê-lo (`:DELETE` — é a operação que faz um título
 * voltar a parecer em aberto) e disparar a varredura automática (`:APPROVE` — a
 * única que cria centenas de vínculos numa chamada) são decisões diferentes.
 *
 * Toda rota é escopada pela empresa ativa do header, e o id vindo da URL é
 * sempre confrontado com ela na consulta — trocar o id na rota não alcança o
 * recurso de outra empresa, e a RLS ainda responderia vazio se alcançasse.
 */
@ApiTags('Bancos — Conciliação')
@ApiBearerAuth()
@Controller('reconciliation')
export class ReconciliationController {
  constructor(
    private readonly reconciliations: ReconciliationsService,
    private readonly matching: ReconciliationMatchingService,
    private readonly identifier: BankTransactionIdentifierService,
    private readonly auto: AutoReconciliationService,
    private readonly divergences: DivergencesService,
  ) {}

  @Get('pending')
  @RequirePermissions(PERMISSIONS.RECONCILIATION_READ)
  @ApiOperation({ summary: 'Movimentos bancários que ainda pedem decisão (RF-072)' })
  findPending(@ActiveCompanyId() companyId: string, @Query() query: QueryPendingDto) {
    return this.reconciliations.findPending(companyId, query);
  }

  @Post('bank-transactions/:id/identify')
  @RequirePermissions(PERMISSIONS.RECONCILIATION_CREATE)
  @ApiOperation({
    summary: 'Identificar natureza, contraparte e documento de um movimento (RF-072)',
  })
  identify(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.identifier.identify(companyId, id);
  }

  @Get('bank-transactions/:id/suggestions')
  @RequirePermissions(PERMISSIONS.RECONCILIATION_READ)
  @ApiOperation({ summary: 'Sugerir parcelas correspondentes, com score e motivos (RF-073)' })
  suggest(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QuerySuggestionDto,
  ) {
    return this.matching.suggest(companyId, id, query);
  }

  @Post('bank-transactions/:id/ignore')
  @RequirePermissions(PERMISSIONS.RECONCILIATION_CREATE)
  @ApiOperation({ summary: 'Marcar o movimento como sem par: tarifa, rendimento (RF-074)' })
  ignore(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IgnoreBankTransactionDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.reconciliations.ignore(companyId, id, dto, userId);
  }

  @Post('bank-transactions/:id/reopen')
  @RequirePermissions(PERMISSIONS.RECONCILIATION_CREATE)
  @ApiOperation({ summary: 'Devolver um movimento ignorado à fila de conciliação (RF-074)' })
  reopen(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.reconciliations.reopen(companyId, id, userId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.RECONCILIATION_CREATE)
  @ApiOperation({
    summary: 'Conciliar manualmente um movimento com título, baixa ou ordem (RF-074)',
  })
  create(
    @ActiveCompanyId() companyId: string,
    @Body() dto: CreateReconciliationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.reconciliations.create(companyId, dto, userId);
  }

  @Post('run')
  @RequirePermissions(PERMISSIONS.RECONCILIATION_APPROVE)
  @ApiOperation({ summary: 'Executar a conciliação automática por regras, em fila (RF-075)' })
  run(
    @ActiveCompanyId() companyId: string,
    @Body() dto: RunAutoReconciliationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.auto.enqueue(companyId, dto, userId);
  }

  @Get('divergences')
  @RequirePermissions(PERMISSIONS.RECONCILIATION_READ)
  @ApiOperation({ summary: 'Painel de divergências entre extrato e lançamentos (RF-076)' })
  findDivergences(@ActiveCompanyId() companyId: string, @Query() query: QueryDivergenceDto) {
    return this.divergences.find(companyId, query);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.RECONCILIATION_READ)
  @ApiOperation({ summary: 'Histórico de conciliações, inclusive as desfeitas (RF-077)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryReconciliationDto) {
    return this.reconciliations.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.RECONCILIATION_READ)
  @ApiOperation({ summary: 'Detalhar uma conciliação (RF-077)' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.reconciliations.findOne(companyId, id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.RECONCILIATION_DELETE)
  @ApiOperation({ summary: 'Desfazer uma conciliação, com motivo registrado (RF-074/RF-077)' })
  undo(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UndoReconciliationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.reconciliations.undo(companyId, id, dto, userId);
  }
}
