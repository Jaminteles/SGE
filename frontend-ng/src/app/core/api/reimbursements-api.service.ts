import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  PaginatedResult,
  ReceiptDocument,
  Reimbursement,
  ReimbursementInput,
  ReimbursementStatus,
} from './types';

/** Filtros da listagem de reembolsos (`QueryReimbursementDto`). */
export interface ReimbursementQuery extends ListQuery {
  status?: ReimbursementStatus;
  employeeId?: string;
  /** Recorte por data da solicitação (`YYYY-MM-DD`). */
  from?: string;
  to?: string;
}

/**
 * Solicitações de reembolso e comprovantes (RF-018/RF-019 — UI-017).
 *
 * Número e valor total não são enviados pelo cliente: o banco gera o
 * sequencial e o total sai da soma dos itens. A transição de estado é sempre
 * uma rota própria (`submit`, `review`, `approve`, `reject`) — nunca um PATCH
 * de `status`, que deixaria a máquina de estados do backend de fora.
 */
@Injectable({ providedIn: 'root' })
export class ReimbursementsApiService {
  private readonly http = inject(HttpClient);

  list(query: ReimbursementQuery = {}): Observable<PaginatedResult<Reimbursement>> {
    return this.http.get<PaginatedResult<Reimbursement>>('reimbursements', {
      params: toHttpParams(query),
    });
  }

  get(id: string): Observable<Reimbursement> {
    return this.http.get<Reimbursement>(`reimbursements/${id}`);
  }

  create(body: ReimbursementInput): Observable<Reimbursement> {
    return this.http.post<Reimbursement>('reimbursements', body);
  }

  submit(id: string): Observable<Reimbursement> {
    return this.http.post<Reimbursement>(`reimbursements/${id}/submit`, {});
  }

  startReview(id: string): Observable<Reimbursement> {
    return this.http.post<Reimbursement>(`reimbursements/${id}/review`, {});
  }

  approve(id: string, body: { approvedAmount?: string; note?: string } = {}) {
    return this.http.post<Reimbursement>(`reimbursements/${id}/approve`, body);
  }

  reject(id: string, reason: string): Observable<Reimbursement> {
    return this.http.post<Reimbursement>(`reimbursements/${id}/reject`, { reason });
  }

  /** Cancelamento preserva o registro (RN-009); o motivo vai na trilha. */
  cancel(id: string, reason?: string): Observable<Reimbursement> {
    return this.http.delete<Reimbursement>(`reimbursements/${id}`, {
      params: toHttpParams({ reason }),
    });
  }

  /**
   * Anexa o comprovante da despesa (RF-019).
   *
   * Vai como `FormData`: o navegador monta o `multipart/form-data` com o
   * boundary correto. Definir `Content-Type` na mão quebraria o upload.
   */
  attachReceipt(reimbursementId: string, itemId: string, file: File): Observable<ReceiptDocument> {
    const corpo = new FormData();
    corpo.append('file', file, file.name);
    return this.http.post<ReceiptDocument>(
      `reimbursements/${reimbursementId}/items/${itemId}/receipt`,
      corpo,
    );
  }

  /**
   * Baixa o comprovante como `Blob`.
   *
   * A rota exige token e cabeçalho de empresa, então não dá para apontar um
   * `<a href>` direto para ela: o download passa pelo cliente HTTP e vira uma
   * URL de objeto temporária na tela.
   */
  downloadReceipt(reimbursementId: string, itemId: string): Observable<Blob> {
    return this.http.get(`reimbursements/${reimbursementId}/items/${itemId}/receipt`, {
      responseType: 'blob',
    });
  }
}
