import type { DefinicaoFiltro, ValoresFiltro } from '../ui/filter-bar';
import type { Consulta } from '../core/lib/list-state';

/**
 * Filtro de situação das listagens de administração. O backend recebe
 * `isActive` booleano; a barra de filtros trabalha com string, então "" é
 * "todas" e não pode virar `isActive=` na URL.
 */
export const FILTRO_SITUACAO: DefinicaoFiltro = {
  name: 'situacao',
  label: 'Situação',
  placeholder: 'Situação',
  options: [
    { value: 'true', label: 'Ativos' },
    { value: 'false', label: 'Inativos' },
  ],
};

/** Traduz busca + situação para os parâmetros de `PaginationQueryDto`. */
export function consultaPadrao(filtros: ValoresFiltro): Consulta {
  // Ausente e vazio significam a mesma coisa — "todas" — e nesse caso o
  // parâmetro não pode ser enviado: `isActive=false` esconderia os ativos.
  const situacao = filtros['situacao'] ?? '';
  return {
    q: filtros.q,
    isActive: situacao === '' ? undefined : situacao === 'true',
  };
}
