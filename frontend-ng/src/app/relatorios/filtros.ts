import { Injectable, signal } from '@angular/core';

import type { AgingBand, ReportFilter, ReportKey } from '../core/api/types';
import { mesDaData } from '../contabil/rotulos';
import { hoje } from '../financeiro/dinheiro';
import type { OpcaoFiltro } from '../ui/filter-bar';

/**
 * Recorte que o usuário monta na tela (RF-112).
 *
 * Tudo string, inclusive o que é opcional: o formulário não distingue "não
 * escolhi" de `undefined`, e é a conversão para a consulta que apaga o vazio.
 */
export interface FiltroRelatorio {
  from: string;
  to: string;
  branchId: string;
  categoryId: string;
  costCenterId: string;
  bankAccountId: string;
  partnerId: string;
}

/** Dimensões opcionais, na ordem em que a barra as desenha. */
export const DIMENSOES = [
  'branchId',
  'categoryId',
  'costCenterId',
  'bankAccountId',
  'partnerId',
] as const;

export type Dimensao = (typeof DIMENSOES)[number];

export const ROTULO_DIMENSAO: Record<Dimensao, string> = {
  branchId: 'Filial',
  categoryId: 'Categoria',
  costCenterId: 'Centro de custo',
  bankAccountId: 'Conta bancária',
  partnerId: 'Parceiro',
};

/** Permissão que libera cada lista de apoio da barra de filtros. */
export const PERMISSAO_DIMENSAO: Record<Dimensao, string> = {
  branchId: 'branches:READ',
  categoryId: 'categories:READ',
  costCenterId: 'cost-centers:READ',
  bankAccountId: 'company-bank-accounts:READ',
  partnerId: 'partners:READ',
};

/**
 * Mês corrente como recorte inicial.
 *
 * O servidor não assume período nenhum — a tela precisa escolher um, e escolher
 * na abertura o mês corrente é o único padrão que não surpreende: é o mesmo
 * recorte que a pessoa teria digitado.
 */
export function filtroPadrao(referencia = hoje()): FiltroRelatorio {
  const mes = mesDaData(referencia);
  return {
    from: mes.de,
    to: mes.ate,
    branchId: '',
    categoryId: '',
    costCenterId: '',
    bankAccountId: '',
    partnerId: '',
  };
}

export function problemaFiltro(filtro: FiltroRelatorio): string | null {
  if (!filtro.from || !filtro.to) return 'Informe o período do relatório.';
  if (filtro.to < filtro.from) return 'A data final é anterior à inicial.';
  return null;
}

/** Vira o `ReportFilterDto`: dimensão vazia não vai como parâmetro em branco. */
export function paraConsulta(filtro: FiltroRelatorio): ReportFilter {
  return {
    from: filtro.from,
    to: filtro.to,
    ...(filtro.branchId ? { branchId: filtro.branchId } : {}),
    ...(filtro.categoryId ? { categoryId: filtro.categoryId } : {}),
    ...(filtro.costCenterId ? { costCenterId: filtro.costCenterId } : {}),
    ...(filtro.bankAccountId ? { bankAccountId: filtro.bankAccountId } : {}),
    ...(filtro.partnerId ? { partnerId: filtro.partnerId } : {}),
  };
}

/** Quantas dimensões estão em uso — vira o contador da barra. */
export function dimensoesEmUso(filtro: FiltroRelatorio): number {
  return DIMENSOES.filter((dimensao) => filtro[dimensao] !== '').length;
}

/**
 * Estado do recorte no módulo de relatórios (RF-112).
 *
 * Fornecido na rota do módulo, e não em `root`: o recorte acompanha o usuário
 * ao trocar de painel — que é o pedido da task — mas morre ao sair de
 * Relatórios. Um filtro global sobreviveria à troca de empresa e faria um painel
 * abrir com o recorte de outra, que é o tipo de número que ninguém confere.
 */
@Injectable()
export class ReportFilterStore {
  readonly filtro = signal<FiltroRelatorio>(filtroPadrao());

  aplicar(filtro: FiltroRelatorio): void {
    this.filtro.set(filtro);
  }

  limpar(): void {
    this.filtro.set(filtroPadrao());
  }

  consulta(): ReportFilter {
    return paraConsulta(this.filtro());
  }
}

// ---------------------------------------------------------------------------
// Vocabulário dos painéis
// ---------------------------------------------------------------------------

export const ROTULO_FAIXA_ATRASO: Record<AgingBand, string> = {
  A_VENCER: 'A vencer',
  ATE_30: 'Até 30 dias',
  DE_31_A_60: 'De 31 a 60 dias',
  DE_61_A_90: 'De 61 a 90 dias',
  ACIMA_DE_90: 'Acima de 90 dias',
};

export function rotuloFaixa(faixa: string): string {
  return ROTULO_FAIXA_ATRASO[faixa as AgingBand] ?? faixa;
}

/** Situação do movimento no fluxo de caixa (`vw_fluxo_caixa_diario`). */
export const ROTULO_SITUACAO_CAIXA: Record<string, string> = {
  REALIZADO: 'Realizado',
  PREVISTO: 'Previsto',
  PROJETADO: 'Projetado',
};

export function rotuloSituacaoCaixa(situacao: string): string {
  return ROTULO_SITUACAO_CAIXA[situacao] ?? situacao;
}

/** Competência "2026-03-01" vira "03/2026" — a linha da tabela é mensal. */
export function competenciaLegivel(competencia: string): string {
  const [ano, mes] = competencia.split('-');
  return mes ? `${mes}/${ano}` : competencia;
}

// ---------------------------------------------------------------------------
// Exportação (RF-113)
// ---------------------------------------------------------------------------

export const ROTULO_RELATORIO: Record<ReportKey, string> = {
  financeiro: 'Dashboard financeiro',
  carteira: 'Contas a pagar e a receber',
  'fluxo-caixa': 'Fluxo de caixa e resultado',
  'compras-estoque': 'Compras, estoque e fornecedores',
  pessoal: 'Funcionários e centros de custo',
  contabil: 'Relatório contábil',
  fiscal: 'Relatório fiscal',
};

export const OPCOES_RELATORIO: OpcaoFiltro[] = (
  Object.keys(ROTULO_RELATORIO) as ReportKey[]
).map((chave) => ({ value: chave, label: ROTULO_RELATORIO[chave] }));

export const OPCOES_FORMATO: OpcaoFiltro[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'xlsx', label: 'XLSX (planilha)' },
  { value: 'csv', label: 'CSV' },
];

/**
 * Permissão do módulo de origem exigida além de `reports:EXPORT`
 * (`REPORT_SOURCE_PERMISSION`).
 *
 * O M15 é porta de leitura, não caminho curto: exportar o relatório contábil
 * pelo módulo de relatórios continua exigindo a permissão da contabilidade.
 */
export const PERMISSAO_ORIGEM: Partial<Record<ReportKey, string>> = {
  contabil: 'accounting-reports:READ',
  fiscal: 'fiscal-reports:READ',
};
