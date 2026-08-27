import { Module } from '@nestjs/common';

import { AccountClassificationsService } from './account-classifications.service';
import { AccountingController } from './accounting.controller';
import { AccountingExportService } from './accounting-export.service';
import { AccountingPeriodsService } from './accounting-periods.service';
import { AccountingReportsService } from './accounting-reports.service';
import { JournalEntriesController } from './journal-entries.controller';
import { JournalEntriesService } from './journal-entries.service';
import { JournalPostingsService } from './journal-postings.service';
import { LedgerAccountsController } from './ledger-accounts.controller';
import { LedgerAccountsService } from './ledger-accounts.service';
import { ParseClassifiableSourcePipe } from './parse-classifiable-source.pipe';

/**
 * M11 — Contabilidade (RF-078 a RF-087).
 *
 * Mantém o plano de contas (RF-078/RF-079), classifica as origens financeiras
 * (RF-080), registra lançamentos de débito e crédito com origem, histórico e
 * documento (RF-081/RF-082), apura razão, balancete e DRE (RF-083 a RF-085),
 * controla o fechamento de períodos (RF-086) e exporta para o sistema contábil
 * (RF-087).
 *
 * Não importa `FinanceModule` nem `BankingModule`, e isso é deliberado: este
 * módulo **lê** `titulo_baixa`, `conta_bancaria` e `categoria_financeira` para
 * contabilizar, e escreve apenas nas próprias tabelas — mais a coluna
 * `conta_contabil_id` das origens classificáveis, que existe desde bd/03 e é
 * assunto exclusivo do M11. Depender daqueles serviços criaria um caminho pelo
 * qual a contabilidade alteraria o financeiro; a direção correta é a inversa, e
 * a única — o razão reflete o que o caixa fez, nunca o contrário.
 *
 * A auditoria vem do módulo global `AuditModule`.
 */
@Module({
  controllers: [LedgerAccountsController, JournalEntriesController, AccountingController],
  providers: [
    LedgerAccountsService,
    AccountingPeriodsService,
    JournalEntriesService,
    JournalPostingsService,
    AccountClassificationsService,
    AccountingReportsService,
    AccountingExportService,
    ParseClassifiableSourcePipe,
  ],
  exports: [JournalPostingsService, AccountingPeriodsService],
})
export class AccountingModule {}
