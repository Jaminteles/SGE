import { HttpParams } from '@angular/common/http';

export type QueryValue = string | number | boolean | null | undefined;

/**
 * Monta a query string ignorando valores vazios (`null`, `undefined` e `''`).
 *
 * É o comportamento que os filtros das listagens dependem: um campo em branco
 * na barra de filtros não pode virar `?situacao=` na URL, senão a API filtra
 * por string vazia em vez de não filtrar.
 */
export function toHttpParams(query: Record<string, QueryValue> | undefined): HttpParams {
  let params = new HttpParams();
  if (!query) return params;
  for (const [chave, valor] of Object.entries(query)) {
    if (valor === undefined || valor === null || valor === '') continue;
    params = params.append(chave, String(valor));
  }
  return params;
}
