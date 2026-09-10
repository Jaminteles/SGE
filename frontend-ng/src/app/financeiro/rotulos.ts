import type {
  ApprovalStatus,
  CashFlowGranularity,
  CashSituation,
  EntryStatus,
  EntryType,
  FinancialEntry,
  InstallmentStatus,
  PaymentMethodType,
} from '../core/api/types';
import type { Consulta } from '../core/lib/list-state';
import type { DefinicaoFiltro, OpcaoFiltro, ValoresFiltro } from '../ui/filter-bar';

/** Severidades aceitas pela `p-tag` do PrimeNG. */
export type Severidade = 'success' | 'warn' | 'danger' | 'info' | 'secondary';

function opcoes<T extends string>(rotulos: Record<T, string>): OpcaoFiltro[] {
  return (Object.keys(rotulos) as T[]).map((valor) => ({ value: valor, label: rotulos[valor] }));
}

// ---------------------------------------------------------------------------
// Títulos (RF-051 a RF-057)
// ---------------------------------------------------------------------------

export const ROTULO_TIPO: Record<EntryType, string> = {
  PAGAR: 'A pagar',
  RECEBER: 'A receber',
};

export const ROTULO_STATUS_TITULO: Record<EntryStatus, string> = {
  ABERTO: 'Aberto',
  PARCIALMENTE_LIQUIDADO: 'Parcialmente liquidado',
  LIQUIDADO: 'Liquidado',
  CANCELADO: 'Cancelado',
  RENEGOCIADO: 'Renegociado',
};

const SEVERIDADE_STATUS_TITULO: Record<EntryStatus, Severidade> = {
  ABERTO: 'info',
  PARCIALMENTE_LIQUIDADO: 'warn',
  LIQUIDADO: 'success',
  CANCELADO: 'secondary',
  RENEGOCIADO: 'secondary',
};

export function severidadeTitulo(status: EntryStatus): Severidade {
  return SEVERIDADE_STATUS_TITULO[status] ?? 'secondary';
}

export const ROTULO_APROVACAO: Record<ApprovalStatus, string> = {
  NAO_REQUERIDA: 'Dispensada',
  PENDENTE: 'Pendente',
  APROVADO: 'Aprovado',
  REPROVADO: 'Reprovado',
  CANCELADO: 'Cancelada',
};

const SEVERIDADE_APROVACAO: Record<ApprovalStatus, Severidade> = {
  NAO_REQUERIDA: 'secondary',
  PENDENTE: 'warn',
  APROVADO: 'success',
  REPROVADO: 'danger',
  CANCELADO: 'secondary',
};

export function severidadeAprovacao(status: ApprovalStatus): Severidade {
  return SEVERIDADE_APROVACAO[status] ?? 'secondary';
}

export const ROTULO_STATUS_PARCELA: Record<InstallmentStatus, string> = {
  ABERTA: 'Aberta',
  PARCIALMENTE_LIQUIDADA: 'Parcial',
  LIQUIDADA: 'Liquidada',
  CANCELADA: 'Cancelada',
  RENEGOCIADA: 'Renegociada',
};

const SEVERIDADE_PARCELA: Record<InstallmentStatus, Severidade> = {
  ABERTA: 'info',
  PARCIALMENTE_LIQUIDADA: 'warn',
  LIQUIDADA: 'success',
  CANCELADA: 'secondary',
  RENEGOCIADA: 'secondary',
};

export function severidadeParcela(status: InstallmentStatus): Severidade {
  return SEVERIDADE_PARCELA[status] ?? 'secondary';
}

export const ROTULO_METODO: Record<PaymentMethodType, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  TED: 'TED',
  DOC: 'DOC',
  TRANSFERENCIA_INTERNA: 'Transferência interna',
  DEBITO_AUTOMATICO: 'Débito automático',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
  DINHEIRO: 'Dinheiro',
  CHEQUE: 'Cheque',
  COMPENSACAO: 'Compensação',
  OUTRO: 'Outro',
};

export const OPCOES_TIPO: OpcaoFiltro[] = opcoes(ROTULO_TIPO);
export const OPCOES_METODO: OpcaoFiltro[] = opcoes(ROTULO_METODO);

export const FILTRO_TIPO: DefinicaoFiltro = {
  name: 'type',
  label: 'Carteira',
  placeholder: 'Carteira',
  options: OPCOES_TIPO,
};

export const FILTRO_STATUS_TITULO: DefinicaoFiltro = {
  name: 'status',
  label: 'Situação',
  placeholder: 'Situação',
  options: opcoes(ROTULO_STATUS_TITULO),
};

export const FILTRO_APROVACAO: DefinicaoFiltro = {
  name: 'approvalStatus',
  label: 'Aprovação',
  placeholder: 'Aprovação',
  options: opcoes(ROTULO_APROVACAO),
};

export const FILTRO_EM_ABERTO: DefinicaoFiltro = {
  name: 'openOnly',
  label: 'Saldo',
  placeholder: 'Saldo',
  options: [{ value: 'true', label: 'Somente com saldo em aberto' }],
};

/** Traduz a barra de filtros para `QueryFinancialEntryDto` (período = vencimento). */
export function consultaTitulo(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    type: filtros['type'] || undefined,
    status: filtros['status'] || undefined,
    approvalStatus: filtros['approvalStatus'] || undefined,
    categoryId: filtros['categoryId'] || undefined,
    costCenterId: filtros['costCenterId'] || undefined,
    dueFrom: filtros['from'] || undefined,
    dueTo: filtros['to'] || undefined,
    openOnly: filtros['openOnly'] === 'true' ? true : undefined,
  };
}

const SITUACOES_ABERTAS: EntryStatus[] = ['ABERTO', 'PARCIALMENTE_LIQUIDADO'];

/** Título que ainda aceita edição, baixa ou cancelamento. */
export function tituloAberto(titulo: Pick<FinancialEntry, 'status'>): boolean {
  return SITUACOES_ABERTAS.includes(titulo.status);
}

/**
 * A baixa só é oferecida a título aberto e liberado pela alçada: pendente e
 * reprovado são recusados pelo servidor (RF-056), e o botão não deve prometer
 * o que a API vai negar.
 */
export function aceitaBaixa(titulo: Pick<FinancialEntry, 'status' | 'approvalStatus'>): boolean {
  return (
    tituloAberto(titulo) &&
    (titulo.approvalStatus === 'NAO_REQUERIDA' || titulo.approvalStatus === 'APROVADO')
  );
}

/** Nome da contraparte: fantasia do parceiro, razão social ou funcionário. */
export function contraparte(titulo: Pick<FinancialEntry, 'partner' | 'employee'>): string {
  return titulo.partner?.tradeName ?? titulo.partner?.legalName ?? titulo.employee?.name ?? '—';
}

// ---------------------------------------------------------------------------
// Inadimplência (RF-058)
// ---------------------------------------------------------------------------

export const ROTULO_FAIXA: Record<string, string> = {
  A_VENCER: 'A vencer',
  ATE_30: 'Até 30 dias',
  DE_31_A_60: '31 a 60 dias',
  DE_61_A_90: '61 a 90 dias',
  ACIMA_DE_90: 'Acima de 90 dias',
};

// ---------------------------------------------------------------------------
// Fluxo de caixa (RF-101 a RF-105)
// ---------------------------------------------------------------------------

export const ROTULO_SITUACAO_CAIXA: Record<CashSituation, string> = {
  REALIZADO: 'Realizado',
  VENCIDO: 'Vencido',
  PREVISTO: 'Previsto',
};

export const ROTULO_GRANULARIDADE: Record<CashFlowGranularity, string> = {
  DIA: 'Diário',
  SEMANA: 'Semanal',
  MES: 'Mensal',
};

export const OPCOES_GRANULARIDADE: OpcaoFiltro[] = opcoes(ROTULO_GRANULARIDADE);
