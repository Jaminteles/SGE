import type { CategoryInput, CostCenterInput, SettingInput } from '../core/api/types';

/**
 * Configuração inicial sugerida (RF-006 — UI-079).
 *
 * É ponto de partida, não regra: tudo o que o assistente cria é editável nas
 * telas de Administração, e nada aqui é exigido pelo backend. A intenção é que
 * uma empresa nova consiga lançar o primeiro título no mesmo dia, em vez de
 * parar para inventar um plano de categorias do zero.
 */

export const CATEGORIAS_SUGERIDAS: CategoryInput[] = [
  { code: '1', name: 'Receitas', type: 'RECEBER', acceptsEntry: false },
  { code: '1.1', name: 'Vendas de produtos', type: 'RECEBER', acceptsEntry: true },
  { code: '1.2', name: 'Prestação de serviços', type: 'RECEBER', acceptsEntry: true },
  { code: '1.3', name: 'Outras receitas', type: 'RECEBER', acceptsEntry: true },
  { code: '2', name: 'Despesas', type: 'PAGAR', acceptsEntry: false },
  { code: '2.1', name: 'Fornecedores e mercadorias', type: 'PAGAR', acceptsEntry: true },
  { code: '2.2', name: 'Folha de pagamento e encargos', type: 'PAGAR', acceptsEntry: true },
  { code: '2.3', name: 'Impostos e taxas', type: 'PAGAR', acceptsEntry: true },
  { code: '2.4', name: 'Despesas administrativas', type: 'PAGAR', acceptsEntry: true },
  { code: '2.5', name: 'Despesas financeiras', type: 'PAGAR', acceptsEntry: true },
];

export const CENTROS_SUGERIDOS: CostCenterInput[] = [
  { code: 'ADM', name: 'Administrativo', acceptsEntry: true },
  { code: 'COM', name: 'Comercial', acceptsEntry: true },
  { code: 'OPE', name: 'Operacional', acceptsEntry: true },
];

/**
 * Parâmetros financeiros e fiscais (RF-006).
 *
 * Ficam em `settings`, que é chave/valor por empresa: o backend guarda e
 * devolve, e cada módulo lê o que lhe interessa. Juros e multa entram como
 * string decimal, pelo mesmo motivo de todo valor financeiro no sistema — não
 * passam por `number` em lugar nenhum (RN-012).
 */
export const PARAMETROS_SUGERIDOS: SettingInput[] = [
  {
    scope: 'FINANCEIRO',
    key: 'juros_mora_mensal_percentual',
    value: '1.00',
    description: 'Juros de mora ao mês aplicados no atraso, em percentual.',
  },
  {
    scope: 'FINANCEIRO',
    key: 'multa_atraso_percentual',
    value: '2.00',
    description: 'Multa por atraso, em percentual sobre o valor do título.',
  },
  {
    scope: 'FINANCEIRO',
    key: 'tolerancia_atraso_dias',
    value: '0',
    description: 'Dias de tolerância antes de cobrar juros e multa.',
  },
  {
    scope: 'GERAL',
    key: 'moeda',
    value: 'BRL',
    description: 'Moeda dos valores lançados na empresa.',
  },
];

export const REGIMES_TRIBUTARIOS = [
  { value: 'SIMPLES_NACIONAL', label: 'Simples Nacional' },
  { value: 'LUCRO_PRESUMIDO', label: 'Lucro Presumido' },
  { value: 'LUCRO_REAL', label: 'Lucro Real' },
];

export function parametroRegime(regime: string): SettingInput {
  return {
    scope: 'FISCAL',
    key: 'regime_tributario',
    value: regime,
    description: 'Regime tributário da empresa, usado nos cálculos fiscais.',
  };
}
