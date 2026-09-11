import type {
  CompanyAccountType,
  CompanyBankAccount,
  JobStatus,
  PaymentMethodType,
  PaymentTransaction,
  PaymentTransactionStatus,
  ReconciliationStatus,
  StatementFormat,
  TransactionDirection,
} from '../core/api/types';
import type { Consulta } from '../core/lib/list-state';
import { ROTULO_METODO } from '../financeiro/rotulos';
import type { DefinicaoFiltro, OpcaoFiltro, ValoresFiltro } from '../ui/filter-bar';

/** Severidades aceitas pela `p-tag` do PrimeNG. */
export type Severidade = 'success' | 'warn' | 'danger' | 'info' | 'secondary';

function opcoes<T extends string>(rotulos: Record<T, string>): OpcaoFiltro[] {
  return (Object.keys(rotulos) as T[]).map((valor) => ({ value: valor, label: rotulos[valor] }));
}

// ---------------------------------------------------------------------------
// Contas (RF-059)
// ---------------------------------------------------------------------------

export const ROTULO_TIPO_CONTA: Record<CompanyAccountType, string> = {
  CORRENTE: 'Conta corrente',
  POUPANCA: 'Poupança',
  PAGAMENTO: 'Conta de pagamento',
};

export const OPCOES_TIPO_CONTA = opcoes(ROTULO_TIPO_CONTA);

export const FILTRO_SITUACAO_CONTA: DefinicaoFiltro = {
  name: 'situacao',
  label: 'Situação',
  placeholder: 'Situação',
  options: [
    { value: 'true', label: 'Ativas' },
    { value: 'false', label: 'Inativas' },
  ],
};

export const FILTRO_HABILITACAO: DefinicaoFiltro = {
  name: 'habilitacao',
  label: 'Movimentação',
  placeholder: 'Movimentação',
  options: [
    { value: 'pagar', label: 'Habilitadas a pagar' },
    { value: 'receber', label: 'Habilitadas a receber' },
  ],
};

/** Traduz a barra para `QueryCompanyAccountDto`. Vazio é "todas": não vai na URL. */
export function consultaConta(filtros: ValoresFiltro): Consulta {
  const situacao = filtros['situacao'] ?? '';
  const habilitacao = filtros['habilitacao'] ?? '';
  return {
    q: filtros.q,
    isActive: situacao === '' ? undefined : situacao === 'true',
    allowsPayment: habilitacao === 'pagar' ? true : undefined,
    allowsReceipt: habilitacao === 'receber' ? true : undefined,
  };
}

/** "341 · Ag 1234-5 · Conta 98765-0". */
export function identificacaoConta(
  conta: Pick<
    CompanyBankAccount,
    'bankCode' | 'agency' | 'agencyDigit' | 'account' | 'accountDigit'
  >,
): string {
  const agencia = conta.agencyDigit ? `${conta.agency}-${conta.agencyDigit}` : conta.agency;
  const numero = conta.accountDigit ? `${conta.account}-${conta.accountDigit}` : conta.account;
  return `${conta.bankCode} · Ag ${agencia} · Conta ${numero}`;
}

export function opcaoConta(conta: CompanyBankAccount): OpcaoFiltro {
  return { value: conta.id, label: `${conta.description} (${identificacaoConta(conta)})` };
}

// ---------------------------------------------------------------------------
// Ordens (RF-062 a RF-068)
// ---------------------------------------------------------------------------

/** Modalidades que a integração executa (`SUPPORTED_PAYMENT_METHODS`). */
export const METODOS_ORDEM: PaymentMethodType[] = [
  'PIX',
  'BOLETO',
  'TED',
  'DOC',
  'TRANSFERENCIA_INTERNA',
];

export const OPCOES_METODO_ORDEM: OpcaoFiltro[] = METODOS_ORDEM.map((metodo) => ({
  value: metodo,
  label: ROTULO_METODO[metodo],
}));

export const ROTULO_SENTIDO: Record<TransactionDirection, string> = {
  DEBITO: 'Pagamento',
  CREDITO: 'Recebimento',
};

export const OPCOES_SENTIDO = opcoes(ROTULO_SENTIDO);

export const ROTULO_STATUS_ORDEM: Record<PaymentTransactionStatus, string> = {
  CRIADA: 'Criada',
  AGENDADA: 'Agendada',
  ENFILEIRADA: 'Na fila',
  ENVIADA: 'Enviada ao banco',
  PROCESSANDO: 'Em processamento',
  CONFIRMADA: 'Confirmada',
  FALHA: 'Falhou',
  CANCELADA: 'Cancelada',
  ESTORNADA: 'Estornada',
  EXPIRADA: 'Expirada',
};

const SEVERIDADE_STATUS_ORDEM: Record<PaymentTransactionStatus, Severidade> = {
  CRIADA: 'secondary',
  AGENDADA: 'info',
  ENFILEIRADA: 'info',
  ENVIADA: 'info',
  PROCESSANDO: 'warn',
  CONFIRMADA: 'success',
  FALHA: 'danger',
  CANCELADA: 'secondary',
  ESTORNADA: 'warn',
  EXPIRADA: 'secondary',
};

export function severidadeOrdem(status: PaymentTransactionStatus): Severidade {
  return SEVERIDADE_STATUS_ORDEM[status] ?? 'secondary';
}

export const FILTRO_STATUS_ORDEM: DefinicaoFiltro = {
  name: 'status',
  label: 'Situação',
  placeholder: 'Situação',
  options: opcoes(ROTULO_STATUS_ORDEM),
};

export const FILTRO_METODO_ORDEM: DefinicaoFiltro = {
  name: 'method',
  label: 'Modalidade',
  placeholder: 'Modalidade',
  options: OPCOES_METODO_ORDEM,
};

export const FILTRO_SENTIDO: DefinicaoFiltro = {
  name: 'direction',
  label: 'Sentido',
  placeholder: 'Sentido',
  options: OPCOES_SENTIDO,
};

/** Traduz a barra para `QueryPaymentDto` (período = data de criação, inclusivo). */
export function consultaOrdem(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    status: filtros['status'] || undefined,
    method: filtros['method'] || undefined,
    direction: filtros['direction'] || undefined,
    bankAccountId: filtros['bankAccountId'] || undefined,
    createdFrom: filtros['from'] || undefined,
    createdTo: filtros['to'] || undefined,
  };
}

/** Ainda não saiu: cancela sem falar com o provedor (`NOT_YET_SENT`). */
const NAO_ENVIADAS: PaymentTransactionStatus[] = ['CRIADA', 'AGENDADA', 'ENFILEIRADA'];

/** Nada mais acontece com a ordem (`TERMINAL`). */
const TERMINAIS: PaymentTransactionStatus[] = ['CONFIRMADA', 'CANCELADA', 'ESTORNADA', 'EXPIRADA'];

export function ordemTerminal(ordem: Pick<PaymentTransaction, 'status'>): boolean {
  return TERMINAIS.includes(ordem.status);
}

/**
 * Cancelamento (RF-065), com a mesma regra do servidor: a que ainda não saiu
 * cancela sempre; a enviada, só se o provedor suportar. O servidor decide de
 * novo — o botão escondido é conveniência, não controle.
 */
export function aceitaCancelamento(
  ordem: Pick<PaymentTransaction, 'status' | 'cancellable'>,
): boolean {
  if (ordemTerminal(ordem)) return false;
  return NAO_ENVIADAS.includes(ordem.status) || ordem.cancellable;
}

/** Consulta ao provedor (RF-064): só com identificador externo e ordem viva. */
export function aceitaConsulta(ordem: Pick<PaymentTransaction, 'status' | 'externalId'>): boolean {
  return !!ordem.externalId && !ordemTerminal(ordem);
}

/** Confirmação manual: a ordem viva, inclusive a que falhou no envio. */
export function aceitaConfirmacao(ordem: Pick<PaymentTransaction, 'status'>): boolean {
  return !ordemTerminal(ordem);
}

/** Voltou para a fila depois de falha retentável (RF-070). */
export function emRetentativa(
  ordem: Pick<PaymentTransaction, 'status' | 'attempts'>,
): boolean {
  return !ordemTerminal(ordem) && ordem.status !== 'FALHA' && ordem.attempts > 0;
}

export function favorecido(
  ordem: Pick<PaymentTransaction, 'payeeName' | 'pixKey' | 'barcode' | 'payeeAccount'>,
): string {
  return ordem.payeeName ?? ordem.pixKey ?? ordem.payeeAccount ?? (ordem.barcode ? 'Boleto' : '—');
}

export function somenteDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

export interface DadosFavorecido {
  method: PaymentMethodType | '';
  pixKey: string;
  barcode: string;
  payeeBankCode: string;
  payeeAgency: string;
  payeeAccount: string;
  payeeDocument: string;
}

/**
 * Espelho de `assertPayee` (RF-062): cada modalidade tem o destino sem o qual
 * ela não existe. Recusar aqui poupa a requisição; o servidor confere de novo.
 */
export function problemaFavorecido(dados: DadosFavorecido): string | null {
  switch (dados.method) {
    case '':
      return 'Escolha a modalidade.';
    case 'PIX':
      return dados.pixKey.trim() ? null : 'Pagamento PIX exige a chave do favorecido.';
    case 'BOLETO': {
      const codigo = somenteDigitos(dados.barcode);
      if (!codigo) return 'Pagamento por boleto exige o código de barras.';
      return /^\d{44,48}$/.test(codigo)
        ? null
        : 'O código de barras deve ter 44 dígitos (ou 47/48 na linha digitável).';
    }
    case 'TED':
    case 'DOC': {
      const faltando =
        !somenteDigitos(dados.payeeBankCode) ||
        !somenteDigitos(dados.payeeAgency) ||
        !somenteDigitos(dados.payeeAccount) ||
        !somenteDigitos(dados.payeeDocument);
      if (faltando) return 'Transferência exige banco, agência, conta e CPF/CNPJ do favorecido.';
      return /^(\d{11}|\d{14})$/.test(somenteDigitos(dados.payeeDocument))
        ? null
        : 'O documento do favorecido deve ser um CPF (11 dígitos) ou CNPJ (14 dígitos).';
    }
    case 'TRANSFERENCIA_INTERNA':
      return somenteDigitos(dados.payeeAccount)
        ? null
        : 'Transferência interna exige a conta do favorecido.';
    default:
      return 'Modalidade não executada por integração bancária.';
  }
}

// ---------------------------------------------------------------------------
// Extratos e movimentos (RF-060/RF-071)
// ---------------------------------------------------------------------------

export const ROTULO_FORMATO: Record<StatementFormat, string> = {
  OFX: 'OFX',
  CSV: 'CSV',
  CNAB240: 'CNAB 240',
};

export const OPCOES_FORMATO = opcoes(ROTULO_FORMATO);

export const ROTULO_CONCILIACAO: Record<ReconciliationStatus, string> = {
  NAO_CONCILIADO: 'Não conciliado',
  SUGERIDO: 'Sugerido',
  CONCILIADO: 'Conciliado',
  DIVERGENTE: 'Divergente',
  IGNORADO: 'Ignorado',
};

const SEVERIDADE_CONCILIACAO: Record<ReconciliationStatus, Severidade> = {
  NAO_CONCILIADO: 'secondary',
  SUGERIDO: 'info',
  CONCILIADO: 'success',
  DIVERGENTE: 'danger',
  IGNORADO: 'secondary',
};

export function severidadeConciliacao(status: ReconciliationStatus): Severidade {
  return SEVERIDADE_CONCILIACAO[status] ?? 'secondary';
}

/** Traduz a barra para `QueryBankTransactionDto` (datas inclusivas). */
export function consultaMovimento(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    direction: filtros['direction'] || undefined,
    bankAccountId: filtros['bankAccountId'] || undefined,
    statementImportId: filtros['statementImportId'] || undefined,
    from: filtros['from'] || undefined,
    to: filtros['to'] || undefined,
  };
}

/** Teto do backend (`MAX_STATEMENT_BYTES`). */
export const LIMITE_EXTRATO_BYTES = 10 * 1024 * 1024;

const EXTENSOES_EXTRATO = ['.ofx', '.csv', '.txt', '.ret', '.rem', '.cnab'];

/** O que dá para recusar antes de gastar uma requisição. */
export function problemaExtrato(arquivo: File): string | null {
  if (arquivo.size === 0) return 'Arquivo vazio.';
  if (arquivo.size > LIMITE_EXTRATO_BYTES) return 'Maior que o limite de 10 MB.';
  const nome = arquivo.name.toLowerCase();
  if (!EXTENSOES_EXTRATO.some((extensao) => nome.endsWith(extensao))) {
    return 'Formato não reconhecido: envie OFX, CSV ou CNAB 240.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fila (RF-069/RF-070)
// ---------------------------------------------------------------------------

export const ROTULO_STATUS_JOB: Record<JobStatus, string> = {
  PENDENTE: 'Pendente',
  AGENDADO: 'Agendado',
  PROCESSANDO: 'Processando',
  CONCLUIDO: 'Concluído',
  FALHA: 'Falha',
  CANCELADO: 'Cancelado',
};

export const ROTULO_FILA: Record<string, string> = {
  pagamentos: 'Pagamentos',
  webhooks: 'Webhooks',
  conciliacao: 'Conciliação',
  ocr: 'OCR',
  notificacoes: 'Notificações',
  fiscal: 'Fiscal',
};

/** Nomes dos jobs de pagamento (`PAYMENT_JOBS`). */
export const ROTULO_JOB: Record<string, string> = {
  'payment.send': 'Envio de ordem ao banco',
  'payment.sync': 'Consulta de situação',
};
