import type { Consulta } from '../core/lib/list-state';
import type { DefinicaoFiltro, OpcaoFiltro, ValoresFiltro } from '../ui/filter-bar';
import type { InventoryStatus, StockMovementType } from '../core/api/types';

/** Severidades aceitas pela `p-tag` do PrimeNG. */
export type Severidade = 'success' | 'warn' | 'danger' | 'info' | 'secondary';

// ---------------------------------------------------------------------------
// Movimentações (RF-032)
// ---------------------------------------------------------------------------

export const ROTULO_MOVIMENTO: Record<StockMovementType, string> = {
  ENTRADA: 'Entrada',
  SAIDA: 'Saída',
  TRANSFERENCIA_ENTRADA: 'Transferência (entrada)',
  TRANSFERENCIA_SAIDA: 'Transferência (saída)',
  AJUSTE_POSITIVO: 'Ajuste positivo',
  AJUSTE_NEGATIVO: 'Ajuste negativo',
  INVENTARIO: 'Inventário',
};

const SEVERIDADE_MOVIMENTO: Record<StockMovementType, Severidade> = {
  ENTRADA: 'success',
  SAIDA: 'danger',
  TRANSFERENCIA_ENTRADA: 'info',
  TRANSFERENCIA_SAIDA: 'info',
  AJUSTE_POSITIVO: 'warn',
  AJUSTE_NEGATIVO: 'warn',
  INVENTARIO: 'secondary',
};

export function severidadeMovimento(tipo: StockMovementType): Severidade {
  return SEVERIDADE_MOVIMENTO[tipo] ?? 'secondary';
}

/** Movimentos que reduzem o saldo — a quantidade aparece com sinal negativo. */
const NEGATIVOS: StockMovementType[] = ['SAIDA', 'TRANSFERENCIA_SAIDA', 'AJUSTE_NEGATIVO'];

export function reduzSaldo(tipo: StockMovementType): boolean {
  return NEGATIVOS.includes(tipo);
}

export const FILTRO_TIPO_MOVIMENTO: DefinicaoFiltro = {
  name: 'type',
  label: 'Tipo',
  placeholder: 'Tipo',
  options: (Object.keys(ROTULO_MOVIMENTO) as StockMovementType[]).map((tipo) => ({
    value: tipo,
    label: ROTULO_MOVIMENTO[tipo],
  })),
};

/**
 * Tipos que o usuário lança direto (`StockEntryType`).
 *
 * As pernas de transferência não estão aqui: nascem juntas por
 * `POST /stock/transfers`. `INVENTARIO` também fica de fora — o ajuste da
 * contagem sai do fechamento do inventário (RF-033), não de um lançamento
 * manual.
 */
export const OPCOES_LANCAMENTO: OpcaoFiltro[] = [
  { value: 'ENTRADA', label: 'Entrada' },
  { value: 'SAIDA', label: 'Saída' },
  { value: 'AJUSTE_POSITIVO', label: 'Ajuste positivo' },
  { value: 'AJUSTE_NEGATIVO', label: 'Ajuste negativo' },
];

/** Ajuste exige justificativa: é correção de saldo, e o razão é append-only. */
export function exigeJustificativa(tipo: string): boolean {
  return tipo === 'AJUSTE_POSITIVO' || tipo === 'AJUSTE_NEGATIVO';
}

/** Traduz busca, tipo e local para `QueryStockMovementDto`. */
export function consultaMovimento(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    type: filtros['type'] || undefined,
    locationId: filtros['locationId'] || undefined,
    from: filtros['from'] || undefined,
    to: filtros['to'] || undefined,
  };
}

// ---------------------------------------------------------------------------
// Inventário (RF-033)
// ---------------------------------------------------------------------------

export const ROTULO_INVENTARIO: Record<InventoryStatus, string> = {
  ABERTO: 'Aberto',
  EM_CONTAGEM: 'Em contagem',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
};

const SEVERIDADE_INVENTARIO: Record<InventoryStatus, Severidade> = {
  ABERTO: 'info',
  EM_CONTAGEM: 'warn',
  CONCLUIDO: 'success',
  CANCELADO: 'secondary',
};

export function severidadeInventario(status: InventoryStatus): Severidade {
  return SEVERIDADE_INVENTARIO[status] ?? 'secondary';
}

export const FILTRO_STATUS_INVENTARIO: DefinicaoFiltro = {
  name: 'status',
  label: 'Situação',
  placeholder: 'Situação',
  options: (Object.keys(ROTULO_INVENTARIO) as InventoryStatus[]).map((status) => ({
    value: status,
    label: ROTULO_INVENTARIO[status],
  })),
};

/** Traduz busca, situação e local para `QueryInventoryDto`. */
export function consultaInventario(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    status: filtros['status'] || undefined,
    locationId: filtros['locationId'] || undefined,
  };
}
