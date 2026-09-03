import type { QueryValue } from './params';

/** Filtros aceitos por toda listagem paginada do backend (`PaginationQueryDto`). */
export interface ListQuery extends Record<string, QueryValue> {
  page?: number;
  pageSize?: number;
  q?: string;
  isActive?: boolean;
}

/** Tamanho de página das listagens de administração. */
export const PAGE_SIZE = 20;
