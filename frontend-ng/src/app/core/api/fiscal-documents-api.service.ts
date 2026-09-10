import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type { FiscalDocumentStatus, FiscalDocumentSummary, PaginatedResult } from './types';

/** Filtros da consulta de documentos fiscais (`QueryFiscalDocumentDto`). */
export interface FiscalDocumentQuery extends ListQuery {
  status?: FiscalDocumentStatus;
  issuerPartnerId?: string;
  purchaseOrderId?: string;
  from?: string;
  to?: string;
}

/**
 * Documentos fiscais — por enquanto só a consulta que o vínculo do pedido de
 * compra usa (RF-047 — UI-032/UI-034). As telas do M07 chegam na sprint dele.
 */
@Injectable({ providedIn: 'root' })
export class FiscalDocumentsApiService {
  private readonly http = inject(HttpClient);

  list(query: FiscalDocumentQuery = {}): Observable<PaginatedResult<FiscalDocumentSummary>> {
    return this.http.get<PaginatedResult<FiscalDocumentSummary>>('fiscal-documents', {
      params: toHttpParams(query),
    });
  }
}
