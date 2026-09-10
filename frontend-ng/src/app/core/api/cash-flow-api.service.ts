import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  CashAlert,
  CashAlertEvaluation,
  CashAlertEvaluationSummary,
  CashAlertInput,
  CashFlowGranularity,
  CashFlowProjection,
  CashFlowSummary,
  CashProjection,
  CashProjectionInput,
  CashScenario,
  CashScenarioInput,
  PaginatedResult,
} from './types';

/** Recorte do fluxo (`QueryCashFlowDto`). Sem período, o servidor usa 90 dias. */
export interface CashFlowQuery extends ListQuery {
  from?: string;
  to?: string;
  branchId?: string;
  categoryId?: string;
  costCenterId?: string;
}

export interface CashFlowProjectionQuery extends CashFlowQuery {
  granularity?: CashFlowGranularity;
  scenarioId?: string;
}

/**
 * Fluxo de caixa, cenários, projeções e alertas (RF-101 a RF-105 — UI-029).
 *
 * O consolidado é leitura do servidor: o previsto, o realizado e o vencido
 * mudam a cada baixa, e somar no navegador daria um segundo número para a
 * mesma pergunta. Cenário não altera o financeiro — só a projeção lida sob ele.
 */
@Injectable({ providedIn: 'root' })
export class CashFlowApiService {
  private readonly http = inject(HttpClient);

  summary(query: CashFlowQuery = {}): Observable<CashFlowSummary> {
    return this.http.get<CashFlowSummary>('cash-flow/summary', { params: toHttpParams(query) });
  }

  projection(query: CashFlowProjectionQuery = {}): Observable<CashFlowProjection> {
    return this.http.get<CashFlowProjection>('cash-flow/projection', {
      params: toHttpParams(query),
    });
  }

  balance(): Observable<{ balance: string }> {
    return this.http.get<{ balance: string }>('cash-flow/balance');
  }

  listScenarios(query: ListQuery = {}): Observable<PaginatedResult<CashScenario>> {
    return this.http.get<PaginatedResult<CashScenario>>('cash-flow/scenarios', {
      params: toHttpParams(query),
    });
  }

  createScenario(body: CashScenarioInput): Observable<CashScenario> {
    return this.http.post<CashScenario>('cash-flow/scenarios', body);
  }

  updateScenario(id: string, body: Partial<CashScenarioInput>): Observable<CashScenario> {
    return this.http.patch<CashScenario>(`cash-flow/scenarios/${id}`, body);
  }

  removeScenario(id: string): Observable<void> {
    return this.http.delete<void>(`cash-flow/scenarios/${id}`);
  }

  listProjections(scenarioId: string): Observable<CashProjection[]> {
    return this.http.get<CashProjection[]>(`cash-flow/scenarios/${scenarioId}/projections`);
  }

  createProjection(scenarioId: string, body: CashProjectionInput): Observable<CashProjection> {
    return this.http.post<CashProjection>(`cash-flow/scenarios/${scenarioId}/projections`, body);
  }

  removeProjection(scenarioId: string, projectionId: string): Observable<void> {
    return this.http.delete<void>(`cash-flow/scenarios/${scenarioId}/projections/${projectionId}`);
  }

  /** Lista curta e não paginada — alertas são configuração, não movimento. */
  listAlerts(): Observable<CashAlert[]> {
    return this.http.get<CashAlert[]>('cash-flow/alerts');
  }

  createAlert(body: CashAlertInput): Observable<CashAlert> {
    return this.http.post<CashAlert>('cash-flow/alerts', body);
  }

  updateAlert(id: string, body: Partial<CashAlertInput>): Observable<CashAlert> {
    return this.http.patch<CashAlert>(`cash-flow/alerts/${id}`, body);
  }

  removeAlert(id: string): Observable<void> {
    return this.http.delete<void>(`cash-flow/alerts/${id}`);
  }

  /** Caminha o saldo dia a dia e aponta o primeiro dia de ruptura (RF-105). */
  evaluateAlerts(): Observable<CashAlertEvaluationSummary> {
    return this.http.get<CashAlertEvaluationSummary>('cash-flow/alerts/evaluation');
  }

  evaluateAlert(id: string): Observable<CashAlertEvaluation> {
    return this.http.get<CashAlertEvaluation>(`cash-flow/alerts/${id}/evaluation`);
  }
}
