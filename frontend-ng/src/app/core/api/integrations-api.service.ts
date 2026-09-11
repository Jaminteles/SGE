import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  FailedJob,
  FailedWebhook,
  IntegrationHealth,
  PaginatedResult,
  ReprocessResult,
  ReprocessTarget,
} from './types';

/**
 * Fila de trabalho assíncrono e reprocessamento (RF-069/RF-070, RF-128/RF-130).
 *
 * Só o que o painel de operações bancárias usa (UI-047). Reprocessar repete a
 * *tentativa*, não o *efeito*: o backend só aceita job em FALHA/CANCELADO e
 * webhook em FALHA, e a chave `reprocesso:<alvo>:<id>` segura o duplo clique.
 */
@Injectable({ providedIn: 'root' })
export class IntegrationsApiService {
  private readonly http = inject(HttpClient);

  /** Saúde das integrações e contagem da fila — exige `integrations:READ`. */
  health(): Observable<IntegrationHealth> {
    return this.http.get<IntegrationHealth>('integrations/health');
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
}
