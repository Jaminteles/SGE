import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  FiscalAttachment,
  FiscalAttachmentCategory,
  FiscalDocument,
  FiscalDocumentLinkInput,
  FiscalDocumentModel,
  FiscalDocumentOrigin,
  FiscalDocumentPostingInput,
  FiscalDocumentStatus,
  FiscalImportResult,
  PaginatedResult,
} from './types';

/** Filtros da consulta de documentos fiscais (`QueryFiscalDocumentDto`). */
export interface FiscalDocumentQuery extends ListQuery {
  status?: FiscalDocumentStatus;
  model?: FiscalDocumentModel;
  origin?: FiscalDocumentOrigin;
  issuerPartnerId?: string;
  purchaseOrderId?: string;
  from?: string;
  to?: string;
  /** Só o que ainda exige ação: erro, sem fornecedor, sem entrada ou sem título. */
  pendingOnly?: boolean;
}

/**
 * Documentos fiscais (RF-043 a RF-050 — UI-036 a UI-041).
 *
 * Não há edição do conteúdo da nota: tudo o que a descreve vem do XML. O que a
 * interface envia são vínculos, decisões (efeitos, descarte) e arquivos.
 */
@Injectable({ providedIn: 'root' })
export class FiscalDocumentsApiService {
  private readonly http = inject(HttpClient);

  list(query: FiscalDocumentQuery = {}): Observable<PaginatedResult<FiscalDocument>> {
    return this.http.get<PaginatedResult<FiscalDocument>>('fiscal-documents', {
      params: toHttpParams(query),
    });
  }

  get(id: string): Observable<FiscalDocument> {
    return this.http.get<FiscalDocument>(`fiscal-documents/${id}`);
  }

  /**
   * Importa um XML (RF-043). Vai como `FormData`: o navegador monta o
   * `multipart/form-data` com o boundary — definir `Content-Type` quebraria.
   * Número, chave e valores nunca vão no corpo: o backend lê do arquivo.
   */
  importXml(file: File, extras: { branchId?: string; note?: string } = {}) {
    const corpo = new FormData();
    corpo.append('file', file, file.name);
    if (extras.branchId) corpo.append('branchId', extras.branchId);
    if (extras.note) corpo.append('note', extras.note);
    return this.http.post<FiscalImportResult>('fiscal-documents/import', corpo);
  }

  /** XML original como `Blob` — a rota exige token e empresa, não cabe num `href`. */
  downloadXml(id: string): Observable<Blob> {
    return this.http.get(`fiscal-documents/${id}/xml`, { responseType: 'blob' });
  }

  link(id: string, body: FiscalDocumentLinkInput): Observable<FiscalDocument> {
    return this.http.patch<FiscalDocument>(`fiscal-documents/${id}/links`, body);
  }

  reprocess(id: string): Observable<FiscalImportResult> {
    return this.http.post<FiscalImportResult>(`fiscal-documents/${id}/reprocess`, {});
  }

  /** Descarte com motivo — o registro fica, a trilha guarda o porquê (RF-049). */
  cancel(id: string, reason: string): Observable<FiscalDocument> {
    return this.http.post<FiscalDocument>(`fiscal-documents/${id}/cancel`, { reason });
  }

  /** Entrada de estoque e/ou título a pagar a partir da nota (RF-047). */
  post(id: string, body: FiscalDocumentPostingInput): Observable<FiscalDocument> {
    return this.http.post<FiscalDocument>(`fiscal-documents/${id}/postings`, body);
  }

  listAttachments(id: string): Observable<FiscalAttachment[]> {
    return this.http.get<FiscalAttachment[]>(`fiscal-documents/${id}/attachments`);
  }

  attach(id: string, file: File, category: FiscalAttachmentCategory): Observable<FiscalAttachment> {
    const corpo = new FormData();
    corpo.append('file', file, file.name);
    corpo.append('category', category);
    return this.http.post<FiscalAttachment>(`fiscal-documents/${id}/attachments`, corpo);
  }

  downloadAttachment(id: string, attachmentId: string): Observable<Blob> {
    return this.http.get(`fiscal-documents/${id}/attachments/${attachmentId}`, {
      responseType: 'blob',
    });
  }
}
