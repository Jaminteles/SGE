import { Module } from '@nestjs/common';

import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationRulesController } from './reconciliation-rules.controller';
import { ReconciliationsService } from './reconciliations.service';
import { ReconciliationRulesService } from './reconciliation-rules.service';
import { ReconciliationMatchingService } from './reconciliation-matching.service';
import { BankTransactionIdentifierService } from './bank-transaction-identifier.service';
import { AutoReconciliationService } from './auto-reconciliation.service';
import { DivergencesService } from './divergences.service';
import { ReconciliationJobsService } from './jobs/reconciliation-jobs.service';

/**
 * M10 — Conciliação Bancária (RF-071 a RF-077).
 *
 * Fecha o ciclo do dinheiro: M09 paga e importa o extrato, M08 lança o título e
 * a baixa, e este módulo afirma que a linha do extrato **é** aquele lançamento
 * — ou mostra que não é (RF-076).
 *
 * Não importa `FinanceModule` nem `BankingModule`, e isso é deliberado: a
 * conciliação lê parcela, baixa, ordem e movimento, e não escreve em nenhum
 * deles. O único campo que ela altera fora da própria tabela é o par
 * (`status_conciliacao`, `metadados`) do movimento bancário, que bd/13 §9 abriu
 * justamente para ela. Depender daqueles serviços seria criar um caminho pelo
 * qual conciliar acabasse liquidando — e aí o mesmo dinheiro teria duas portas
 * de entrada.
 *
 * A fila e a auditoria vêm dos módulos globais `QueueModule` e `AuditModule`.
 */
@Module({
  controllers: [ReconciliationController, ReconciliationRulesController],
  providers: [
    ReconciliationsService,
    ReconciliationRulesService,
    ReconciliationMatchingService,
    BankTransactionIdentifierService,
    AutoReconciliationService,
    DivergencesService,
    ReconciliationJobsService,
  ],
  exports: [ReconciliationMatchingService],
})
export class ReconciliationModule {}
