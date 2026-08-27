import { PERMISSIONS } from '../../common/authorization/permission-catalog';

/**
 * Catálogo de relatórios exportáveis do M15 (RF-111/RF-113).
 *
 * A chave é fechada de propósito. A alternativa — receber o nome da view ou a
 * consulta no corpo — transformaria a rota de exportação num executor de SQL
 * arbitrário com o crachá de quem chamou.
 */
export const REPORT_KEYS = [
  'financeiro',
  'carteira',
  'fluxo-caixa',
  'compras-estoque',
  'pessoal',
  'contabil',
  'fiscal',
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

/**
 * Permissão adicional exigida por relatório, além de `reports:READ`.
 *
 * O M15 é uma porta de leitura sobre módulos que já têm dono. O relatório
 * contábil continua sendo contabilidade, e o fiscal continua sendo fiscal —
 * atravessar pelo M15 não pode ser o caminho curto para ver o que a permissão
 * do módulo de origem nega.
 */
export const REPORT_SOURCE_PERMISSION: Partial<Record<ReportKey, string>> = {
  contabil: PERMISSIONS.ACCOUNTING_REPORTS_READ,
  fiscal: PERMISSIONS.FISCAL_REPORTS_READ,
};

/** Título humano de cada relatório — vira o nome do arquivo exportado. */
export const REPORT_TITLES: Record<ReportKey, string> = {
  financeiro: 'Dashboard financeiro',
  carteira: 'Contas a pagar e a receber',
  'fluxo-caixa': 'Fluxo de caixa e resultado',
  'compras-estoque': 'Compras, estoque e fornecedores',
  pessoal: 'Funcionarios e centros de custo',
  contabil: 'Relatorio contabil',
  fiscal: 'Relatorio fiscal',
};

/**
 * Teto de linhas por seção de relatório.
 *
 * Um dashboard agregado não passa de algumas centenas de linhas por seção; se
 * passar, o recorte é que está errado. O limite existe para que um período de
 * dez anos não vire um PDF de mil páginas montado inteiro em memória.
 */
export const MAX_REPORT_ROWS = 5_000;
