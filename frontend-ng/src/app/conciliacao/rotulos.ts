import type {
  BankTransactionKind,
  PendingBankTransaction,
  Reconciliation,
  ReconciliationOrigin,
  ReconciliationRule,
  ReconciliationRuleInput,
  ReconciliationStatus,
  TransactionDirection,
} from '../core/api/types';
import { formatCurrency, formatDecimal } from '../core/lib/decimal';
import type { Consulta } from '../core/lib/list-state';
import { ROTULO_CONCILIACAO, ROTULO_SENTIDO, type Severidade } from '../bancos/rotulos';
import { comparar, deCentavos, paraCentavos, subtrair } from '../financeiro/dinheiro';
import type { DefinicaoFiltro, OpcaoFiltro, ValoresFiltro } from '../ui/filter-bar';

function opcoes<T extends string>(rotulos: Record<T, string>): OpcaoFiltro[] {
  return (Object.keys(rotulos) as T[]).map((valor) => ({ value: valor, label: rotulos[valor] }));
}

/** Tabela simples das amostras e listas curtas, sem paginação. */
export const ESTILO_TABELA = `
  .tabela-rolagem {
    overflow-x: auto;
  }
  .tabela {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }
  .tabela th,
  .tabela td {
    padding: 0.5rem 0.6rem;
    text-align: left;
    border-bottom: 1px solid var(--p-content-border-color);
    vertical-align: top;
  }
  .tabela th {
    color: var(--p-text-muted-color);
    font-weight: 500;
  }
  .numero {
    text-align: right !important;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .saida {
    color: var(--p-red-600, var(--p-text-color));
  }
  .vazio {
    padding: 1.5rem 0.5rem;
    text-align: center;
    font-size: 0.85rem;
    color: var(--p-text-muted-color);
  }
`;

// ---------------------------------------------------------------------------
// Movimentos pendentes e identificação (RF-071/RF-072)
// ---------------------------------------------------------------------------

export const ROTULO_NATUREZA: Record<BankTransactionKind, string> = {
  PIX: 'PIX',
  TED: 'TED',
  DOC: 'DOC',
  BOLETO: 'Boleto',
  TARIFA: 'Tarifa',
  RENDIMENTO: 'Rendimento',
  IMPOSTO: 'Imposto',
  ESTORNO: 'Estorno',
  TRANSFERENCIA_INTERNA: 'Transferência entre contas',
  OUTRO: 'Outro',
};

/** Situações que `GET /reconciliation/pending` aceita filtrar. */
const STATUS_PENDENTES: ReconciliationStatus[] = [
  'NAO_CONCILIADO',
  'SUGERIDO',
  'DIVERGENTE',
  'IGNORADO',
];

export const FILTRO_STATUS_PENDENTE: DefinicaoFiltro = {
  name: 'status',
  label: 'Situação',
  placeholder: 'Pendentes',
  options: STATUS_PENDENTES.map((status) => ({ value: status, label: ROTULO_CONCILIACAO[status] })),
};

/** Traduz a barra para `QueryPendingDto`. Sem situação, o servidor traz as pendentes. */
export function consultaPendentes(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    status: filtros['status'] || undefined,
    direction: filtros['direction'] || undefined,
    bankAccountId: filtros['bankAccountId'] || undefined,
    from: filtros['from'] || undefined,
    to: filtros['to'] || undefined,
  };
}

/** "PIX · Fornecedor X" — o que a identificação gravada conseguiu dizer. */
export function resumoIdentificacao(movimento: Pick<PendingBankTransaction, 'metadata'>): string | null {
  const identificacao = movimento.metadata?.identification;
  if (!identificacao) return null;
  const quem = identificacao.partnerName ?? identificacao.counterpartName;
  const natureza = ROTULO_NATUREZA[identificacao.kind] ?? identificacao.kind;
  return quem ? `${natureza} · ${quem}` : natureza;
}

/** Saída com sinal: o banco guarda o módulo e o sentido separados. */
export function valorComSinal(movimento: { amount: string; direction: TransactionDirection }): string {
  const texto = formatCurrency(movimento.amount);
  return movimento.direction === 'DEBITO' ? `− ${texto}` : texto;
}

export function rotuloSentido(direcao: TransactionDirection): string {
  return ROTULO_SENTIDO[direcao] ?? direcao;
}

// ---------------------------------------------------------------------------
// Sugestões e vínculo manual (RF-073/RF-074)
// ---------------------------------------------------------------------------

/** Acima disto a correspondência é inequívoca (`EXACT_MATCH_SCORE`). */
export const SCORE_INEQUIVOCO = '95';

/** "95%" / "72,5%" — o score é Decimal de 0 a 100 e não passa por `number`. */
export function rotuloScore(score: string | null | undefined): string {
  if (score === null || score === undefined || score === '') return '—';
  const texto = formatDecimal(score).replace(/,00$/, '').replace(/(,\d)0$/, '$1');
  return `${texto}%`;
}

export function severidadeScore(score: string | null | undefined): Severidade {
  if (!score) return 'secondary';
  if (comparar(score, SCORE_INEQUIVOCO) >= 0) return 'success';
  if (comparar(score, '60') >= 0) return 'info';
  return 'warn';
}

/** Dias entre vencimento e movimento, em texto. */
export function rotuloDistancia(dias: number): string {
  if (dias === 0) return 'no vencimento';
  const quantidade = Math.abs(dias);
  const unidade = quantidade === 1 ? 'dia' : 'dias';
  return dias > 0 ? `${quantidade} ${unidade} após o vencimento` : `${quantidade} ${unidade} antes do vencimento`;
}

/** Quanto do movimento ainda não foi atribuído: soma só os vínculos vivos. */
export function restanteMovimento(
  valor: string,
  vinculos: Pick<Reconciliation, 'reconciledAmount' | 'undoneAt'>[],
): string {
  const conciliado = vinculos
    .filter((vinculo) => !vinculo.undoneAt)
    .reduce((total, vinculo) => total + paraCentavos(vinculo.reconciledAmount), 0n);
  return deCentavos(paraCentavos(valor) - conciliado);
}

/** Valor proposto no vínculo: o que falta no movimento, limitado ao lançamento. */
export function valorProposto(restante: string, esperado: string): string {
  return deCentavos(paraCentavos(comparar(restante, esperado) <= 0 ? restante : esperado));
}

export interface DadosVinculo {
  valor: string | null;
  restante: string;
  esperado: string;
  justificativa: string;
}

/**
 * Espelho de `ReconciliationsService.create` (RF-074/RF-076): valor positivo,
 * dentro do que falta no movimento, e divergência só com justificativa. O
 * servidor confere de novo — e o trigger do banco confere a soma.
 */
export function problemaVinculo(dados: DadosVinculo): string | null {
  if (!dados.valor || paraCentavos(dados.valor) <= 0n) {
    return 'O valor conciliado precisa ser maior que zero.';
  }
  if (comparar(dados.valor, dados.restante) > 0) {
    return `O movimento só tem ${formatCurrency(dados.restante)} a conciliar.`;
  }
  const justificativa = dados.justificativa.trim();
  if (justificativa.length > 500) return 'A justificativa aceita até 500 caracteres.';
  const diferenca = subtrair(dados.valor, dados.esperado);
  if (paraCentavos(diferenca) !== 0n && justificativa.length < 3) {
    return `O valor difere do lançamento em ${formatCurrency(diferenca)}: justifique a divergência (RF-076).`;
  }
  return null;
}

/** Motivo de desfazer/ignorar: `Length(3, 500)` no DTO. */
export function problemaMotivo(motivo: string): string | null {
  const texto = motivo.trim();
  if (texto.length < 3) return 'Informe o motivo (mínimo de 3 caracteres).';
  if (texto.length > 500) return 'O motivo aceita até 500 caracteres.';
  return null;
}

/** O trigger recalcula a situação; ignorado só concilia depois de reaberto. */
export function aceitaVinculo(status: ReconciliationStatus, restante: string): boolean {
  return status !== 'IGNORADO' && paraCentavos(restante) > 0n;
}

// ---------------------------------------------------------------------------
// Histórico (RF-077)
// ---------------------------------------------------------------------------

export const ROTULO_ORIGEM: Record<ReconciliationOrigin, string> = {
  MANUAL: 'Manual',
  AUTOMATICA_REGRA: 'Automática por regra',
  AUTOMATICA_EXATA: 'Automática exata',
  IMPORTACAO: 'Importação',
};

export const FILTRO_ORIGEM: DefinicaoFiltro = {
  name: 'origin',
  label: 'Origem',
  placeholder: 'Origem',
  options: opcoes(ROTULO_ORIGEM),
};

export const FILTRO_VIGENCIA: DefinicaoFiltro = {
  name: 'vigencia',
  label: 'Vigência',
  placeholder: 'Inclusive desfeitas',
  options: [{ value: 'vigentes', label: 'Somente vigentes' }],
};

export const FILTRO_DIVERGENCIA: DefinicaoFiltro = {
  name: 'hasDivergence',
  label: 'Diferença',
  placeholder: 'Diferença',
  options: [
    { value: 'true', label: 'Com diferença' },
    { value: 'false', label: 'Sem diferença' },
  ],
};

/**
 * Traduz a barra para `QueryReconciliationDto`. O histórico entra com as
 * desfeitas: a trilha de desfazimento é o que se procura quando o extrato não
 * fecha (RF-077).
 */
export function consultaHistorico(filtros: ValoresFiltro): Consulta {
  const divergencia = filtros['hasDivergence'] ?? '';
  return {
    origin: filtros['origin'] || undefined,
    bankAccountId: filtros['bankAccountId'] || undefined,
    bankTransactionId: filtros['bankTransactionId'] || undefined,
    hasDivergence: divergencia === '' ? undefined : divergencia === 'true',
    includeUndone: filtros['vigencia'] !== 'vigentes',
    from: filtros['from'] || undefined,
    to: filtros['to'] || undefined,
  };
}

export function alvoVinculo(
  vinculo: Pick<Reconciliation, 'installmentId' | 'settlementId' | 'paymentTransactionId'>,
): string {
  const partes: string[] = [];
  if (vinculo.installmentId) partes.push('Parcela');
  if (vinculo.settlementId) partes.push('Baixa');
  if (vinculo.paymentTransactionId) partes.push('Ordem de pagamento');
  return partes.join(' + ') || '—';
}

// ---------------------------------------------------------------------------
// Regras (RF-075)
// ---------------------------------------------------------------------------

export type AcaoRegra = 'SUGERIR' | 'CONCILIAR' | 'IGNORAR';

export const ROTULO_ACAO: Record<AcaoRegra, string> = {
  SUGERIR: 'Somente sugerir',
  CONCILIAR: 'Conciliar sem revisão',
  IGNORAR: 'Marcar como ignorado',
};

export const OPCOES_ACAO = opcoes(ROTULO_ACAO);

export interface FormRegra {
  name: string;
  priority: string;
  dayTolerance: string;
  valueTolerance: string | null;
  isActive: boolean;
  direction: TransactionDirection | '';
  descriptionContains: string;
  documentEquals: string;
  counterpartDocument: string;
  minAmount: string | null;
  maxAmount: string | null;
  bankAccountId: string;
  acao: AcaoRegra;
  minScore: string | null;
}

export function formRegraVazio(): FormRegra {
  return {
    name: '',
    priority: '100',
    dayTolerance: '3',
    valueTolerance: '0.00',
    isActive: true,
    direction: '',
    descriptionContains: '',
    documentEquals: '',
    counterpartDocument: '',
    minAmount: null,
    maxAmount: null,
    bankAccountId: '',
    acao: 'SUGERIR',
    minScore: null,
  };
}

export function acaoDaRegra(regra: Pick<ReconciliationRule, 'actions'>): AcaoRegra {
  if (regra.actions.autoReconcile) return 'CONCILIAR';
  if (regra.actions.markIgnored) return 'IGNORAR';
  return 'SUGERIR';
}

export function formDeRegra(regra: ReconciliationRule): FormRegra {
  const c = regra.conditions;
  return {
    name: regra.name,
    priority: String(regra.priority),
    dayTolerance: String(regra.dayTolerance),
    valueTolerance: regra.valueTolerance,
    isActive: regra.isActive,
    direction: c.direction ?? '',
    descriptionContains: c.descriptionContains ?? '',
    documentEquals: c.documentEquals ?? '',
    counterpartDocument: c.counterpartDocument ?? '',
    minAmount: c.minAmount ?? null,
    maxAmount: c.maxAmount ?? null,
    bankAccountId: c.bankAccountId ?? '',
    acao: acaoDaRegra(regra),
    minScore: regra.actions.minScore ?? null,
  };
}

function inteiroEntre(texto: string, minimo: number, maximo: number): boolean {
  if (!/^\d+$/.test(texto.trim())) return false;
  const valor = Number.parseInt(texto, 10);
  return valor >= minimo && valor <= maximo;
}

function digitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

/**
 * Espelho de `assertCoherent` e do DTO da regra (RF-075): uma regra sem
 * condição casa com todo movimento, e conciliar sem piso de confiança aceita
 * correspondência fraca sem revisão. O servidor recusa as duas de novo.
 */
export function problemaRegra(form: FormRegra): string | null {
  const nome = form.name.trim();
  if (nome.length < 2 || nome.length > 120) return 'O nome deve ter de 2 a 120 caracteres.';
  if (!inteiroEntre(form.priority, 1, 1000)) return 'A prioridade é um inteiro de 1 a 1000.';
  if (!inteiroEntre(form.dayTolerance, 0, 60)) {
    return 'A tolerância de dias é um inteiro de 0 a 60.';
  }
  if (form.valueTolerance && paraCentavos(form.valueTolerance) < 0n) {
    return 'A tolerância de valor não pode ser negativa.';
  }

  const trecho = form.descriptionContains.trim();
  const documento = form.documentEquals.trim();
  const contraparte = digitos(form.counterpartDocument);
  const temCondicao =
    !!form.direction ||
    !!trecho ||
    !!documento ||
    !!contraparte ||
    !!form.minAmount ||
    !!form.maxAmount ||
    !!form.bankAccountId;
  if (!temCondicao) {
    return 'A regra precisa de ao menos uma condição: sem critério ela casa com todo movimento.';
  }
  if (trecho && (trecho.length < 2 || trecho.length > 120)) {
    return 'O trecho do histórico deve ter de 2 a 120 caracteres.';
  }
  if (documento.length > 60) return 'O documento aceita até 60 caracteres.';
  if (contraparte && contraparte.length !== 11 && contraparte.length !== 14) {
    return 'O documento da contraparte deve ser um CPF (11 dígitos) ou CNPJ (14 dígitos).';
  }
  if ((form.minAmount && paraCentavos(form.minAmount) < 0n) || (form.maxAmount && paraCentavos(form.maxAmount) < 0n)) {
    return 'A faixa de valor não aceita valores negativos.';
  }
  if (form.minAmount && form.maxAmount && comparar(form.minAmount, form.maxAmount) > 0) {
    return 'O valor mínimo não pode ser maior que o máximo.';
  }
  if (form.acao === 'CONCILIAR') {
    if (!form.minScore) return 'Conciliar sem revisão exige a confiança mínima.';
    if (paraCentavos(form.minScore) < 0n || comparar(form.minScore, '100') > 0) {
      return 'A confiança mínima vai de 0 a 100.';
    }
  }
  return null;
}

/** Monta o corpo só com as condições preenchidas: chave vazia viraria critério. */
export function montarRegra(form: FormRegra): ReconciliationRuleInput {
  const condicoes: ReconciliationRuleInput['conditions'] = {};
  if (form.direction) condicoes.direction = form.direction;
  if (form.descriptionContains.trim()) condicoes.descriptionContains = form.descriptionContains.trim();
  if (form.documentEquals.trim()) condicoes.documentEquals = form.documentEquals.trim();
  if (digitos(form.counterpartDocument)) condicoes.counterpartDocument = digitos(form.counterpartDocument);
  if (form.minAmount) condicoes.minAmount = form.minAmount;
  if (form.maxAmount) condicoes.maxAmount = form.maxAmount;
  if (form.bankAccountId) condicoes.bankAccountId = form.bankAccountId;

  const acoes: ReconciliationRuleInput['actions'] =
    form.acao === 'CONCILIAR'
      ? { autoReconcile: true, minScore: form.minScore ?? undefined }
      : form.acao === 'IGNORAR'
        ? { markIgnored: true }
        : {};

  return {
    name: form.name.trim(),
    priority: Number.parseInt(form.priority, 10),
    conditions: condicoes,
    actions: acoes,
    valueTolerance: form.valueTolerance ?? '0.00',
    dayTolerance: Number.parseInt(form.dayTolerance, 10),
    isActive: form.isActive,
  };
}

/** "Recebimento · histórico contém "TARIFA" · até R$ 50,00". */
export function resumoCondicoes(
  regra: Pick<ReconciliationRule, 'conditions'>,
  nomeConta: (id: string) => string,
): string {
  const c = regra.conditions;
  const partes: string[] = [];
  if (c.direction) partes.push(rotuloSentido(c.direction));
  if (c.bankAccountId) partes.push(`conta ${nomeConta(c.bankAccountId)}`);
  if (c.descriptionContains) partes.push(`histórico contém "${c.descriptionContains}"`);
  if (c.documentEquals) partes.push(`documento = ${c.documentEquals}`);
  if (c.counterpartDocument) partes.push(`contraparte ${c.counterpartDocument}`);
  if (c.minAmount && c.maxAmount) {
    partes.push(`de ${formatCurrency(c.minAmount)} a ${formatCurrency(c.maxAmount)}`);
  } else if (c.minAmount) {
    partes.push(`a partir de ${formatCurrency(c.minAmount)}`);
  } else if (c.maxAmount) {
    partes.push(`até ${formatCurrency(c.maxAmount)}`);
  }
  return partes.join(' · ') || '—';
}

export function resumoAcao(regra: Pick<ReconciliationRule, 'actions'>): string {
  const acao = acaoDaRegra(regra);
  if (acao === 'CONCILIAR') return `${ROTULO_ACAO.CONCILIAR} (confiança ≥ ${rotuloScore(regra.actions.minScore)})`;
  return ROTULO_ACAO[acao];
}

/** Período da execução automática: obrigatório e em ordem (`RunAutoReconciliationDto`). */
export function problemaExecucao(dados: { conta: string; de: string; ate: string }): string | null {
  if (!dados.conta) return 'Escolha a conta.';
  if (!dados.de || !dados.ate) return 'Informe o período: rodar sobre tudo trava a fila.';
  if (dados.de > dados.ate) return 'A data inicial não pode ser posterior à final.';
  return null;
}
