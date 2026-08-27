import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '../../common/authorization/permission-catalog';
import { ActiveCompanyId } from '../../common/decorators/active-company.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateJournalEntryDto,
  QueryJournalEntryDto,
  ReverseJournalEntryDto,
} from './dto/journal-entry.dto';
import { JournalEntriesService } from './journal-entries.service';
import { JournalPostingsService } from './journal-postings.service';

/**
 * Lançamentos contábeis (RF-081/RF-082).
 *
 * Não existe rota de alteração nem de exclusão, e a ausência é a regra: o
 * lançamento é imutável (bd/17 §5) e a correção é o estorno, que deixa as duas
 * versões visíveis no razão. Uma rota de PATCH aqui seria a forma de apagar a
 * história sem apagar a linha.
 *
 * `journal-entries:CREATE` lança e contabiliza; `:DELETE` estorna. São
 * permissões diferentes porque estornar desfaz o efeito de um lançamento já
 * refletido em balancete e DRE — inclusive de meses já entregues, quando o
 * período é reaberto.
 */
@ApiTags('Contabilidade')
@ApiBearerAuth()
@Controller('journal-entries')
export class JournalEntriesController {
  constructor(
    private readonly entries: JournalEntriesService,
    private readonly postings: JournalPostingsService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  @ApiOperation({ summary: 'Registrar lançamento manual de débito e crédito (RF-081)' })
  create(
    @ActiveCompanyId() companyId: string,
    @Body() dto: CreateJournalEntryDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.entries.create(companyId, dto, userId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.JOURNAL_ENTRIES_READ)
  @ApiOperation({ summary: 'Consultar o diário, com filtro por conta e origem (RF-082)' })
  findAll(@ActiveCompanyId() companyId: string, @Query() query: QueryJournalEntryDto) {
    return this.entries.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.JOURNAL_ENTRIES_READ)
  @ApiOperation({ summary: 'Lançamento com as partidas, origem e documento (RF-082)' })
  findOne(@ActiveCompanyId() companyId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.entries.findOne(companyId, id);
  }

  @Post(':id/reverse')
  @RequirePermissions(PERMISSIONS.JOURNAL_ENTRIES_DELETE)
  @ApiOperation({ summary: 'Estornar o lançamento, com as partidas invertidas (RF-082)' })
  reverse(
    @ActiveCompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseJournalEntryDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.entries.reverse(companyId, id, dto, userId);
  }

  @Post('settlements/:settlementId')
  @RequirePermissions(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  @ApiOperation({
    summary: 'Contabilizar a baixa de um título (RF-080/RF-081)',
    description:
      'Idempotente: chamar de novo devolve o lançamento que já existe, nunca um segundo.',
  })
  postSettlement(
    @ActiveCompanyId() companyId: string,
    @Param('settlementId', ParseUUIDPipe) settlementId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.postings.postSettlement(companyId, settlementId, userId);
  }

  @Post('settlements/:settlementId/reverse')
  @RequirePermissions(PERMISSIONS.JOURNAL_ENTRIES_DELETE)
  @ApiOperation({ summary: 'Estornar o lançamento gerado por uma baixa (RF-082)' })
  reverseSettlement(
    @ActiveCompanyId() companyId: string,
    @Param('settlementId', ParseUUIDPipe) settlementId: string,
    @Body() dto: ReverseJournalEntryDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.postings.reverseSettlementPosting(companyId, settlementId, dto.reason, userId);
  }
}
