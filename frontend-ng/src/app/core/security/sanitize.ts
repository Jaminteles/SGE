/**
 * Sanitização de conteúdo vindo de fora da aplicação (RNF-002 — UI-089).
 *
 * "De fora" aqui é tudo que a interface não escreveu: texto digitado por um
 * usuário e devolvido pela API, nome de parceiro, descrição de título, endereço
 * de provedor de integração. O Angular já escapa interpolação — `{{ nome }}`
 * nunca vira marcação — então o risco que sobra não é o `<script>` na tela; são
 * os três abaixo, que passam por baixo do template:
 *
 * 1. **Fórmula em planilha**: `=HYPERLINK(...)` num campo exportado para CSV é
 *    executado pelo Excel ao abrir o arquivo. O exportador do backend já
 *    neutraliza (`common/export/csv.renderer.ts`); o da tela não neutralizava.
 * 2. **Esquema perigoso em link**: `javascript:` ou `data:` num `href` montado
 *    com valor da API executa no clique, sem `innerHTML` nenhum.
 * 3. **Caractere de controle**: quebra de linha e `\u0000` dentro de um valor
 *    que vai para arquivo, cabeçalho ou log corrompem o formato de destino.
 *
 * Nada disto substitui a validação do backend — é a camada da interface.
 */

/** Esquemas aceitos num link montado a partir de dado da API. */
const ESQUEMAS_SEGUROS = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Devolve a URL quando ela é navegável com segurança, ou `null`.
 *
 * Caminho relativo é aceito (fica na própria origem). `javascript:`, `data:` e
 * `vbscript:` são recusados mesmo escritos com espaço, maiúscula ou
 * caractere de controle no meio — que é como passam por comparação ingênua.
 */
export function urlSegura(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpo = valor.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (limpo === '') return null;

  // Relativo: sem esquema e sem `//` no começo (que herdaria o protocolo).
  if (!/^[a-z][a-z0-9+.-]*:/i.test(limpo)) {
    return limpo.startsWith('//') ? null : limpo;
  }

  try {
    const url = new URL(limpo);
    return ESQUEMAS_SEGUROS.includes(url.protocol.toLowerCase()) ? limpo : null;
  } catch {
    return null;
  }
}

/**
 * Texto de uma linha, sem caractere de controle e com tamanho limitado.
 *
 * Serve para o que sai da tela em outro formato — nome de arquivo, valor de
 * cabeçalho, mensagem de diagnóstico — onde uma quebra de linha do usuário vira
 * um registro a mais no arquivo de destino.
 */
export function textoSeguro(valor: unknown, limite = 500): string {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, limite);
}

/**
 * Neutraliza fórmula de planilha, exatamente como o backend faz.
 *
 * O apóstrofo à frente é a convenção que Excel, LibreOffice e Sheets entendem
 * como "isto é texto": o valor continua legível na célula e não é avaliado.
 */
export function celulaSegura(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
}
