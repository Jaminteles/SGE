import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  AutoClassifyResult,
  DocumentTaxSummary,
  FiscalAssessmentReport,
  FiscalDirection,
  FiscalEvent,
  FiscalEventInput,
  FiscalEventSettlement,
  FiscalEventStatus,
  FiscalEventType,
  FiscalLedgerReport,
  PaginatedResult,
  TaxClassification,
  TaxClassificationInput,
  TaxClassificationType,
  TaxClassificationUpdate,
  TaxParameter,
  TaxParameterInput,
  TaxParameterUpdate,
  TaxRegime,
  TaxRule,
  TaxRuleInput,
  TaxRuleResolution,
  TaxRuleResolveQuery,
  TaxRuleUpdate,
  TaxOperationType,
} from './types';

/** Filtros do parâmetro fiscal (`QueryTaxParameterDto`). */
export interface TaxParameterQuery extends ListQuery {
  branchId?: string;
  taxRegime?: TaxRegime;
  /** Só o parâmetro vigente nesta data (`YYYY-MM-DD`). */
  onDate?: string;
}

/** Filtros da classificação fiscal (`QueryTaxClassificationDto`). */
export interface TaxClassificationQuery extends ListQuery {
  type?: TaxClassificationType;
}

/** Filtros da regra fiscal (`QueryTaxRuleDto`). */
export interface TaxRuleQuery extends ListQuery {
  operationType?: TaxOperationType;
  productId?: string;
  classificationId?: string;
}

/** Filtros dos eventos fiscais (`QueryFiscalEventDto`). */
export interface FiscalEventQuery extends ListQuery {
  documentId?: string;
  type?: FiscalEventType;
  status?: FiscalEventStatus;
}

/** Recorte dos relatórios fiscais (`QueryFiscalReportDto`). */
export interface FiscalReportQuery {
  from: string;
  to: string;
  branchId?: string;
  direction?: FiscalDirection;
}

export interface FiscalLedgerQuery extends FiscalReportQuery {
  cfop?: string;
  ncm?: string;
}

/**
 * Tributação e obrigações fiscais (RF-088 a RF-094 — UI-061 a UI-064).
 *
 * Duas coisas que a interface não pode oferecer, porque o backend não aceita:
 * **nada do que o emitente declarou é reescrito** (a única coluna que a tela
 * grava na nota é a classificação do item), e **protocolo e situação do evento
 * vêm do fisco** — o registro nasce REGISTRADO e só a baixa manual ou a
 * transmissão mudam isso.
 *
 * A autorização real é do backend (`PermissionsGuard` + RLS) a cada
 * requisição; as checagens de permissão nas telas só evitam oferecer 403.
 */
@Injectable({ providedIn: 'root' })
export class FiscalApiService {
  private readonly http = inject(HttpClient);

  // --- Parâmetros fiscais (RF-088) -----------------------------------------

  listParameters(query: TaxParameterQuery = {}): Observable<PaginatedResult<TaxParameter>> {
    return this.http.get<PaginatedResult<TaxParameter>>('fiscal/parameters', {
      params: toHttpParams(query),
    });
  }

  /**
   * Parâmetro vigente na data (RF-088). Devolve um só, ou nenhum: é a garantia
   * que a vigência sem sobreposição existe para dar.
   */
  currentParameter(query: { branchId?: string; onDate?: string } = {}): Observable<TaxParameter> {
    return this.http.get<TaxParameter>('fiscal/parameters/current', {
      params: toHttpParams(query),
    });
  }

  createParameter(body: TaxParameterInput): Observable<TaxParameter> {
    return this.http.post<TaxParameter>('fiscal/parameters', body);
  }

  updateParameter(id: string, body: TaxParameterUpdate): Observable<TaxParameter> {
    return this.http.patch<TaxParameter>(`fiscal/parameters/${id}`, body);
  }

  /** Encerra a vigência hoje; o histórico permanece e a linha volta fechada. */
  closeParameter(id: string): Observable<TaxParameter> {
    return this.http.delete<TaxParameter>(`fiscal/parameters/${id}`);
  }

  // --- Classificações fiscais (RF-089) -------------------------------------

  listClassifications(
    query: TaxClassificationQuery = {},
  ): Observable<PaginatedResult<TaxClassification>> {
    return this.http.get<PaginatedResult<TaxClassification>>('fiscal/classifications', {
      params: toHttpParams(query),
    });
  }

  createClassification(body: TaxClassificationInput): Observable<TaxClassification> {
    return this.http.post<TaxClassification>('fiscal/classifications', body);
  }

  /** Tipo e código não entram: são a identidade da linha e já podem estar em notas. */
  updateClassification(
    id: string,
    body: TaxClassificationUpdate,
  ): Observable<TaxClassification> {
    return this.http.patch<TaxClassification>(`fiscal/classifications/${id}`, body);
  }

  deleteClassification(id: string): Observable<void> {
    return this.http.delete<void>(`fiscal/classifications/${id}`);
  }

  // --- Regras fiscais (RF-091) ---------------------------------------------

  listRules(query: TaxRuleQuery = {}): Observable<PaginatedResult<TaxRule>> {
    return this.http.get<PaginatedResult<TaxRule>>('fiscal/rules', { params: toHttpParams(query) });
  }

  createRule(body: TaxRuleInput): Observable<TaxRule> {
    return this.http.post<TaxRule>('fiscal/rules', body);
  }

  updateRule(id: string, body: TaxRuleUpdate): Observable<TaxRule> {
    return this.http.patch<TaxRule>(`fiscal/rules/${id}`, body);
  }

  deleteRule(id: string): Observable<void> {
    return this.http.delete<void>(`fiscal/rules/${id}`);
  }

  /** Simulação: que regra decidiria esta operação. Nenhuma nota é alterada. */
  resolveRule(query: TaxRuleResolveQuery): Observable<TaxRuleResolution> {
    return this.http.get<TaxRuleResolution>('fiscal/rules/resolve', {
      params: toHttpParams({ ...query }),
    });
  }

  // --- Tributação do documento (RF-090) ------------------------------------

  documentTaxes(documentId: string): Observable<DocumentTaxSummary> {
    return this.http.get<DocumentTaxSummary>(`fiscal/documents/${documentId}/taxes`);
  }

  /** Liga a linha da nota à classificação de NCM; `null` desfaz o vínculo. */
  classifyItem(
    documentId: string,
    sequence: number,
    classificationId: string | null,
  ): Observable<DocumentTaxSummary> {
    return this.http.patch<DocumentTaxSummary>(`fiscal/documents/${documentId}/taxes/classify`, {
      sequence,
      classificationId,
    });
  }

  autoClassify(documentId: string): Observable<AutoClassifyResult> {
    return this.http.post<AutoClassifyResult>(
      `fiscal/documents/${documentId}/taxes/auto-classify`,
      {},
    );
  }

  // --- Eventos fiscais (RF-092/RF-094) -------------------------------------

  listEvents(query: FiscalEventQuery = {}): Observable<PaginatedResult<FiscalEvent>> {
    return this.http.get<PaginatedResult<FiscalEvent>>('fiscal/events', {
      params: toHttpParams(query),
    });
  }

  getEvent(id: string): Observable<FiscalEvent> {
    return this.http.get<FiscalEvent>(`fiscal/events/${id}`);
  }

  createEvent(body: FiscalEventInput): Observable<FiscalEvent> {
    return this.http.post<FiscalEvent>('fiscal/events', body);
  }

  /** Enfileira a transmissão ao provedor — exige `fiscal-events:APPROVE`. */
  transmitEvent(id: string): Observable<FiscalEvent> {
    return this.http.post<FiscalEvent>(`fiscal/events/${id}/transmit`, {});
  }

  /** Retorno do fisco lançado a mão, para quem transmite por fora. */
  settleEvent(id: string, body: FiscalEventSettlement): Observable<FiscalEvent> {
    return this.http.patch<FiscalEvent>(`fiscal/events/${id}/settle`, body);
  }

  // --- Relatórios (RF-093) -------------------------------------------------

  assessment(query: FiscalReportQuery): Observable<FiscalAssessmentReport> {
    return this.http.get<FiscalAssessmentReport>('fiscal/reports/assessment', {
      params: toHttpParams({ ...query }),
    });
  }

  ledger(query: FiscalLedgerQuery): Observable<FiscalLedgerReport> {
    return this.http.get<FiscalLedgerReport>('fiscal/reports/ledger', {
      params: toHttpParams({ ...query }),
    });
  }
}
