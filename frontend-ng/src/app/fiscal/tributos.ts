import type {
  FiscalEventStatus,
  FiscalEventType,
  TaxClassification,
  TaxClassificationInput,
  TaxClassificationType,
  TaxClassificationUpdate,
  TaxOperationType,
  TaxParameter,
  TaxParameterInput,
  TaxParameterUpdate,
  TaxRegime,
  TaxRule,
  TaxRuleInput,
  TaxRuleUpdate,
} from '../core/api/types';
import type { OpcaoFiltro } from '../ui/filter-bar';
import type { Severidade } from './rotulos';

function opcoes<T extends string>(rotulos: Record<T, string>): OpcaoFiltro[] {
  return (Object.keys(rotulos) as T[]).map((valor) => ({ value: valor, label: rotulos[valor] }));
}

// ---------------------------------------------------------------------------
// Percentual (RN-012)
// ---------------------------------------------------------------------------

/**
 * `dom_percentual` é `numeric(9,6)`: de 0 a 100, com até seis casas.
 *
 * O mesmo padrão do `IsPercentage` do backend. Alíquota não passa por `number`
 * em momento algum — o que sai daqui é a string canônica que o Prisma converte
 * em `Decimal`.
 */
export const PADRAO_PERCENTUAL = /^(100(\.0{1,6})?|\d{1,2}(\.\d{1,6})?)$/;

export interface PercentualLido {
  /** Canônico ("18.5"), `null` quando o campo está vazio. */
  valor: string | null;
  erro: string | null;
}

/** Lê o percentual digitado em pt-BR ("18,5") e devolve o canônico ("18.5"). */
export function lerPercentual(entrada: string): PercentualLido {
  const texto = entrada.trim().replace(',', '.');
  if (texto === '') return { valor: null, erro: null };
  if (!PADRAO_PERCENTUAL.test(texto)) {
    return { valor: null, erro: 'Informe um percentual de 0 a 100, com até 6 casas.' };
  }
  return { valor: texto, erro: null };
}

/** Exibe o percentual sem zeros à direita inúteis: "18.500000" vira "18,5%". */
export function formatarPercentual(valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const limpo = valor.includes('.') ? valor.replace(/0+$/, '').replace(/\.$/, '') : valor;
  return `${limpo.replace('.', ',')}%`;
}

// ---------------------------------------------------------------------------
// Parâmetros fiscais (RF-088)
// ---------------------------------------------------------------------------

export const ROTULO_REGIME: Record<TaxRegime, string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
  MEI: 'MEI',
  IMUNE_ISENTO: 'Imune ou isento',
};

export const OPCOES_REGIME = opcoes(ROTULO_REGIME);

export interface FormParametro {
  id: string | null;
  branchId: string;
  taxRegime: TaxRegime;
  effectiveFrom: string;
  effectiveTo: string;
  simplesRate: string;
  issRate: string;
  ipiTaxpayer: boolean;
  taxSubstitute: boolean;
}

export function formParametroVazio(hoje: string): FormParametro {
  return {
    id: null,
    branchId: '',
    taxRegime: 'SIMPLES_NACIONAL',
    effectiveFrom: hoje,
    effectiveTo: '',
    simplesRate: '',
    issRate: '',
    ipiTaxpayer: false,
    taxSubstitute: false,
  };
}

export function formParametroDe(parametro: TaxParameter): FormParametro {
  return {
    id: parametro.id,
    branchId: parametro.branchId ?? '',
    taxRegime: parametro.taxRegime,
    effectiveFrom: parametro.effectiveFrom.slice(0, 10),
    effectiveTo: parametro.effectiveTo?.slice(0, 10) ?? '',
    simplesRate: parametro.simplesRate ?? '',
    issRate: parametro.issRate ?? '',
    ipiTaxpayer: parametro.ipiTaxpayer,
    taxSubstitute: parametro.taxSubstitute,
  };
}

/**
 * Regras que o backend aplica e a tela antecipa (RF-088).
 *
 * A alíquota do Simples fora do Simples não é campo a mais: é número que
 * entraria na apuração de quem não está nesse regime. A sobreposição de
 * vigências quem recusa é o banco (EXCLUDE, bd/18 §2) — aqui só se confere o
 * que dá para conferir sem consultar as outras linhas.
 */
export function problemaParametro(form: FormParametro): string | null {
  if (!form.effectiveFrom) return 'Informe o início da vigência.';
  if (form.effectiveTo && form.effectiveTo < form.effectiveFrom) {
    return 'O fim da vigência é anterior ao início.';
  }
  if (form.simplesRate && form.taxRegime !== 'SIMPLES_NACIONAL') {
    return 'A alíquota do Simples só vale no regime Simples Nacional.';
  }
  for (const [campo, valor] of [
    ['do Simples', form.simplesRate],
    ['do ISS', form.issRate],
  ] as const) {
    if (valor && lerPercentual(valor).erro) return `A alíquota ${campo} é inválida.`;
  }
  return null;
}

export function montarParametro(form: FormParametro): TaxParameterInput {
  const simples = lerPercentual(form.simplesRate).valor;
  const iss = lerPercentual(form.issRate).valor;
  return {
    taxRegime: form.taxRegime,
    effectiveFrom: form.effectiveFrom,
    ipiTaxpayer: form.ipiTaxpayer,
    taxSubstitute: form.taxSubstitute,
    ...(form.branchId ? { branchId: form.branchId } : {}),
    ...(form.effectiveTo ? { effectiveTo: form.effectiveTo } : {}),
    ...(simples ? { simplesRate: simples } : {}),
    ...(iss ? { issRate: iss } : {}),
  };
}

/**
 * Só o que mudou vai na alteração, e `branchId` nunca vai: mover o parâmetro de
 * filial trocaria o regime de um estabelecimento retroativamente. Campo apagado
 * vira `null` explícito — é como a API distingue "não mexi" de "removi".
 */
export function montarEdicaoParametro(
  form: FormParametro,
  atual: TaxParameter,
): TaxParameterUpdate {
  const corpo: TaxParameterUpdate = {};
  if (form.taxRegime !== atual.taxRegime) corpo.taxRegime = form.taxRegime;
  if (form.effectiveFrom !== atual.effectiveFrom.slice(0, 10)) {
    corpo.effectiveFrom = form.effectiveFrom;
  }
  const fim = form.effectiveTo || null;
  if (fim !== (atual.effectiveTo?.slice(0, 10) ?? null)) corpo.effectiveTo = fim;

  const simples = lerPercentual(form.simplesRate).valor;
  if (simples !== atual.simplesRate) corpo.simplesRate = simples;
  const iss = lerPercentual(form.issRate).valor;
  if (iss !== atual.issRate) corpo.issRate = iss;

  if (form.ipiTaxpayer !== atual.ipiTaxpayer) corpo.ipiTaxpayer = form.ipiTaxpayer;
  if (form.taxSubstitute !== atual.taxSubstitute) corpo.taxSubstitute = form.taxSubstitute;
  return corpo;
}

/** Vigência aberta ou já encerrada, para a etiqueta da lista. */
export function vigente(parametro: TaxParameter, hoje: string): boolean {
  const inicio = parametro.effectiveFrom.slice(0, 10);
  const fim = parametro.effectiveTo?.slice(0, 10) ?? null;
  return inicio <= hoje && (fim === null || fim >= hoje);
}

// ---------------------------------------------------------------------------
// Classificações fiscais (RF-089)
// ---------------------------------------------------------------------------

export const ROTULO_TIPO_CLASSIFICACAO: Record<TaxClassificationType, string> = {
  NCM: 'NCM',
  CEST: 'CEST',
  CFOP: 'CFOP',
  CST: 'CST',
  LC116: 'LC 116 (serviços)',
};

export const OPCOES_TIPO_CLASSIFICACAO = opcoes(ROTULO_TIPO_CLASSIFICACAO);

/**
 * Formato do código por tipo — os mesmos padrões do backend e do CHECK de
 * bd/18 §3. Repetidos aqui para que o erro apareça no campo, e não como 400.
 */
export const PADRAO_CODIGO: Record<TaxClassificationType, RegExp> = {
  NCM: /^\d{8}$/,
  CEST: /^\d{7}$/,
  CFOP: /^[1-7]\d{3}$/,
  CST: /^\d{2,4}$/,
  LC116: /^\d{2}\.\d{2}$/,
};

export const DICA_CODIGO: Record<TaxClassificationType, string> = {
  NCM: '8 dígitos, como 84713012',
  CEST: '7 dígitos, como 2106300',
  CFOP: '4 dígitos começando entre 1 e 7, como 1102',
  CST: '2 a 4 dígitos, como 060',
  LC116: 'No formato 00.00, como 07.02',
};

export interface FormClassificacao {
  id: string | null;
  type: TaxClassificationType;
  code: string;
  description: string;
  icmsRate: string;
  ipiRate: string;
  pisRate: string;
  cofinsRate: string;
}

export function formClassificacaoVazia(): FormClassificacao {
  return {
    id: null,
    type: 'NCM',
    code: '',
    description: '',
    icmsRate: '',
    ipiRate: '',
    pisRate: '',
    cofinsRate: '',
  };
}

export function formClassificacaoDe(item: TaxClassification): FormClassificacao {
  return {
    id: item.id,
    type: item.type,
    code: item.code,
    description: item.description,
    icmsRate: item.icmsRate ?? '',
    ipiRate: item.ipiRate ?? '',
    pisRate: item.pisRate ?? '',
    cofinsRate: item.cofinsRate ?? '',
  };
}

export function problemaClassificacao(form: FormClassificacao): string | null {
  if (form.description.trim().length < 2) return 'Descreva a classificação.';
  if (form.id === null && !PADRAO_CODIGO[form.type].test(form.code.trim())) {
    return `Código inválido para ${ROTULO_TIPO_CLASSIFICACAO[form.type]}: ${DICA_CODIGO[form.type]}.`;
  }
  for (const [nome, valor] of [
    ['ICMS', form.icmsRate],
    ['IPI', form.ipiRate],
    ['PIS', form.pisRate],
    ['COFINS', form.cofinsRate],
  ] as const) {
    if (valor && lerPercentual(valor).erro) return `A alíquota de ${nome} é inválida.`;
  }
  return null;
}

export function montarClassificacao(form: FormClassificacao): TaxClassificationInput {
  const taxa = (valor: string) => lerPercentual(valor).valor;
  const icms = taxa(form.icmsRate);
  const ipi = taxa(form.ipiRate);
  const pis = taxa(form.pisRate);
  const cofins = taxa(form.cofinsRate);
  return {
    type: form.type,
    code: form.code.trim(),
    description: form.description.trim(),
    ...(icms ? { icmsRate: icms } : {}),
    ...(ipi ? { ipiRate: ipi } : {}),
    ...(pis ? { pisRate: pis } : {}),
    ...(cofins ? { cofinsRate: cofins } : {}),
  };
}

/** Tipo e código ficam de fora: são a identidade da linha e já podem estar em notas. */
export function montarEdicaoClassificacao(
  form: FormClassificacao,
  atual: TaxClassification,
): TaxClassificationUpdate {
  const corpo: TaxClassificationUpdate = {};
  const descricao = form.description.trim();
  if (descricao !== atual.description) corpo.description = descricao;

  const campos = [
    ['icmsRate', form.icmsRate, atual.icmsRate],
    ['ipiRate', form.ipiRate, atual.ipiRate],
    ['pisRate', form.pisRate, atual.pisRate],
    ['cofinsRate', form.cofinsRate, atual.cofinsRate],
  ] as const;
  for (const [campo, digitado, gravado] of campos) {
    const valor = lerPercentual(digitado).valor;
    if (valor !== gravado) corpo[campo] = valor;
  }
  return corpo;
}

// ---------------------------------------------------------------------------
// Regras fiscais (RF-091)
// ---------------------------------------------------------------------------

export const ROTULO_OPERACAO: Record<TaxOperationType, string> = {
  COMPRA: 'Compra',
  VENDA: 'Venda',
  TRANSFERENCIA: 'Transferência',
  DEVOLUCAO: 'Devolução',
};

export const OPCOES_OPERACAO = opcoes(ROTULO_OPERACAO);

export const PADRAO_CFOP = /^[1-7]\d{3}$/;
export const PADRAO_UF = /^[A-Z]{2}$/;

export interface FormRegra {
  id: string | null;
  name: string;
  priority: string;
  operationType: TaxOperationType | '';
  originState: string;
  destinationState: string;
  classificationId: string;
  cfop: string;
  icmsCst: string;
  icmsRate: string;
  icmsBaseReduction: string;
  effectiveFrom: string;
  effectiveTo: string;
}

export function formRegraVazia(hoje: string): FormRegra {
  return {
    id: null,
    name: '',
    priority: '100',
    operationType: '',
    originState: '',
    destinationState: '',
    classificationId: '',
    cfop: '',
    icmsCst: '',
    icmsRate: '',
    icmsBaseReduction: '',
    effectiveFrom: hoje,
    effectiveTo: '',
  };
}

export function formRegraDe(regra: TaxRule): FormRegra {
  return {
    id: regra.id,
    name: regra.name,
    priority: String(regra.priority),
    operationType: regra.operationType ?? '',
    originState: regra.originState ?? '',
    destinationState: regra.destinationState ?? '',
    classificationId: regra.classificationId ?? '',
    cfop: regra.cfop ?? '',
    icmsCst: regra.icmsCst ?? '',
    icmsRate: regra.icmsRate ?? '',
    icmsBaseReduction: regra.icmsBaseReduction ?? '',
    effectiveFrom: regra.effectiveFrom.slice(0, 10),
    effectiveTo: regra.effectiveTo?.slice(0, 10) ?? '',
  };
}

/** Os critérios da regra, na ordem em que a resolução os pesa. */
function criterios(form: FormRegra): string[] {
  return [
    form.operationType,
    form.originState.trim(),
    form.destinationState.trim(),
    form.classificationId,
  ].filter((valor) => valor !== '');
}

/**
 * Regra sem critério casa com toda operação da empresa (bd/18 §5).
 *
 * Como a resolução ordena por prioridade, uma regra assim passaria a decidir a
 * tributação de tudo — inclusive do que já tem regra específica de prioridade
 * maior. Por isso o backend recusa, e a tela recusa antes.
 */
export function problemaRegra(form: FormRegra): string | null {
  if (form.name.trim().length < 2) return 'Dê um nome à regra.';

  const prioridade = Number(form.priority);
  if (!Number.isInteger(prioridade) || prioridade < 1 || prioridade > 999) {
    return 'A prioridade vai de 1 a 999 — o menor número decide primeiro.';
  }
  if (criterios(form).length === 0) {
    return 'Informe ao menos um critério: sem critério a regra passa a decidir toda operação da empresa.';
  }
  for (const [nome, valor] of [
    ['de origem', form.originState],
    ['de destino', form.destinationState],
  ] as const) {
    if (valor.trim() && !PADRAO_UF.test(valor.trim().toUpperCase())) {
      return `A UF ${nome} deve ter duas letras.`;
    }
  }
  if (form.cfop.trim() && !PADRAO_CFOP.test(form.cfop.trim())) {
    return 'O CFOP deve ter 4 dígitos e começar entre 1 e 7.';
  }
  for (const [nome, valor] of [
    ['do ICMS', form.icmsRate],
    ['de redução da base', form.icmsBaseReduction],
  ] as const) {
    if (valor && lerPercentual(valor).erro) return `A alíquota ${nome} é inválida.`;
  }
  if (form.effectiveTo && form.effectiveFrom && form.effectiveTo < form.effectiveFrom) {
    return 'O fim da vigência é anterior ao início.';
  }
  return null;
}

export function montarRegra(form: FormRegra): TaxRuleInput {
  const icms = lerPercentual(form.icmsRate).valor;
  const reducao = lerPercentual(form.icmsBaseReduction).valor;
  return {
    name: form.name.trim(),
    priority: Number(form.priority),
    ...(form.operationType ? { operationType: form.operationType } : {}),
    ...(form.originState.trim() ? { originState: form.originState.trim().toUpperCase() } : {}),
    ...(form.destinationState.trim()
      ? { destinationState: form.destinationState.trim().toUpperCase() }
      : {}),
    ...(form.classificationId ? { classificationId: form.classificationId } : {}),
    ...(form.cfop.trim() ? { cfop: form.cfop.trim() } : {}),
    ...(form.icmsCst.trim() ? { icmsCst: form.icmsCst.trim() } : {}),
    ...(icms ? { icmsRate: icms } : {}),
    ...(reducao ? { icmsBaseReduction: reducao } : {}),
    ...(form.effectiveFrom ? { effectiveFrom: form.effectiveFrom } : {}),
    ...(form.effectiveTo ? { effectiveTo: form.effectiveTo } : {}),
  };
}

/** Critério apagado vai como `null`: é assim que a API o remove. */
export function montarEdicaoRegra(form: FormRegra, atual: TaxRule): TaxRuleUpdate {
  const corpo: TaxRuleUpdate = {};
  const nome = form.name.trim();
  if (nome !== atual.name) corpo.name = nome;

  const prioridade = Number(form.priority);
  if (prioridade !== atual.priority) corpo.priority = prioridade;

  const texto = [
    ['operationType', form.operationType || null, atual.operationType],
    ['originState', form.originState.trim().toUpperCase() || null, atual.originState],
    ['destinationState', form.destinationState.trim().toUpperCase() || null, atual.destinationState],
    ['classificationId', form.classificationId || null, atual.classificationId],
    ['cfop', form.cfop.trim() || null, atual.cfop],
    ['icmsCst', form.icmsCst.trim() || null, atual.icmsCst],
  ] as const;
  for (const [campo, valor, gravado] of texto) {
    if (valor !== gravado) {
      (corpo as Record<string, unknown>)[campo] = valor;
    }
  }

  const icms = lerPercentual(form.icmsRate).valor;
  if (icms !== atual.icmsRate) corpo.icmsRate = icms;
  const reducao = lerPercentual(form.icmsBaseReduction).valor;
  if (reducao !== atual.icmsBaseReduction) corpo.icmsBaseReduction = reducao;

  if (form.effectiveFrom !== atual.effectiveFrom.slice(0, 10)) {
    corpo.effectiveFrom = form.effectiveFrom;
  }
  const fim = form.effectiveTo || null;
  if (fim !== (atual.effectiveTo?.slice(0, 10) ?? null)) corpo.effectiveTo = fim;
  return corpo;
}

/** Resumo legível dos critérios de uma regra, para a coluna da lista. */
export function resumoCriterios(regra: TaxRule, nomeClassificacao?: string): string {
  const partes: string[] = [];
  if (regra.operationType) partes.push(ROTULO_OPERACAO[regra.operationType]);
  if (regra.originState || regra.destinationState) {
    partes.push(`${regra.originState ?? '*'} → ${regra.destinationState ?? '*'}`);
  }
  if (regra.classificationId) partes.push(nomeClassificacao ?? 'Classificação específica');
  if (regra.productId) partes.push('Produto específico');
  if (regra.productCategoryId) partes.push('Categoria de produto');
  return partes.length > 0 ? partes.join(' · ') : 'Todas as operações';
}

// ---------------------------------------------------------------------------
// Eventos fiscais (RF-092/RF-094)
// ---------------------------------------------------------------------------

export const ROTULO_TIPO_EVENTO: Record<FiscalEventType, string> = {
  CANCELAMENTO: 'Cancelamento',
  CCE: 'Carta de correção',
  MANIFESTACAO: 'Manifestação do destinatário',
  INUTILIZACAO: 'Inutilização de numeração',
};

export const OPCOES_TIPO_EVENTO = opcoes(ROTULO_TIPO_EVENTO);

export const ROTULO_STATUS_EVENTO: Record<FiscalEventStatus, string> = {
  REGISTRADO: 'Registrado',
  TRANSMITIDO: 'Transmitido',
  AUTORIZADO: 'Autorizado',
  REJEITADO: 'Rejeitado',
};

export const OPCOES_STATUS_EVENTO = opcoes(ROTULO_STATUS_EVENTO);

const SEVERIDADE_EVENTO: Record<FiscalEventStatus, Severidade> = {
  REGISTRADO: 'secondary',
  TRANSMITIDO: 'info',
  AUTORIZADO: 'success',
  REJEITADO: 'danger',
};

export function severidadeEvento(status: FiscalEventStatus): Severidade {
  return SEVERIDADE_EVENTO[status];
}

/** Mínimo da justificativa no layout da SEFAZ (`MIN_JUSTIFICATION_LENGTH`). */
export const MINIMO_JUSTIFICATIVA = 15;

/** Cancelamento e carta de correção não existem sem motivo escrito. */
export function exigeJustificativa(tipo: FiscalEventType): boolean {
  return tipo === 'CANCELAMENTO' || tipo === 'CCE';
}

/**
 * Resposta do fisco não se revisa por retentativa nossa: só REGISTRADO e
 * TRANSMITIDO voltam para a fila (`TRANSMITTABLE`).
 */
export function transmissivel(status: FiscalEventStatus): boolean {
  return status === 'REGISTRADO' || status === 'TRANSMITIDO';
}

/** Situação terminal: o fisco já respondeu. */
export function respondido(status: FiscalEventStatus): boolean {
  return status === 'AUTORIZADO' || status === 'REJEITADO';
}

export interface FormEvento {
  type: FiscalEventType;
  justification: string;
}

export function problemaEvento(form: FormEvento, temDocumento: boolean): string | null {
  if (form.type !== 'INUTILIZACAO' && !temDocumento) {
    return 'Só a inutilização de numeração dispensa o documento.';
  }
  if (exigeJustificativa(form.type) && form.justification.trim().length < MINIMO_JUSTIFICATIVA) {
    return `A justificativa precisa de pelo menos ${MINIMO_JUSTIFICATIVA} caracteres.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Relatórios fiscais (RF-093)
// ---------------------------------------------------------------------------

export const ROTULO_SENTIDO: Record<string, string> = {
  ENTRADA: 'Entrada',
  SAIDA: 'Saída',
  INDEFINIDO: 'Sem sentido definido',
};

export const OPCOES_SENTIDO: OpcaoFiltro[] = [
  { value: 'ENTRADA', label: 'Entrada' },
  { value: 'SAIDA', label: 'Saída' },
];

export function rotuloSentido(sentido: string): string {
  return ROTULO_SENTIDO[sentido] ?? sentido;
}

/**
 * Recorte do relatório. O período é obrigatório e o fim não pode anteceder o
 * início — a apuração se entrega por competência.
 */
export function problemaRecorteFiscal(from: string, to: string): string | null {
  if (!from || !to) return 'Informe o período da apuração.';
  if (to < from) return 'A data final é anterior à inicial.';
  return null;
}

