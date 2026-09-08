import type { Consulta } from '../core/lib/list-state';
import type { DefinicaoFiltro, OpcaoFiltro, ValoresFiltro } from '../ui/filter-bar';
import type {
  ContractType,
  EmployeeStatus,
  HrEventType,
  PayrollItemType,
  ReimbursementStatus,
} from '../core/api/types';

/** Severidades aceitas pela `p-tag` do PrimeNG. */
export type Severidade = 'success' | 'warn' | 'danger' | 'info' | 'secondary';

// ---------------------------------------------------------------------------
// Situação funcional (RF-013)
// ---------------------------------------------------------------------------

export const ROTULO_STATUS: Record<EmployeeStatus, string> = {
  ATIVO: 'Ativo',
  AFASTADO: 'Afastado',
  FERIAS: 'Em férias',
  DESLIGADO: 'Desligado',
};

const SEVERIDADE_STATUS: Record<EmployeeStatus, Severidade> = {
  ATIVO: 'success',
  AFASTADO: 'warn',
  FERIAS: 'info',
  DESLIGADO: 'secondary',
};

export function severidadeStatus(status: EmployeeStatus): Severidade {
  return SEVERIDADE_STATUS[status] ?? 'secondary';
}

export const FILTRO_STATUS_FUNCIONARIO: DefinicaoFiltro = {
  name: 'status',
  label: 'Situação',
  placeholder: 'Situação',
  options: (Object.keys(ROTULO_STATUS) as EmployeeStatus[]).map((status) => ({
    value: status,
    label: ROTULO_STATUS[status],
  })),
};

/**
 * Traduz busca, situação e departamento para `QueryEmployeeDto`.
 *
 * Valor em branco não vira parâmetro: `status=` faria a API filtrar por string
 * vazia em vez de não filtrar.
 */
export function consultaFuncionario(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    status: filtros['status'] || undefined,
    departmentId: filtros['departmentId'] || undefined,
  };
}

// ---------------------------------------------------------------------------
// Contrato e histórico funcional (RF-015/RF-020)
// ---------------------------------------------------------------------------

export const ROTULO_CONTRATO: Record<ContractType, string> = {
  CLT: 'CLT',
  PJ: 'PJ',
  ESTAGIO: 'Estágio',
  TEMPORARIO: 'Temporário',
  APRENDIZ: 'Aprendiz',
};

export const OPCOES_CONTRATO: OpcaoFiltro[] = (Object.keys(ROTULO_CONTRATO) as ContractType[]).map(
  (tipo) => ({ value: tipo, label: ROTULO_CONTRATO[tipo] }),
);

export const ROTULO_EVENTO: Record<HrEventType, string> = {
  ADMISSAO: 'Admissão',
  PROMOCAO: 'Promoção',
  TRANSFERENCIA: 'Transferência',
  AFASTAMENTO: 'Afastamento',
  FERIAS: 'Férias',
  RETORNO: 'Retorno',
  DESLIGAMENTO: 'Desligamento',
  ALTERACAO_SALARIAL: 'Alteração salarial',
};

/**
 * Eventos que o usuário pode registrar. Admissão nasce do cadastro e
 * desligamento de `POST /employees/:id/terminate` — o backend recusa os dois
 * aqui, e oferecê-los na tela só produziria erro.
 */
export const OPCOES_EVENTO: OpcaoFiltro[] = (
  ['PROMOCAO', 'TRANSFERENCIA', 'AFASTAMENTO', 'FERIAS', 'RETORNO', 'ALTERACAO_SALARIAL'] as const
).map((tipo) => ({ value: tipo, label: ROTULO_EVENTO[tipo] }));

const SEVERIDADE_EVENTO: Record<HrEventType, Severidade> = {
  ADMISSAO: 'success',
  PROMOCAO: 'success',
  TRANSFERENCIA: 'info',
  AFASTAMENTO: 'warn',
  FERIAS: 'info',
  RETORNO: 'info',
  DESLIGAMENTO: 'danger',
  ALTERACAO_SALARIAL: 'success',
};

export function severidadeEvento(tipo: HrEventType): Severidade {
  return SEVERIDADE_EVENTO[tipo] ?? 'secondary';
}

/** Eventos que carregam um novo salário — o backend exige o valor neles. */
export const EVENTOS_COM_SALARIO: HrEventType[] = ['PROMOCAO', 'ALTERACAO_SALARIAL'];

// ---------------------------------------------------------------------------
// Verbas de folha (RF-017/RF-021)
// ---------------------------------------------------------------------------

export const ROTULO_VERBA: Record<PayrollItemType, string> = {
  SALARIO: 'Salário',
  BENEFICIO: 'Benefício',
  DESCONTO: 'Desconto',
  ADICIONAL: 'Adicional',
  ENCARGO: 'Encargo',
};

export const OPCOES_VERBA: OpcaoFiltro[] = (Object.keys(ROTULO_VERBA) as PayrollItemType[]).map(
  (tipo) => ({ value: tipo, label: ROTULO_VERBA[tipo] }),
);

const SEVERIDADE_VERBA: Record<PayrollItemType, Severidade> = {
  SALARIO: 'success',
  BENEFICIO: 'info',
  DESCONTO: 'danger',
  ADICIONAL: 'success',
  ENCARGO: 'warn',
};

export function severidadeVerba(tipo: PayrollItemType): Severidade {
  return SEVERIDADE_VERBA[tipo] ?? 'secondary';
}

// ---------------------------------------------------------------------------
// Reembolsos (RF-018/RF-019)
// ---------------------------------------------------------------------------

export const ROTULO_REEMBOLSO: Record<ReimbursementStatus, string> = {
  RASCUNHO: 'Rascunho',
  SOLICITADO: 'Solicitado',
  EM_ANALISE: 'Em análise',
  APROVADO: 'Aprovado',
  REPROVADO: 'Reprovado',
  PAGO: 'Pago',
  CANCELADO: 'Cancelado',
};

const SEVERIDADE_REEMBOLSO: Record<ReimbursementStatus, Severidade> = {
  RASCUNHO: 'secondary',
  SOLICITADO: 'info',
  EM_ANALISE: 'warn',
  APROVADO: 'success',
  REPROVADO: 'danger',
  PAGO: 'success',
  CANCELADO: 'secondary',
};

export function severidadeReembolso(status: ReimbursementStatus): Severidade {
  return SEVERIDADE_REEMBOLSO[status] ?? 'secondary';
}

export const FILTRO_STATUS_REEMBOLSO: DefinicaoFiltro = {
  name: 'status',
  label: 'Situação',
  placeholder: 'Situação',
  options: (Object.keys(ROTULO_REEMBOLSO) as ReimbursementStatus[]).map((status) => ({
    value: status,
    label: ROTULO_REEMBOLSO[status],
  })),
};

/** Traduz busca e situação para `QueryReimbursementDto`. */
export function consultaReembolso(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    status: filtros['status'] || undefined,
  };
}

// ---------------------------------------------------------------------------
// Dados bancários (RF-013)
// ---------------------------------------------------------------------------

export const OPCOES_TIPO_CONTA: OpcaoFiltro[] = [
  { value: 'CORRENTE', label: 'Conta corrente' },
  { value: 'POUPANCA', label: 'Poupança' },
  { value: 'PAGAMENTO', label: 'Conta de pagamento' },
];

export const OPCOES_CHAVE_PIX: OpcaoFiltro[] = [
  { value: 'CPF', label: 'CPF' },
  { value: 'CNPJ', label: 'CNPJ' },
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'TELEFONE', label: 'Telefone' },
  { value: 'ALEATORIA', label: 'Aleatória' },
];
