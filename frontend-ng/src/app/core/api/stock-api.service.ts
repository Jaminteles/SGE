import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import type { ListQuery } from './query';
import type {
  Inventory,
  InventoryCountInput,
  InventoryInput,
  InventoryStatus,
  PaginatedResult,
  StockAlert,
  StockBalance,
  StockLocation,
  StockLocationInput,
  StockMovement,
  StockMovementInput,
  StockMovementType,
  StockTransferInput,
  StockValuation,
} from './types';

/** Filtros da consulta de saldos (`QueryStockBalanceDto`). */
export interface StockBalanceQuery extends ListQuery {
  productId?: string;
  locationId?: string;
  branchId?: string;
  onlyWithBalance?: boolean;
}

/** Filtros do razão de movimentos (`QueryStockMovementDto`). */
export interface StockMovementQuery extends ListQuery {
  productId?: string;
  locationId?: string;
  type?: StockMovementType;
  from?: string;
  to?: string;
}

/** Filtros da listagem de inventários (`QueryInventoryDto`). */
export interface InventoryQuery extends ListQuery {
  status?: InventoryStatus;
  locationId?: string;
}

/**
 * Estoque: locais, saldos, razão de movimentos e inventário (RF-031 a RF-035 —
 * UI-021 a UI-023).
 *
 * O razão é append-only: não existe editar nem apagar movimento, só
 * acrescentar — um erro é corrigido por um ajuste, que também fica registrado.
 * Transferência tem rota própria porque é uma operação com duas pernas, que
 * precisam nascer juntas.
 *
 * O ajuste da contagem sai do fechamento do inventário, não de um movimento
 * digitado à mão.
 */
@Injectable({ providedIn: 'root' })
export class StockApiService {
  private readonly http = inject(HttpClient);

  listLocations(query: ListQuery = {}): Observable<PaginatedResult<StockLocation>> {
    return this.http.get<PaginatedResult<StockLocation>>('stock-locations', {
      params: toHttpParams(query),
    });
  }

  createLocation(body: StockLocationInput): Observable<StockLocation> {
    return this.http.post<StockLocation>('stock-locations', body);
  }

  updateLocation(id: string, body: Partial<StockLocationInput>): Observable<StockLocation> {
    return this.http.patch<StockLocation>(`stock-locations/${id}`, body);
  }

  inactivateLocation(id: string): Observable<void> {
    return this.http.delete<void>(`stock-locations/${id}`);
  }

  listBalances(query: StockBalanceQuery = {}): Observable<PaginatedResult<StockBalance>> {
    return this.http.get<PaginatedResult<StockBalance>>('stock/balances', {
      params: toHttpParams(query),
    });
  }

  /** Itens no ou abaixo do estoque mínimo (RF-035). */
  alerts(locationId?: string): Observable<StockAlert[]> {
    return this.http.get<StockAlert[]>('stock/alerts', { params: toHttpParams({ locationId }) });
  }

  /** Valorização a custo médio (RF-034) — exige `stock-valuation:READ`. */
  valuation(filtros: { branchId?: string; locationId?: string } = {}): Observable<StockValuation> {
    return this.http.get<StockValuation>('stock/valuation', { params: toHttpParams(filtros) });
  }

  listMovements(query: StockMovementQuery = {}): Observable<PaginatedResult<StockMovement>> {
    return this.http.get<PaginatedResult<StockMovement>>('stock/movements', {
      params: toHttpParams(query),
    });
  }

  createMovement(body: StockMovementInput): Observable<StockMovement> {
    return this.http.post<StockMovement>('stock/movements', body);
  }

  /** Devolve as duas pernas da transferência, saída e entrada. */
  createTransfer(body: StockTransferInput): Observable<StockMovement[]> {
    return this.http.post<StockMovement[]>('stock/transfers', body);
  }

  listInventories(query: InventoryQuery = {}): Observable<PaginatedResult<Inventory>> {
    return this.http.get<PaginatedResult<Inventory>>('inventories', {
      params: toHttpParams(query),
    });
  }

  getInventory(id: string): Observable<Inventory> {
    return this.http.get<Inventory>(`inventories/${id}`);
  }

  createInventory(body: InventoryInput): Observable<Inventory> {
    return this.http.post<Inventory>('inventories', body);
  }

  startInventory(id: string): Observable<Inventory> {
    return this.http.post<Inventory>(`inventories/${id}/start`, {});
  }

  countInventory(id: string, body: InventoryCountInput): Observable<Inventory> {
    return this.http.patch<Inventory>(`inventories/${id}/counts`, body);
  }

  /** Conclui a contagem e gera os ajustes de estoque (RF-033/RN-003). */
  closeInventory(id: string): Observable<Inventory> {
    return this.http.post<Inventory>(`inventories/${id}/close`, {});
  }

  cancelInventory(id: string, reason: string): Observable<Inventory> {
    return this.http.post<Inventory>(`inventories/${id}/cancel`, { reason });
  }
}
