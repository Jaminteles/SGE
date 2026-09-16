import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { nomeDoAnexo } from './accounting-api.service';
import { toHttpParams } from './params';
import type {
  AccountingStatementReport,
  CashFlowDashboard,
  FinancialDashboard,
  FiscalStatementReport,
  PortfolioDashboard,
  PurchasingDashboard,
  ReportExportFile,
  ReportExportInput,
  ReportFilter,
  WorkforceDashboard,
} from './types';

/** O filtro do M15 vira query string sem campo vazio (`ReportFilterDto`). */
function comoConsulta(filtro: ReportFilter): Record<string, string | undefined> {
  return {
    from: filtro.from,
    to: filtro.to,
    branchId: filtro.branchId || undefined,
    categoryId: filtro.categoryId || undefined,
    costCenterId: filtro.costCenterId || undefined,
    bankAccountId: filtro.bankAccountId || undefined,
    partnerId: filtro.partnerId || undefined,
  };
}

/**
 * Painéis e relatórios do M15 (RF-106 a RF-113 — UI-068 a UI-073).
 *
 * O período é obrigatório em toda chamada: o backend não assume padrão, e a
 * tela também não deve — um indicador que muda sozinho de um dia para o outro é
 * exatamente o número que alguém copia para uma ata.
 *
 * A empresa nunca vai no filtro: ela vem do cabeçalho `x-company-id` e é
 * validada pelo guard + RLS. O M15 é porta de leitura, não contorno: o
 * relatório contábil continua exigindo a permissão da contabilidade, e o fiscal
 * a do fiscal.
 */
@Injectable({ providedIn: 'root' })
export class ReportingApiService {
  private readonly http = inject(HttpClient);

  // --- Painéis (RF-106 a RF-110) -------------------------------------------

  financial(filtro: ReportFilter): Observable<FinancialDashboard> {
    return this.http.get<FinancialDashboard>('reports/dashboard/financial', {
      params: toHttpParams(comoConsulta(filtro)),
    });
  }

  portfolio(filtro: ReportFilter): Observable<PortfolioDashboard> {
    return this.http.get<PortfolioDashboard>('reports/dashboard/portfolio', {
      params: toHttpParams(comoConsulta(filtro)),
    });
  }

  cashFlow(filtro: ReportFilter): Observable<CashFlowDashboard> {
    return this.http.get<CashFlowDashboard>('reports/dashboard/cash-flow', {
      params: toHttpParams(comoConsulta(filtro)),
    });
  }

  purchasing(filtro: ReportFilter): Observable<PurchasingDashboard> {
    return this.http.get<PurchasingDashboard>('reports/dashboard/purchasing', {
      params: toHttpParams(comoConsulta(filtro)),
    });
  }

  workforce(filtro: ReportFilter): Observable<WorkforceDashboard> {
    return this.http.get<WorkforceDashboard>('reports/dashboard/workforce', {
      params: toHttpParams(comoConsulta(filtro)),
    });
  }

  // --- Relatórios contábeis e fiscais (RF-111) -----------------------------

  /** Exige `reports:READ` **e** `accounting-reports:READ`. */
  accounting(filtro: ReportFilter): Observable<AccountingStatementReport> {
    return this.http.get<AccountingStatementReport>('reports/accounting', {
      params: toHttpParams(comoConsulta(filtro)),
    });
  }

  /** Exige `reports:READ` **e** `fiscal-reports:READ`. */
  fiscal(filtro: ReportFilter): Observable<FiscalStatementReport> {
    return this.http.get<FiscalStatementReport>('reports/fiscal', {
      params: toHttpParams(comoConsulta(filtro)),
    });
  }

  // --- Exportação (RF-113) --------------------------------------------------

  /**
   * Gera o arquivo — exige `reports:EXPORT`.
   *
   * Volta como `Blob`: a rota exige token e empresa, então não há `<a href>`
   * direto. O nome vem do `Content-Disposition`, gerado no servidor.
   */
  export(body: ReportExportInput): Observable<ReportExportFile> {
    return this.http
      .post('reports/export', body, { observe: 'response', responseType: 'blob' })
      .pipe(
        map((resposta) => ({
          content: resposta.body ?? new Blob([]),
          filename:
            nomeDoAnexo(resposta.headers.get('Content-Disposition')) ??
            `${body.report}_${body.from}_${body.to}.${body.format}`,
        })),
      );
  }
}
