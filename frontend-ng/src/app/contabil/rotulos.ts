import type {
  AccountClassification,
  AccountNature,
  AccountingPeriod,
  AccountingPeriodStatus,
  ClassifiableSource,
  IncomeStatement,
  IncomeStatementLine,
  JournalEntry,
  JournalEntryInput,
  JournalLineType,
  LedgerAccount,
  LedgerAccountInput,
  LedgerAccountNode,
  LedgerAccountType,
  LedgerAccountUpdate,
} from '../core/api/types';
import type { Severidade } from '../bancos/rotulos';
import { dataValida, deCentavos, paraCentavos } from '../financeiro/dinheiro';
import type { Consulta } from '../core/lib/list-state';
import type { DefinicaoFiltro, OpcaoFiltro, ValoresFiltro } from '../ui/filter-bar';

function opcoes<T extends string>(rotulos: Record<T, string>): OpcaoFiltro[] {
  return (Object.keys(rotulos) as T[]).map((valor) => ({ value: valor, label: rotulos[valor] }));
}

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** "03/2026" — período contábil é mês de competência. */
export function rotuloMes(ano: number, mes: number): string {
  return `${String(mes).padStart(2, '0')}/${ano}`;
}

// ---------------------------------------------------------------------------
// Plano de contas (RF-078/RF-079 — UI-054)
// ---------------------------------------------------------------------------

export const ROTULO_TIPO_CONTA: Record<LedgerAccountType, string> = {
  ATIVO: 'Ativo',
  PASSIVO: 'Passivo',
  PATRIMONIO_LIQUIDO: 'Patrimônio líquido',
  RECEITA: 'Receita',
  DESPESA: 'Despesa',
  CUSTO: 'Custo',
  COMPENSACAO: 'Compensação',
};

export const OPCOES_TIPO_CONTA = opcoes(ROTULO_TIPO_CONTA);

export const ROTULO_NATUREZA: Record<AccountNature, string> = {
  DEVEDORA: 'Devedora',
  CREDORA: 'Credora',
};

export const OPCOES_NATUREZA = opcoes(ROTULO_NATUREZA);

export type GrupoConta = 'PATRIMONIAL' | 'RESULTADO' | 'COMPENSACAO';

export const ROTULO_GRUPO: Record<GrupoConta, string> = {
  PATRIMONIAL: 'Patrimoniais',
  RESULTADO: 'De resultado',
  COMPENSACAO: 'Compensação',
};

/** Patrimoniais vão ao balanço; as de resultado, à DRE (RF-078). */
export function grupoDaConta(tipo: LedgerAccountType): GrupoConta {
  if (tipo === 'RECEITA' || tipo === 'DESPESA' || tipo === 'CUSTO') return 'RESULTADO';
  if (tipo === 'COMPENSACAO') return 'COMPENSACAO';
  return 'PATRIMONIAL';
}

/** Espelho de `NATURE_BY_TYPE` (RF-079). Compensação escolhe; os demais, não. */
export const NATUREZA_POR_TIPO: Record<LedgerAccountType, AccountNature | null> = {
  ATIVO: 'DEVEDORA',
  DESPESA: 'DEVEDORA',
  CUSTO: 'DEVEDORA',
  PASSIVO: 'CREDORA',
  PATRIMONIO_LIQUIDO: 'CREDORA',
  RECEITA: 'CREDORA',
  COMPENSACAO: null,
};

export const FILTRO_GRUPO_CONTA: DefinicaoFiltro = {
  name: 'grupo',
  label: 'Grupo',
  placeholder: 'Todas as contas',
  options: opcoes(ROTULO_GRUPO),
};

export const FILTRO_SITUACAO_CONTA: DefinicaoFiltro = {
  name: 'situacao',
  label: 'Situação',
  placeholder: 'Ativas e inativas',
  options: [
    { value: 'ativas', label: 'Somente ativas' },
    { value: 'inativas', label: 'Somente inativas' },
  ],
};

export interface LinhaArvore {
  conta: LedgerAccountNode;
  profundidade: number;
  temFilhas: boolean;
  recolhida: boolean;
}

/**
 * Achata a árvore para a tabela, respeitando o que está recolhido.
 *
 * Com busca ou filtro, a conta que casa aparece junto com os ancestrais — uma
 * analítica solta, sem o grupo, não diz onde está no plano.
 */
export function achatarArvore(
  raizes: LedgerAccountNode[],
  recolhidas: ReadonlySet<string>,
  filtros: ValoresFiltro,
): LinhaArvore[] {
  const termo = semAcento(filtros.q.trim());
  const grupo = filtros['grupo'] ?? '';
  const situacao = filtros['situacao'] ?? '';
  const filtrando = termo !== '' || grupo !== '' || situacao !== '';

  const casa = (conta: LedgerAccountNode): boolean =>
    (termo === '' || conta.code.startsWith(termo) || semAcento(conta.name).includes(termo)) &&
    (grupo === '' || grupoDaConta(conta.type) === grupo) &&
    (situacao === '' || (situacao === 'ativas') === conta.isActive);

  const visivel = new Map<string, boolean>();
  const marcar = (conta: LedgerAccountNode): boolean => {
    const algumaFilha = conta.children.map(marcar).some(Boolean);
    const resultado = casa(conta) || algumaFilha;
    visivel.set(conta.id, resultado);
    return resultado;
  };
  raizes.forEach(marcar);

  const linhas: LinhaArvore[] = [];
  const descer = (conta: LedgerAccountNode, profundidade: number): void => {
    if (!visivel.get(conta.id)) return;
    // Filtrando, tudo abre: esconder a conta que casou atrás de um grupo
    // recolhido faria a busca parecer vazia.
    const recolhida = !filtrando && recolhidas.has(conta.id);
    linhas.push({ conta, profundidade, temFilhas: conta.children.length > 0, recolhida });
    if (!recolhida) conta.children.forEach((filha) => descer(filha, profundidade + 1));
  };
  raizes.forEach((raiz) => descer(raiz, 0));
  return linhas;
}

/** Contas que recebem partida: analíticas e ativas, na ordem do código. */
export function contasAnaliticas(raizes: LedgerAccountNode[]): LedgerAccount[] {
  const resultado: LedgerAccount[] = [];
  const descer = (conta: LedgerAccountNode): void => {
    if (conta.acceptsEntry && conta.isActive) resultado.push(conta);
    conta.children.forEach(descer);
  };
  raizes.forEach(descer);
  return resultado.sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
}

/** Contas que podem ser pai: sintéticas (não recebem partida) e ativas. */
export function contasSinteticas(raizes: LedgerAccountNode[]): LedgerAccount[] {
  const resultado: LedgerAccount[] = [];
  const descer = (conta: LedgerAccountNode): void => {
    if (!conta.acceptsEntry && conta.isActive) resultado.push(conta);
    conta.children.forEach(descer);
  };
  raizes.forEach(descer);
  return resultado;
}

export function opcaoContaContabil(conta: Pick<LedgerAccount, 'id' | 'code' | 'name'>): OpcaoFiltro {
  return { value: conta.id, label: `${conta.code} — ${conta.name}` };
}

/** Busca local por código (prefixo) ou nome, sem acento — o plano já está na tela. */
export function filtrarOpcoes(opcoesDisponiveis: OpcaoFiltro[], termo: string, limite = 20): OpcaoFiltro[] {
  const busca = semAcento(termo.trim());
  const filtradas =
    busca === ''
      ? opcoesDisponiveis
      : opcoesDisponiveis.filter((opcao) => semAcento(opcao.label).includes(busca));
  return filtradas.slice(0, limite);
}

const CODIGO_CONTA = /^\d+(\.\d+)*$/;

export interface FormConta {
  code: string;
  shortCode: string;
  name: string;
  type: LedgerAccountType | '';
  nature: AccountNature | '';
  parentId: string;
  acceptsEntry: boolean;
  spedReferenceCode: string;
}

export function formContaVazio(pai?: Pick<LedgerAccount, 'id' | 'code' | 'type'>): FormConta {
  return {
    code: pai ? `${pai.code}.` : '',
    shortCode: '',
    name: '',
    type: pai?.type ?? '',
    nature: '',
    parentId: pai?.id ?? '',
    acceptsEntry: !!pai,
    spedReferenceCode: '',
  };
}

export function formDeConta(conta: LedgerAccount): FormConta {
  return {
    code: conta.code,
    shortCode: conta.shortCode ?? '',
    name: conta.name,
    type: conta.type,
    nature: conta.nature,
    parentId: conta.parentId ?? '',
    acceptsEntry: conta.acceptsEntry,
    spedReferenceCode: conta.spedReferenceCode ?? '',
  };
}

/**
 * Espelho de `CreateLedgerAccountDto` e de `LedgerAccountsService.create`: a
 * filha tem o tipo do pai (senão sai do grupo em que é somada) e o pai não pode
 * receber partida (o saldo entraria duas vezes no balancete).
 */
export function problemaConta(
  form: FormConta,
  pai: Pick<LedgerAccount, 'type' | 'acceptsEntry' | 'code'> | null,
): string | null {
  const codigo = form.code.trim();
  if (!codigo || codigo.length > 30 || !CODIGO_CONTA.test(codigo)) {
    return 'O código é estruturado por pontos, como 1.1.01.001 (até 30 caracteres).';
  }
  const nome = form.name.trim();
  if (nome.length < 2 || nome.length > 255) return 'O nome deve ter de 2 a 255 caracteres.';
  if (!form.type) return 'Escolha o tipo da conta.';
  if (form.type === 'COMPENSACAO' && !form.nature) {
    return 'Conta de compensação precisa da natureza: é a única que escolhe (RF-079).';
  }
  if (form.shortCode.trim().length > 15) return 'O código reduzido aceita até 15 caracteres.';
  if (form.spedReferenceCode.trim().length > 20) return 'A conta referencial aceita até 20 caracteres.';
  if (pai) {
    if (pai.type !== form.type) {
      return `A conta pai é do tipo ${ROTULO_TIPO_CONTA[pai.type]}: a filha precisa ser do mesmo tipo.`;
    }
    if (pai.acceptsEntry) {
      return `A conta ${pai.code} recebe lançamento e não pode ter filhas.`;
    }
  }
  return null;
}

export function montarConta(form: FormConta): LedgerAccountInput {
  const tipo = form.type as LedgerAccountType;
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    type: tipo,
    acceptsEntry: form.acceptsEntry,
    ...(form.shortCode.trim() ? { shortCode: form.shortCode.trim() } : {}),
    ...(form.spedReferenceCode.trim() ? { spedReferenceCode: form.spedReferenceCode.trim() } : {}),
    ...(form.parentId ? { parentId: form.parentId } : {}),
    // A natureza decorre do tipo; só compensação a informa (RF-079).
    ...(tipo === 'COMPENSACAO' && form.nature ? { nature: form.nature } : {}),
  };
}

/** Edição manda só o que mudou — código e tipo não são editáveis. */
export function montarEdicaoConta(form: FormConta, atual: LedgerAccount): LedgerAccountUpdate {
  const corpo: LedgerAccountUpdate = {};
  if (form.name.trim() !== atual.name) corpo.name = form.name.trim();
  if (form.shortCode.trim() && form.shortCode.trim() !== (atual.shortCode ?? '')) {
    corpo.shortCode = form.shortCode.trim();
  }
  if (form.spedReferenceCode.trim() && form.spedReferenceCode.trim() !== (atual.spedReferenceCode ?? '')) {
    corpo.spedReferenceCode = form.spedReferenceCode.trim();
  }
  if (form.acceptsEntry !== atual.acceptsEntry) corpo.acceptsEntry = form.acceptsEntry;
  return corpo;
}

// ---------------------------------------------------------------------------
// Classificação (RF-080 — UI-055)
// ---------------------------------------------------------------------------

export const ROTULO_ORIGEM_CLASSIFICAVEL: Record<ClassifiableSource, string> = {
  categories: 'Categorias financeiras',
  'payroll-items': 'Verbas de folha',
  'bank-accounts': 'Contas bancárias',
};

export const DICA_ORIGEM_CLASSIFICAVEL: Record<ClassifiableSource, string> = {
  categories: 'A natureza da receita ou despesa: decide em que linha da DRE o valor entra.',
  'payroll-items': 'Salário, benefício e desconto têm contas próprias (RF-021).',
  'bank-accounts': 'A conta de caixa: contrapartida de toda baixa.',
};

export const OPCOES_ORIGEM_CLASSIFICAVEL = opcoes(ROTULO_ORIGEM_CLASSIFICAVEL);

/** "1.1.01.001 — Caixa", ou vazio quando a origem ainda não tem conta. */
export function contaClassificada(item: AccountClassification): string {
  return item.ledgerAccountCode ? `${item.ledgerAccountCode} — ${item.ledgerAccountName ?? ''}` : '';
}

export function resumoClassificacao(itens: AccountClassification[]): { total: number; sem: number } {
  return { total: itens.length, sem: itens.filter((item) => !item.ledgerAccountId).length };
}

// ---------------------------------------------------------------------------
// Lançamentos (RF-081/RF-082 — UI-056)
// ---------------------------------------------------------------------------

export const ROTULO_ORIGEM_LANCAMENTO: Record<string, string> = {
  MANUAL: 'Manual',
  TITULO_BAIXA: 'Baixa de título',
  DOCUMENTO_FISCAL: 'Documento fiscal',
  ESTOQUE: 'Estoque',
  ESTORNO: 'Estorno',
};

export const FILTRO_ORIGEM_LANCAMENTO: DefinicaoFiltro = {
  name: 'origin',
  label: 'Origem',
  placeholder: 'Origem',
  options: opcoes(ROTULO_ORIGEM_LANCAMENTO),
};

export const ROTULO_LADO: Record<JournalLineType, string> = {
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
};

export const OPCOES_LADO = opcoes(ROTULO_LADO);

export function rotuloOrigemLancamento(origem: string | null): string {
  if (!origem) return 'Manual';
  return ROTULO_ORIGEM_LANCAMENTO[origem] ?? origem;
}

/** O documento que deu origem ao lançamento, quando há (RF-082). */
export function documentoDoLancamento(
  lancamento: Pick<JournalEntry, 'settlementId' | 'fiscalDocumentId' | 'reversalOfId' | 'batch'>,
): string {
  const partes: string[] = [];
  if (lancamento.settlementId) partes.push('Baixa de título');
  if (lancamento.fiscalDocumentId) partes.push('Documento fiscal');
  if (lancamento.reversalOfId) partes.push('Estorno de lançamento');
  if (lancamento.batch) partes.push(`Lote ${lancamento.batch}`);
  return partes.join(' · ') || '—';
}

/** Traduz a barra para `QueryJournalEntryDto`. */
export function consultaLancamentos(filtros: ValoresFiltro): Consulta {
  return {
    origin: filtros['origin'] || undefined,
    accountId: filtros['accountId'] || undefined,
    batch: filtros['batch'] || undefined,
    from: filtros['from'] || undefined,
    to: filtros['to'] || undefined,
  };
}

export interface FormPartida {
  accountId: string;
  type: JournalLineType;
  amount: string | null;
  costCenterId: string;
  extraHistory: string;
}

export interface FormLancamento {
  entryDate: string;
  competenceDate: string;
  history: string;
  batch: string;
  lines: FormPartida[];
}

export function partidaVazia(tipo: JournalLineType): FormPartida {
  return { accountId: '', type: tipo, amount: null, costCenterId: '', extraHistory: '' };
}

export function formLancamentoVazio(data: string): FormLancamento {
  return {
    entryDate: data,
    competenceDate: '',
    history: '',
    batch: '',
    lines: [partidaVazia('DEBITO'), partidaVazia('CREDITO')],
  };
}

export interface TotaisPartidas {
  debito: string;
  credito: string;
  /** Débito menos crédito: zero é o único valor aceito. */
  diferenca: string;
}

/** Soma em centavos `bigint` — prévia; o servidor confere em Decimal (RN-012). */
export function totaisPartidas(linhas: Pick<FormPartida, 'type' | 'amount'>[]): TotaisPartidas {
  let debito = 0n;
  let credito = 0n;
  for (const linha of linhas) {
    if (linha.type === 'DEBITO') debito += paraCentavos(linha.amount);
    else credito += paraCentavos(linha.amount);
  }
  return { debito: deCentavos(debito), credito: deCentavos(credito), diferenca: deCentavos(debito - credito) };
}

/** Competência efetiva: ausente, vale a data do lançamento (`CreateJournalEntryDto`). */
export function competenciaEfetiva(form: Pick<FormLancamento, 'entryDate' | 'competenceDate'>): string {
  return form.competenceDate || form.entryDate;
}

/** Período que contém a data (YYYY-MM-DD), pelo mês de competência. */
export function periodoDaData(periodos: AccountingPeriod[], data: string): AccountingPeriod | null {
  if (!dataValida(data)) return null;
  const [ano, mes] = data.split('-').map((parte) => Number.parseInt(parte, 10));
  return periodos.find((p) => p.year === ano && p.month === mes) ?? null;
}

/**
 * Por que a competência não aceita lançamento (RN-008), ou `null`.
 *
 * `periodos` nulo = a tela não pôde ler os períodos: sem essa informação não se
 * afirma nada, e quem responde é o servidor.
 */
export function bloqueioDaCompetencia(periodos: AccountingPeriod[] | null, data: string): string | null {
  if (periodos === null || !dataValida(data)) return null;
  const periodo = periodoDaData(periodos, data);
  const [ano, mes] = data.split('-').map((parte) => Number.parseInt(parte, 10));
  if (!periodo) {
    return `Não há período contábil para ${rotuloMes(ano, mes)}: abra o exercício em Contábil / Períodos.`;
  }
  if (periodo.status === 'FECHADO') {
    return `O período ${rotuloMes(ano, mes)} está fechado e não aceita lançamento. Reabra-o, com motivo, para lançar nele.`;
  }
  return null;
}

/**
 * Espelho de `CreateJournalEntryDto` e `JournalEntriesService` (RF-081): duas
 * partidas no mínimo, valores positivos, débito e crédito presentes e iguais.
 */
export function problemaLancamento(form: FormLancamento): string | null {
  if (!dataValida(form.entryDate)) return 'Informe a data do lançamento.';
  if (form.competenceDate && !dataValida(form.competenceDate)) return 'A competência é inválida.';
  const historico = form.history.trim();
  if (historico.length < 3 || historico.length > 500) return 'O histórico deve ter de 3 a 500 caracteres.';
  if (form.batch.trim().length > 30) return 'O lote aceita até 30 caracteres.';
  if (form.lines.length < 2) return 'O lançamento precisa de ao menos duas partidas.';
  if (form.lines.length > 200) return 'O lançamento aceita até 200 partidas.';

  for (const [indice, linha] of form.lines.entries()) {
    const n = indice + 1;
    if (!linha.accountId) return `Partida ${n}: escolha a conta analítica.`;
    if (!linha.amount || paraCentavos(linha.amount) <= 0n) {
      return `Partida ${n}: o valor é positivo — o lado (débito/crédito) é que dá o sinal.`;
    }
    if (linha.extraHistory.trim().length > 500) return `Partida ${n}: o complemento aceita até 500 caracteres.`;
  }

  const totais = totaisPartidas(form.lines);
  if (paraCentavos(totais.debito) === 0n || paraCentavos(totais.credito) === 0n) {
    return 'O lançamento precisa de ao menos um débito e um crédito.';
  }
  if (paraCentavos(totais.diferenca) !== 0n) {
    return 'Lançamento desbalanceado: a soma dos débitos precisa ser igual à dos créditos.';
  }
  return null;
}

export function montarLancamento(form: FormLancamento): JournalEntryInput {
  return {
    entryDate: form.entryDate,
    ...(form.competenceDate ? { competenceDate: form.competenceDate } : {}),
    history: form.history.trim(),
    ...(form.batch.trim() ? { batch: form.batch.trim() } : {}),
    lines: form.lines.map((linha) => ({
      accountId: linha.accountId,
      type: linha.type,
      amount: linha.amount as string,
      ...(linha.costCenterId ? { costCenterId: linha.costCenterId } : {}),
      ...(linha.extraHistory.trim() ? { extraHistory: linha.extraHistory.trim() } : {}),
    })),
  };
}

/** Motivo do estorno: `Length(5, 400)` em `ReverseJournalEntryDto`. */
export function problemaEstorno(motivo: string): string | null {
  const texto = motivo.trim();
  if (texto.length < 5) return 'Informe o motivo do estorno (mínimo de 5 caracteres).';
  if (texto.length > 400) return 'O motivo aceita até 400 caracteres.';
  return null;
}

// ---------------------------------------------------------------------------
// Relatórios (RF-083 a RF-085 — UI-057/UI-058)
// ---------------------------------------------------------------------------

/** Recorte de competência obrigatório e em ordem (`AccountingPeriodRangeDto`). */
export function problemaRecorte(de: string, ate: string): string | null {
  if (!dataValida(de) || !dataValida(ate)) return 'Informe o período (de e até).';
  if (de > ate) return 'A data inicial não pode ser posterior à final.';
  return null;
}

/** Primeiro e último dia do mês da data, em YYYY-MM-DD. */
export function mesDaData(data: string): { de: string; ate: string } {
  const [ano, mes] = data.split('-').map((parte) => Number.parseInt(parte, 10));
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const m = String(mes).padStart(2, '0');
  return { de: `${ano}-${m}-01`, ate: `${ano}-${m}-${String(ultimo).padStart(2, '0')}` };
}

/** Mesma data no exercício anterior; 29/02 vira 28/02. */
export function anoAnterior(data: string): string {
  const [ano, mes, dia] = data.split('-').map((parte) => Number.parseInt(parte, 10));
  const ultimo = new Date(Date.UTC(ano - 1, mes, 0)).getUTCDate();
  return `${ano - 1}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}

/** Saldo negativo na natureza da conta é o que se investiga no balancete. */
export function saldoInvertido(valor: string): boolean {
  return paraCentavos(valor) < 0n;
}

export type GrupoDre = 'revenue' | 'cost' | 'expense';

export interface LinhaComparativa {
  accountId: string;
  code: string;
  name: string;
  atual: string;
  anterior: string | null;
  variacao: string | null;
  percentual: string;
}

/**
 * Variação percentual em décimos, com `bigint` — sem ponto flutuante no caminho.
 * Base zero não tem percentual: "—".
 */
export function variacaoPercentual(atual: string, anterior: string | null): string {
  if (anterior === null) return '—';
  const base = paraCentavos(anterior);
  if (base === 0n) return '—';
  const diferenca = paraCentavos(atual) - base;
  const decimos = (diferenca * 1000n) / (base < 0n ? -base : base);
  const negativo = decimos < 0n;
  const absoluto = negativo ? -decimos : decimos;
  const sinal = negativo ? '−' : absoluto === 0n ? '' : '+';
  return `${sinal}${absoluto / 10n},${absoluto % 10n}%`;
}

function variacao(atual: string, anterior: string | null): string | null {
  return anterior === null ? null : deCentavos(paraCentavos(atual) - paraCentavos(anterior));
}

/** Junta as linhas de um grupo da DRE dos dois exercícios, pela conta. */
export function linhasComparativas(
  atual: IncomeStatementLine[],
  anterior: IncomeStatementLine[] | null,
): LinhaComparativa[] {
  const porConta = new Map<string, { base: IncomeStatementLine; atual: string; anterior: string | null }>();
  for (const linha of atual) {
    porConta.set(linha.accountId, { base: linha, atual: linha.amount, anterior: anterior ? '0.00' : null });
  }
  for (const linha of anterior ?? []) {
    const existente = porConta.get(linha.accountId);
    if (existente) existente.anterior = linha.amount;
    else porConta.set(linha.accountId, { base: linha, atual: '0.00', anterior: linha.amount });
  }
  return [...porConta.values()]
    .sort((a, b) => a.base.code.localeCompare(b.base.code, 'pt-BR', { numeric: true }))
    .map(({ base, atual: valorAtual, anterior: valorAnterior }) => ({
      accountId: base.accountId,
      code: base.code,
      name: base.name,
      atual: valorAtual,
      anterior: valorAnterior,
      variacao: variacao(valorAtual, valorAnterior),
      percentual: variacaoPercentual(valorAtual, valorAnterior),
    }));
}

export interface TotalComparativo {
  atual: string;
  anterior: string | null;
  variacao: string | null;
  percentual: string;
}

export function totalComparativo(atual: string, anterior: string | null): TotalComparativo {
  return { atual, anterior, variacao: variacao(atual, anterior), percentual: variacaoPercentual(atual, anterior) };
}

/** Os totais da DRE lado a lado — a estrutura que a tela desenha. */
export function resumoDre(atual: IncomeStatement, anterior: IncomeStatement | null) {
  return {
    revenue: totalComparativo(atual.revenue.total, anterior?.revenue.total ?? null),
    cost: totalComparativo(atual.cost.total, anterior?.cost.total ?? null),
    grossResult: totalComparativo(atual.grossResult, anterior?.grossResult ?? null),
    expense: totalComparativo(atual.expense.total, anterior?.expense.total ?? null),
    netResult: totalComparativo(atual.netResult, anterior?.netResult ?? null),
  };
}

// ---------------------------------------------------------------------------
// Períodos (RF-086 — UI-059)
// ---------------------------------------------------------------------------

export const ROTULO_STATUS_PERIODO: Record<AccountingPeriodStatus, string> = {
  ABERTO: 'Aberto',
  EM_FECHAMENTO: 'Em fechamento',
  FECHADO: 'Fechado',
  REABERTO: 'Reaberto',
};

export const SEVERIDADE_STATUS_PERIODO: Record<AccountingPeriodStatus, Severidade> = {
  ABERTO: 'success',
  EM_FECHAMENTO: 'warn',
  FECHADO: 'danger',
  REABERTO: 'info',
};

export const FILTRO_STATUS_PERIODO: DefinicaoFiltro = {
  name: 'status',
  label: 'Situação',
  placeholder: 'Todas as situações',
  options: opcoes(ROTULO_STATUS_PERIODO),
};

export interface AcoesPeriodo {
  iniciarFechamento: boolean;
  fechar: boolean;
  reabrir: boolean;
}

/** Espelho de `AccountingPeriodsService.close/reopen`: o que cada situação admite. */
export function acoesDoPeriodo(status: AccountingPeriodStatus): AcoesPeriodo {
  return {
    iniciarFechamento: status === 'ABERTO' || status === 'REABERTO',
    fechar: status !== 'FECHADO',
    reabrir: status === 'FECHADO',
  };
}

/**
 * O mês anterior ainda aberto impede o fechamento (`assertPreviousClosed`).
 * Considera só os meses carregados; o servidor confere de novo.
 */
export function anteriorAberto(periodos: AccountingPeriod[], alvo: AccountingPeriod): AccountingPeriod | null {
  const chave = (p: AccountingPeriod) => p.year * 12 + p.month;
  const anteriores = periodos
    .filter((p) => chave(p) < chave(alvo) && p.status !== 'FECHADO')
    .sort((a, b) => chave(b) - chave(a));
  return anteriores[0] ?? null;
}

/** Motivo da reabertura: `Length(5, 500)` em `ReopenAccountingPeriodDto`. */
export function problemaReabertura(motivo: string): string | null {
  const texto = motivo.trim();
  if (texto.length < 5) return 'Informe o motivo da reabertura (mínimo de 5 caracteres).';
  if (texto.length > 500) return 'O motivo aceita até 500 caracteres.';
  return null;
}

export function problemaExercicio(texto: string): string | null {
  if (!/^\d{4}$/.test(texto.trim())) return 'Informe o ano com quatro dígitos.';
  const ano = Number.parseInt(texto, 10);
  if (ano < 1900 || ano > 2999) return 'O exercício vai de 1900 a 2999.';
  return null;
}
