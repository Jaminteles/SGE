import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { toHttpParams } from './params';
import { comCache } from './query-cache';
import type { ListQuery } from './query';
import type {
  ItemType,
  PaginatedResult,
  Product,
  ProductCategory,
  ProductCategoryInput,
  ProductInput,
  ProductSupplier,
  ProductSupplierInput,
  UnitOfMeasure,
  UnitOfMeasureInput,
} from './types';

/** Filtros próprios da listagem do catálogo (`QueryProductDto`). */
export interface ProductQuery extends ListQuery {
  type?: ItemType;
  categoryId?: string;
  /** Restringe aos itens homologados para este fornecedor (RF-030). */
  supplierId?: string;
}

/**
 * Catálogo de produtos e serviços (RF-028 a RF-030 — UI-020).
 *
 * Um recurso só para produto e serviço, discriminado por `type` — a tela usa
 * o mesmo filtro que o backend. Categorias e unidades são recursos próprios,
 * com permissão própria, e alimentam os selects do formulário.
 *
 * Preço, custo e quantidades chegam como string decimal com até 6 casas
 * (`UNIT_VALUE_PATTERN`); nunca `number`.
 */
@Injectable({ providedIn: 'root' })
export class CatalogApiService {
  private readonly http = inject(HttpClient);

  list(query: ProductQuery = {}): Observable<PaginatedResult<Product>> {
    return this.http.get<PaginatedResult<Product>>('products', { params: toHttpParams(query) });
  }

  get(id: string): Observable<Product> {
    return this.http.get<Product>(`products/${id}`);
  }

  create(body: ProductInput): Observable<Product> {
    return this.http.post<Product>('products', body);
  }

  update(id: string, body: Partial<ProductInput>): Observable<Product> {
    return this.http.patch<Product>(`products/${id}`, body);
  }

  /** Inativação lógica: o item continua nos movimentos e notas já emitidos. */
  inactivate(id: string): Observable<void> {
    return this.http.delete<void>(`products/${id}`);
  }

  listCategories(query: ListQuery = {}): Observable<PaginatedResult<ProductCategory>> {
    return this.http.get<PaginatedResult<ProductCategory>>('product-categories', {
      params: toHttpParams(query),
      context: comCache(),
    });
  }

  createCategory(body: ProductCategoryInput): Observable<ProductCategory> {
    return this.http.post<ProductCategory>('product-categories', body);
  }

  updateCategory(id: string, body: Partial<ProductCategoryInput>): Observable<ProductCategory> {
    return this.http.patch<ProductCategory>(`product-categories/${id}`, body);
  }

  inactivateCategory(id: string): Observable<void> {
    return this.http.delete<void>(`product-categories/${id}`);
  }

  listUnits(query: ListQuery = {}): Observable<PaginatedResult<UnitOfMeasure>> {
    return this.http.get<PaginatedResult<UnitOfMeasure>>('units-of-measure', {
      params: toHttpParams(query),
      context: comCache(),
    });
  }

  createUnit(body: UnitOfMeasureInput): Observable<UnitOfMeasure> {
    return this.http.post<UnitOfMeasure>('units-of-measure', body);
  }

  updateUnit(id: string, body: Partial<UnitOfMeasureInput>): Observable<UnitOfMeasure> {
    return this.http.patch<UnitOfMeasure>(`units-of-measure/${id}`, body);
  }

  inactivateUnit(id: string): Observable<void> {
    return this.http.delete<void>(`units-of-measure/${id}`);
  }

  listSuppliers(productId: string): Observable<ProductSupplier[]> {
    return this.http.get<ProductSupplier[]>(`products/${productId}/suppliers`);
  }

  createSupplier(productId: string, body: ProductSupplierInput): Observable<ProductSupplier> {
    return this.http.post<ProductSupplier>(`products/${productId}/suppliers`, body);
  }

  updateSupplier(
    productId: string,
    id: string,
    body: Partial<Omit<ProductSupplierInput, 'partnerId'>>,
  ): Observable<ProductSupplier> {
    return this.http.patch<ProductSupplier>(`products/${productId}/suppliers/${id}`, body);
  }

  removeSupplier(productId: string, id: string): Observable<void> {
    return this.http.delete<void>(`products/${productId}/suppliers/${id}`);
  }
}
