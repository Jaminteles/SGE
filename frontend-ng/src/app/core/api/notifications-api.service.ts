import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  AppNotification,
  AutomationRule,
  AutomationRuleInput,
  AutomationRuleRun,
  AutomationRuleUpdate,
  AutomationTrigger,
  NotificationStatus,
  PaginatedResult,
} from './types';

/** Filtros da caixa de entrada (`QueryNotificationDto`). */
export interface NotificationQuery extends ListQuery {
  status?: NotificationStatus;
  type?: string;
  unreadOnly?: boolean;
}

/** Filtros da lista de regras (`QueryAutomationRuleDto`). */
export interface AutomationRuleQuery extends ListQuery {
  triggerEvent?: AutomationTrigger;
}

/**
 * Notificações e automação (RF-119 a RF-125 — UI-065 a UI-067).
 *
 * A caixa de entrada é sempre a **do usuário autenticado**: o backend cruza a
 * empresa ativa do cabeçalho com o usuário do token, e nenhum parâmetro daqui
 * alcança a caixa de um colega. Não há exclusão — o que a tela chama de
 * "limpar" é marcar como lido (bd/16 §8).
 */
@Injectable({ providedIn: 'root' })
export class NotificationsApiService {
  private readonly http = inject(HttpClient);

  // --- Caixa de entrada (RF-119) -------------------------------------------

  list(query: NotificationQuery = {}): Observable<PaginatedResult<AppNotification>> {
    return this.http.get<PaginatedResult<AppNotification>>('notifications', {
      params: toHttpParams(query),
    });
  }

  unreadCount(): Observable<{ unread: number }> {
    return this.http.get<{ unread: number }>('notifications/unread-count');
  }

  markRead(id: string): Observable<AppNotification> {
    return this.http.post<AppNotification>(`notifications/${id}/read`, {});
  }

  markAllRead(): Observable<{ updated: number }> {
    return this.http.post<{ updated: number }>('notifications/read-all', {});
  }

  // --- Regras de automação (RF-120 a RF-125) -------------------------------

  listRules(query: AutomationRuleQuery = {}): Observable<PaginatedResult<AutomationRule>> {
    return this.http.get<PaginatedResult<AutomationRule>>('automation-rules', {
      params: toHttpParams(query),
    });
  }

  getRule(id: string): Observable<AutomationRule> {
    return this.http.get<AutomationRule>(`automation-rules/${id}`);
  }

  /** Histórico de execuções, da mais recente para a mais antiga. */
  runs(id: string): Observable<AutomationRuleRun[]> {
    return this.http.get<AutomationRuleRun[]>(`automation-rules/${id}/runs`);
  }

  createRule(body: AutomationRuleInput): Observable<AutomationRule> {
    return this.http.post<AutomationRule>('automation-rules', body);
  }

  updateRule(id: string, body: AutomationRuleUpdate): Observable<AutomationRule> {
    return this.http.patch<AutomationRule>(`automation-rules/${id}`, body);
  }

  /** Desativa a regra — exige `automation-rules:DELETE`. */
  deleteRule(id: string): Observable<void> {
    return this.http.delete<void>(`automation-rules/${id}`);
  }
}
