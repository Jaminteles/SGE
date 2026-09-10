import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  ApprovalStatus,
  GoodsReceipt,
  GoodsReceiptInput,
  PaginatedResult,
  PurchaseHistoryResult,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderStatus,
  PurchaseOrderUpdateInput,
} from './types';

/** Filtros do acompanhamento de pedidos (`QueryPurchaseOrderDto`). */
export interface PurchaseOrderQuery extends ListQuery {
  status?: PurchaseOrderStatus;
  approvalStatus?: ApprovalStatus;
  partnerId?: string;
  branchId?: string;
  from?: string;
  to?: string;
  pendingReceiptOnly?: boolean;
}

/** Filtros da consulta de recebimentos (`QueryGoodsReceiptDto`). */
export interface GoodsReceiptQuery extends ListQuery {
  orderId?: string;
  partnerId?: string;
  /** Instantes ISO; `to` é exclusivo. */
  from?: string;
  to?: string;
  divergentOnly?: boolean;
}

/** Filtros do histórico de compras (`QueryPurchaseHistoryDto`). */
export interface PurchaseHistoryQuery extends ListQuery {
  productId?: string;
  partnerId?: string;
  from?: string;
  to?: string;
}

/**
 * Compras: pedido, aprovação por alçada, recebimento e histórico (RF-036 a
 * RF-042 — UI-030 a UI-035).
 *
 * Não existe `DELETE` de pedido: pedido emitido é documento, e o que há é
 * cancelamento com motivo. O recebimento entra por baixo do pedido que ele
 * confere, com permissão própria — quem compra não é quem recebe (RN-003).
 *
 * Nenhum total sai daqui: valor da linha, rateio do frete e total do pedido são
 * calculados pelo banco, e o título a pagar da entrega também.
 */
@Injectable({ providedIn: 'root' })
export class PurchasingApiService {
  private readonly http = inject(HttpClient);

  listOrders(query: PurchaseOrderQuery = {}): Observable<PaginatedResult<PurchaseOrder>> {
    return this.http.get<PaginatedResult<PurchaseOrder>>('purchase-orders', {
      params: toHttpParams(query),
    });
  }

  getOrder(id: string): Observable<PurchaseOrder> {
    return this.http.get<PurchaseOrder>(`purchase-orders/${id}`);
  }

  createOrder(body: PurchaseOrderInput): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>('purchase-orders', body);
  }

  /** Só em rascunho; `items` substitui a lista inteira. */
  updateOrder(id: string, body: PurchaseOrderUpdateInput): Observable<PurchaseOrder> {
    return this.http.patch<PurchaseOrder>(`purchase-orders/${id}`, body);
  }

  /** Fecha o rascunho: aprova na hora ou envia à alçada (RF-038). */
  submitOrder(id: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`purchase-orders/${id}/submit`, {});
  }

  approveOrder(id: string, note?: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`purchase-orders/${id}/approve`, note ? { note } : {});
  }

  rejectOrder(id: string, reason: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`purchase-orders/${id}/reject`, { reason });
  }

  cancelOrder(id: string, reason: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`purchase-orders/${id}/cancel`, { reason });
  }

  /** Entrega total ou parcial, com conferência (RF-039 a RF-041). */
  createReceipt(orderId: string, body: GoodsReceiptInput): Observable<GoodsReceipt> {
    return this.http.post<GoodsReceipt>(`purchase-orders/${orderId}/receipts`, body);
  }

  listOrderReceipts(
    orderId: string,
    query: ListQuery = {},
  ): Observable<PaginatedResult<GoodsReceipt>> {
    return this.http.get<PaginatedResult<GoodsReceipt>>(`purchase-orders/${orderId}/receipts`, {
      params: toHttpParams(query),
    });
  }

  listReceipts(query: GoodsReceiptQuery = {}): Observable<PaginatedResult<GoodsReceipt>> {
    return this.http.get<PaginatedResult<GoodsReceipt>>('goods-receipts', {
      params: toHttpParams(query),
    });
  }

  getReceipt(id: string): Observable<GoodsReceipt> {
    return this.http.get<GoodsReceipt>(`goods-receipts/${id}`);
  }

  /** Histórico e evolução de preços (RF-042) — exige `purchase-history:READ`. */
  history(query: PurchaseHistoryQuery = {}): Observable<PurchaseHistoryResult> {
    return this.http.get<PurchaseHistoryResult>('purchase-history', {
      params: toHttpParams(query),
    });
  }
}
