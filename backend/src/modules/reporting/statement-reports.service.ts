import { Injectable } from '@nestjs/common';
import { AccountingReportsService } from '../accounting/accounting-reports.service';
import { FiscalReportsService } from '../fiscal/fiscal-reports.service';
import { ReportFilterDto } from './dto/report-filter.dto';

/**
 * Relatórios contábeis e fiscais (RF-111).
 *
 * Nada é reimplementado aqui. O balancete, a DRE, a apuração e o livro fiscal
 * continuam sendo calculados pelo M11 e pelo M12 — este serviço só os pede e os
 * apresenta juntos, que é o que o gestor pediu: um documento, não quatro abas.
 *
 * Reimplementar as consultas daria ao M15 uma segunda definição de "resultado do
 * mês", e a primeira vez que uma delas mudasse o contador e o diretor passariam
 * a discutir qual dos dois relatórios está certo.
 *
 * A permissão do módulo de origem continua valendo e é exigida no controller —
 * o M15 é uma porta de leitura, não um contorno.
 */
@Injectable()
export class StatementReportsService {
  constructor(
    private readonly accounting: AccountingReportsService,
    private readonly fiscal: FiscalReportsService,
  ) {}

  /** Balancete e DRE do período (RF-111). */
  async accountingStatement(companyId: string, filter: ReportFilterDto) {
    const range = { from: filter.from, to: filter.to };
    const [trialBalance, incomeStatement] = await Promise.all([
      this.accounting.trialBalance(companyId, range),
      this.accounting.incomeStatement(companyId, range),
    ]);

    return { period: range, trialBalance, incomeStatement };
  }

  /** Apuração e livro fiscal do período (RF-111). */
  async fiscalStatement(companyId: string, filter: ReportFilterDto) {
    const range = { from: filter.from, to: filter.to, branchId: filter.branchId };
    const [assessment, ledger] = await Promise.all([
      this.fiscal.assessment(companyId, range),
      this.fiscal.ledger(companyId, range),
    ]);

    return { period: { from: filter.from, to: filter.to }, assessment, ledger };
  }
}
