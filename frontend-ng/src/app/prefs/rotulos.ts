/**
 * Nome de tela por chave de preferência (UI-078).
 *
 * A chave é o identificador que a listagem passa para `sge-data-table` e
 * `sge-filter-bar`; aqui ela vira o texto que o usuário lê na tela de
 * preferências. Chave sem tradução aparece como está — é melhor mostrar
 * `compras.pedidos` do que esconder um filtro salvo que o usuário criou.
 */
export const ROTULO_TELA: Record<string, string> = {
  'cadastros.parceiros': 'Cadastros · Clientes e fornecedores',
  'cadastros.produtos': 'Cadastros · Produtos',
  'compras.pedidos': 'Compras · Pedidos de compra',
  'estoque.saldos': 'Estoque · Saldos',
  'financeiro.titulos': 'Financeiro · Títulos',
  'fiscal.documentos': 'Fiscal · Documentos fiscais',
};

export function rotuloTela(chave: string): string {
  return ROTULO_TELA[chave] ?? chave;
}
