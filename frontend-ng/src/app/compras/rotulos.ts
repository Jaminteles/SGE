import type { DivergenceType, PurchaseOrder, PurchaseOrderStatus } from '../core/api/types';
import type { Consulta } from '../core/lib/list-state';
import { ROTULO_APROVACAO } from '../financeiro/rotulos';
import type { DefinicaoFiltro, OpcaoFiltro, ValoresFiltro } from '../ui/filter-bar';

/** Severidades aceitas pela `p-tag` do PrimeNG. */
export type Severidade = 'success' | 'warn' | 'danger' | 'info' | 'secondary';

function opcoes<T extends string>(rotulos: Record<T, string>): OpcaoFiltro[] {
  return (Object.keys(rotulos) as T[]).map((valor) => ({ value: valor, label: rotulos[valor] }));
}

/** Operação das alçadas de compra (`PURCHASE_OPERATION` do backend — RF-038). */
export const OPERACAO_PEDIDO = 'PEDIDO_COMPRA';

// ---------------------------------------------------------------------------
// Pedido (RF-036 a RF-038)
// ---------------------------------------------------------------------------

export const ROTULO_STATUS_PEDIDO: Record<PurchaseOrderStatus, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  APROVADO: 'Aprovado',
  REPROVADO: 'Reprovado',
  PARCIALMENTE_RECEBIDO: 'Parcialmente recebido',
  RECEBIDO: 'Recebido',
  CANCELADO: 'Cancelado',
};

const SEVERIDADE_STATUS_PEDIDO: Record<PurchaseOrderStatus, Severidade> = {
  RASCUNHO: 'secondary',
  AGUARDANDO_APROVACAO: 'warn',
  APROVADO: 'info',
  REPROVADO: 'danger',
  PARCIALMENTE_RECEBIDO: 'warn',
  RECEBIDO: 'success',
  CANCELADO: 'secondary',
};

export function severidadePedido(status: PurchaseOrderStatus): Severidade {
  return SEVERIDADE_STATUS_PEDIDO[status] ?? 'secondary';
}

export const FILTRO_STATUS_PEDIDO: DefinicaoFiltro = {
  name: 'status',
  label: 'Situação',
  placeholder: 'Situação',
  options: opcoes(ROTULO_STATUS_PEDIDO),
};

export const FILTRO_APROVACAO_PEDIDO: DefinicaoFiltro = {
  name: 'approvalStatus',
  label: 'Aprovação',
  placeholder: 'Aprovação',
  options: opcoes(ROTULO_APROVACAO),
};

export const FILTRO_PENDENTE_RECEBIMENTO: DefinicaoFiltro = {
  name: 'pendingReceiptOnly',
  label: 'Entrega',
  placeholder: 'Entrega',
  options: [{ value: 'true', label: 'Com entrega pendente' }],
};

/** Traduz a barra de filtros para `QueryPurchaseOrderDto` (período = data do pedido). */
export function consultaPedido(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    status: filtros['status'] || undefined,
    approvalStatus: filtros['approvalStatus'] || undefined,
    pendingReceiptOnly: filtros['pendingReceiptOnly'] === 'true' ? true : undefined,
    from: filtros['from'] || undefined,
    to: filtros['to'] || undefined,
  };
}

/** Situações em que o pedido aceita entrega (`RECEIVABLE_STATUSES` do backend). */
const RECEBIVEIS: PurchaseOrderStatus[] = ['APROVADO', 'PARCIALMENTE_RECEBIDO'];

export function aceitaRecebimento(pedido: Pick<PurchaseOrder, 'status'>): boolean {
  return RECEBIVEIS.includes(pedido.status);
}

/** Item só muda em rascunho: aprovar o que ainda pode mudar não é aprovar (RF-038). */
export function editavel(pedido: Pick<PurchaseOrder, 'status'>): boolean {
  return pedido.status === 'RASCUNHO';
}

/**
 * Cancelamento: nunca de quem já teve entrega — o que chegou precisa continuar
 * tendo um pedido que o explique (RN-009). O servidor recusa do mesmo jeito.
 */
export function aceitaCancelamento(pedido: Pick<PurchaseOrder, 'status' | 'receipts'>): boolean {
  return pedido.status !== 'CANCELADO' && pedido.receipts.length === 0;
}

/** Quem abriu o pedido — é esse que não decide sobre ele (RN-003). */
export function solicitante(pedido: Pick<PurchaseOrder, 'requesterId' | 'createdById'>) {
  return pedido.requesterId ?? pedido.createdById;
}

export function fornecedor(pedido: { partner: PurchaseOrder['partner'] }): string {
  return pedido.partner?.tradeName ?? pedido.partner?.legalName ?? '—';
}

// ---------------------------------------------------------------------------
// Recebimento e divergências (RF-039/RF-040)
// ---------------------------------------------------------------------------

export const ROTULO_DIVERGENCIA: Record<DivergenceType, string> = {
  NENHUMA: 'Conferido',
  QUANTIDADE: 'Quantidade',
  PRECO: 'Preço',
  AMBOS: 'Quantidade e preço',
};

const SEVERIDADE_DIVERGENCIA: Record<DivergenceType, Severidade> = {
  NENHUMA: 'success',
  QUANTIDADE: 'warn',
  PRECO: 'warn',
  AMBOS: 'danger',
};

export function severidadeDivergencia(tipo: DivergenceType | null): Severidade {
  return tipo ? (SEVERIDADE_DIVERGENCIA[tipo] ?? 'secondary') : 'secondary';
}

export const FILTRO_DIVERGENCIA: DefinicaoFiltro = {
  name: 'divergentOnly',
  label: 'Conferência',
  placeholder: 'Conferência',
  options: [{ value: 'true', label: 'Somente com divergência' }],
};

/**
 * Traduz a barra para `QueryGoodsReceiptDto`. O período da barra é de dias; a
 * API recebe instantes com `to` exclusivo, então o fim vira o dia seguinte.
 */
export function consultaRecebimento(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    divergentOnly: filtros['divergentOnly'] === 'true' ? true : undefined,
    from: filtros['from'] || undefined,
    to: filtros['to'] ? diaSeguinte(filtros['to']) : undefined,
  };
}

function diaSeguinte(data: string): string {
  const [ano, mes, dia] = data.split('-').map((parte) => Number.parseInt(parte, 10));
  return new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10);
}

/** Traduz a barra para `QueryPurchaseHistoryDto`. */
export function consultaHistorico(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    productId: filtros['productId'] || undefined,
    partnerId: filtros['partnerId'] || undefined,
    from: filtros['from'] || undefined,
    to: filtros['to'] || undefined,
  };
}
