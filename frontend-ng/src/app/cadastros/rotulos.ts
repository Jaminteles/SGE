import type { Consulta } from '../core/lib/list-state';
import type { DefinicaoFiltro, OpcaoFiltro, ValoresFiltro } from '../ui/filter-bar';
import type {
  ItemType,
  PartnerAddressType,
  PaymentMethodType,
  PersonType,
} from '../core/api/types';

// ---------------------------------------------------------------------------
// Parceiros (RF-022 a RF-024)
// ---------------------------------------------------------------------------

export const ROTULO_PESSOA: Record<PersonType, string> = {
  PF: 'Pessoa física',
  PJ: 'Pessoa jurídica',
  ESTRANGEIRO: 'Estrangeiro',
};

export const OPCOES_PESSOA: OpcaoFiltro[] = (Object.keys(ROTULO_PESSOA) as PersonType[]).map(
  (tipo) => ({ value: tipo, label: ROTULO_PESSOA[tipo] }),
);

export const FILTRO_PAPEL: DefinicaoFiltro = {
  name: 'role',
  label: 'Papel',
  placeholder: 'Papel',
  options: [
    { value: 'CLIENTE', label: 'Clientes' },
    { value: 'FORNECEDOR', label: 'Fornecedores' },
  ],
};

/**
 * Traduz busca, papel e situação para `QueryPartnerDto`.
 *
 * `role` vazio não vira parâmetro: mandar `role=` faria a API filtrar por
 * string vazia em vez de trazer todos os papéis.
 */
export function consultaParceiro(filtros: ValoresFiltro): Consulta {
  const situacao = filtros['situacao'] ?? '';
  return {
    q: filtros.q,
    role: filtros['role'] || undefined,
    isActive: situacao === '' ? undefined : situacao === 'true',
  };
}

/** Rótulo do papel exercido — a tabela é única, os papéis são flags. */
export function rotuloPapel(parceiro: { isCustomer: boolean; isSupplier: boolean }): string {
  if (parceiro.isCustomer && parceiro.isSupplier) return 'Cliente e fornecedor';
  if (parceiro.isCustomer) return 'Cliente';
  if (parceiro.isSupplier) return 'Fornecedor';
  return 'Sem papel';
}

export const ROTULO_ENDERECO: Record<PartnerAddressType, string> = {
  PRINCIPAL: 'Principal',
  COBRANCA: 'Cobrança',
  ENTREGA: 'Entrega',
  CORRESPONDENCIA: 'Correspondência',
};

export const OPCOES_ENDERECO: OpcaoFiltro[] = (
  Object.keys(ROTULO_ENDERECO) as PartnerAddressType[]
).map((tipo) => ({ value: tipo, label: ROTULO_ENDERECO[tipo] }));

// ---------------------------------------------------------------------------
// Condições e formas de pagamento (RF-026)
// ---------------------------------------------------------------------------

export const ROTULO_METODO: Record<PaymentMethodType, string> = {
  PIX: 'PIX',
  BOLETO: 'Boleto bancário',
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

export const OPCOES_METODO: OpcaoFiltro[] = (Object.keys(ROTULO_METODO) as PaymentMethodType[]).map(
  (metodo) => ({ value: metodo, label: ROTULO_METODO[metodo] }),
);

/**
 * Descreve o prazo da condição em uma linha, como no Figma.
 *
 * `firstDueDays = 0` é à vista: o primeiro vencimento cai na emissão.
 */
export function descricaoPrazo(condicao: {
  installments: number;
  intervalDays: number;
  firstDueDays: number;
}): string {
  const primeiro =
    condicao.firstDueDays === 0 ? 'Data da emissão' : `${condicao.firstDueDays} dias após emissão`;
  if (condicao.installments <= 1) return primeiro;
  return `${primeiro} · ${condicao.installments}x a cada ${condicao.intervalDays} dias`;
}

// ---------------------------------------------------------------------------
// Catálogo (RF-028 a RF-030)
// ---------------------------------------------------------------------------

export const ROTULO_ITEM: Record<ItemType, string> = {
  PRODUTO: 'Produto',
  SERVICO: 'Serviço',
  MATERIA_PRIMA: 'Matéria-prima',
  ATIVO_IMOBILIZADO: 'Ativo imobilizado',
};

export const OPCOES_ITEM: OpcaoFiltro[] = (Object.keys(ROTULO_ITEM) as ItemType[]).map((tipo) => ({
  value: tipo,
  label: ROTULO_ITEM[tipo],
}));

export const FILTRO_TIPO_ITEM: DefinicaoFiltro = {
  name: 'type',
  label: 'Tipo',
  placeholder: 'Tipo',
  options: OPCOES_ITEM,
};

/** Traduz busca, tipo, categoria e situação para `QueryProductDto`. */
export function consultaProduto(filtros: ValoresFiltro): Consulta {
  const situacao = filtros['situacao'] ?? '';
  return {
    q: filtros.q,
    type: filtros['type'] || undefined,
    categoryId: filtros['categoryId'] || undefined,
    isActive: situacao === '' ? undefined : situacao === 'true',
  };
}

/**
 * Origem da mercadoria na tabela da SEFAZ (0 a 8). Só os rótulos curtos: a
 * tabela completa é longa e o campo é uma escolha, não texto livre.
 */
export const OPCOES_ORIGEM: OpcaoFiltro[] = [
  { value: '0', label: '0 — Nacional' },
  { value: '1', label: '1 — Estrangeira, importação direta' },
  { value: '2', label: '2 — Estrangeira, mercado interno' },
  { value: '3', label: '3 — Nacional, importação > 40%' },
  { value: '4', label: '4 — Nacional, processos produtivos básicos' },
  { value: '5', label: '5 — Nacional, importação <= 40%' },
  { value: '6', label: '6 — Estrangeira, importação direta sem similar' },
  { value: '7', label: '7 — Estrangeira, mercado interno sem similar' },
  { value: '8', label: '8 — Nacional, importação > 70%' },
];
