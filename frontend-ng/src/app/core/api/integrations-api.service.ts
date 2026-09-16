import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  FailedJob,
  FailedWebhook,
  Integration,
  IntegrationEnvironment,
  IntegrationEvent,
  IntegrationEventSeverity,
  IntegrationHealth,
  IntegrationInput,
  IntegrationStatus,
  IntegrationUpdate,
  PaginatedResult,
  ReprocessResult,
  ReprocessTarget,
} from './types';

/** Filtros da lista de integrações (`QueryIntegrationDto`). */
export interface IntegrationQuery extends ListQuery {
  status?: IntegrationStatus;
  providerId?: string;
  environment?: IntegrationEnvironment;
}

/** Filtros do diário de integrações (`QueryIntegrationEventDto`). */
export interface IntegrationEventQuery extends ListQuery {
  integrationId?: string;
  severity?: IntegrationEventSeverity;
  type?: string;
  /** ISO 8601 — o backend recorta por `occurredAt`. */
  from?: string;
  to?: string;
}

/**
 * Integrações externas, fila de trabalho e reprocessamento (RF-126 a RF-130 —
 * UI-047, UI-074 e UI-075).
 *
 * Duas regras que a interface não pode contornar, porque o backend não aceita:
 *
 *  - **segredo não trafega**. `parameters` recusa chave com nome de credencial
 *    (senha, token, api_key…) na API e no banco; o segredo mora na credencial
 *    cifrada, cadastrada em `banking/credentials`, e nenhuma rota o devolve;
 *  - **reprocessar repete a tentativa, não o efeito**. Só job em FALHA/CANCELADO
 *    e webhook em FALHA são aceitos, e a chave `reprocesso:<alvo>:<id>` segura o
 *    duplo clique.
 */
@Injectable({ providedIn: 'root' })
export class IntegrationsApiService {
  private readonly http = inject(HttpClient);

  // --- Monitoramento (RF-128 a RF-130) -------------------------------------

  /** Saúde das integrações e contagem da fila — exige `integrations:READ`. */
  health(): Observable<IntegrationHealth> {
    return this.http.get<IntegrationHealth>('integrations/health');
  }

  /** Diário de chamadas, erros e webhooks — exige `integration-events:READ`. */
  events(query: IntegrationEventQuery = {}): Observable<PaginatedResult<IntegrationEvent>> {
    return this.http.get<PaginatedResult<IntegrationEvent>>('integrations/events', {
      params: toHttpParams(query),
    });
  }

  /** Jobs parados em falha — exige `integration-events:READ`. `q` busca pelo nome. */
  failedJobs(query: ListQuery = {}): Observable<PaginatedResult<FailedJob>> {
    return this.http.get<PaginatedResult<FailedJob>>('integrations/failed', {
      params: toHttpParams({ ...query, target: 'JOB' }),
    });
  }

  /** Webhooks parados em falha — exige `integration-events:READ`. */
  failedWebhooks(query: ListQuery = {}): Observable<PaginatedResult<FailedWebhook>> {
    return this.http.get<PaginatedResult<FailedWebhook>>('integrations/failed', {
      params: toHttpParams({ ...query, target: 'WEBHOOK' }),
    });
  }

  /** Reenfileira o que falhou — exige `integration-events:APPROVE`. */
  reprocess(target: ReprocessTarget, id: string, reason?: string): Observable<ReprocessResult> {
    return this.http.post<ReprocessResult>('integrations/reprocess', {
      target,
      id,
      ...(reason ? { reason } : {}),
    });
  }

  // --- Cadastro e configuração (RF-126/RF-127) ------------------------------

  list(query: IntegrationQuery = {}): Observable<PaginatedResult<Integration>> {
    return this.http.get<PaginatedResult<Integration>>('integrations', {
      params: toHttpParams(query),
    });
  }

  get(id: string): Observable<Integration> {
    return this.http.get<Integration>(`integrations/${id}`);
  }

  create(body: IntegrationInput): Observable<Integration> {
    return this.http.post<Integration>('integrations', body);
  }

  /** `code` e `providerId` não entram: são a referência estável do rastro. */
  update(id: string, body: IntegrationUpdate): Observable<Integration> {
    return this.http.patch<Integration>(`integrations/${id}`, body);
  }

  /** Substitui o conjunto inteiro de parâmetros (RF-127). */
  setParameters(id: string, parameters: Record<string, unknown>): Observable<Integration> {
    return this.http.patch<Integration>(`integrations/${id}/parameters`, { parameters });
  }

  activate(id: string): Observable<Integration> {
    return this.http.post<Integration>(`integrations/${id}/activate`, {});
  }

  /** Suspensão exige motivo: sem ele, ninguém explica depois por que parou. */
  suspend(id: string, reason: string): Observable<Integration> {
    return this.http.post<Integration>(`integrations/${id}/suspend`, { reason });
  }

  resume(id: string): Observable<Integration> {
    return this.http.post<Integration>(`integrations/${id}/resume`, {});
  }

  /** Desativa sem remover o histórico — exige `integrations:DELETE`. */
  deactivate(id: string): Observable<void> {
    return this.http.delete<void>(`integrations/${id}`);
  }
}
