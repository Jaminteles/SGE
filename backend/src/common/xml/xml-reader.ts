import { BadRequestException } from '@nestjs/common';

/** Elemento lido da árvore — nome sem prefixo de namespace. */
export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  /** Texto imediato do elemento, já com as entidades resolvidas e aparado. */
  text: string;
}

/** Tetos do documento aceito. Existem para que um arquivo hostil pare aqui. */
export interface XmlLimits {
  maxBytes: number;
  maxDepth: number;
  maxNodes: number;
  maxTextLength: number;
}

export const DEFAULT_XML_LIMITS: XmlLimits = {
  // Uma NF-e de 990 itens fica perto de 1,5 MB; 2 MB cobre o caso extremo com
  // folga e ainda cabe na coluna `xml_conteudo` sem virar problema de I/O.
  maxBytes: 2 * 1024 * 1024,
  maxDepth: 40,
  maxNodes: 200_000,
  maxTextLength: 64 * 1024,
};

/** Entidades reconhecidas. Qualquer outra é recusada — ver `decodeEntities`. */
const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  apos: "'",
  quot: '"',
};

/**
 * Leitor de XML mínimo e estrito (RF-043).
 *
 * Escrito à mão, e de propósito: o XML de uma nota é entrada hostil por
 * definição — chega de fora, muitas vezes por integração automática — e as três
 * classes de ataque que importam aqui se fecham recusando construções, não
 * tratando-as:
 *
 *  - **XXE**: `<!DOCTYPE`/`<!ENTITY` são recusados antes de qualquer varredura.
 *    Sem declaração de entidade não há entidade externa para resolver, e este
 *    leitor não abre arquivo nem faz requisição em nenhuma circunstância;
 *  - **expansão exponencial** ("billion laughs"): consequência do mesmo corte,
 *    reforçada pelos tetos de nós e de texto;
 *  - **ReDoS**: a varredura é um laço de índice sobre a string. Nenhuma
 *    expressão regular toca o conteúdo recebido.
 *
 * O que ele **não** é: um parser de XML completo. Não resolve namespaces (só
 * descarta o prefixo), não valida contra schema e ignora comentários e
 * instruções de processamento. Para ler a estrutura fixa de uma NF-e é o
 * suficiente, e cada recurso ausente é uma superfície que não existe.
 */
export function parseXml(source: string, limits: XmlLimits = DEFAULT_XML_LIMITS): XmlNode {
  assertSafeSource(source, limits);

  let index = 0;
  let nodes = 0;
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;

  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open < 0) break;

    // Texto entre marcações pertence ao elemento aberto; fora da raiz, só espaço.
    if (open > index) {
      appendText(stack[stack.length - 1], source.slice(index, open), limits);
    }

    if (source.startsWith('<!--', open)) {
      index = skipUntil(source, open + 4, '-->') + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = skipUntil(source, open + 9, ']]>');
      // CDATA é texto literal: nada a decodificar dentro dele.
      appendRawText(stack[stack.length - 1], source.slice(open + 9, end), limits);
      index = end + 3;
      continue;
    }
    if (source.startsWith('<?', open)) {
      index = skipUntil(source, open + 2, '?>') + 2;
      continue;
    }

    const close = source.indexOf('>', open);
    if (close < 0) {
      throw invalid('marcação sem fechamento');
    }

    if (source[open + 1] === '/') {
      const name = localName(source.slice(open + 2, close).trim());
      const current = stack.pop();
      if (!current || current.name !== name) {
        throw invalid(`fechamento inesperado de \`${name}\``);
      }
      // O texto é aparado no fechamento, e não em cada pedaço: entre duas
      // seções CDATA o espaço do meio pertence ao valor.
      current.text = current.text.trim();
      index = close + 1;
      continue;
    }

    const selfClosing = source[close - 1] === '/';
    const raw = source.slice(open + 1, selfClosing ? close - 1 : close);
    if (++nodes > limits.maxNodes) {
      throw invalid(`documento com mais de ${limits.maxNodes} elementos`);
    }

    const node = parseTag(raw);
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else if (root) {
      throw invalid('documento com mais de um elemento raiz');
    } else {
      root = node;
    }

    if (!selfClosing) {
      stack.push(node);
      if (stack.length > limits.maxDepth) {
        throw invalid(`documento com mais de ${limits.maxDepth} níveis`);
      }
    }
    index = close + 1;
  }

  if (stack.length > 0) {
    throw invalid(`elemento \`${stack[stack.length - 1].name}\` não foi fechado`);
  }
  if (!root) {
    throw invalid('documento sem elemento raiz');
  }
  return root;
}

/** Primeiro filho do caminho informado, ou `undefined`. */
export function child(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
  let current = node;
  for (const name of path) {
    current = current?.children.find((c) => c.name === name);
    if (!current) return undefined;
  }
  return current;
}

/** Todos os filhos diretos com o nome informado, na ordem do documento. */
export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((c) => c.name === name) ?? [];
}

/** Texto do caminho informado, ou `undefined` quando ausente ou vazio. */
export function text(node: XmlNode | undefined, ...path: string[]): string | undefined {
  const found = child(node, ...path);
  return found?.text ? found.text : undefined;
}

/**
 * Recusa o arquivo antes de varrer: tamanho, declaração de tipo de documento e
 * entidades. É aqui que XXE e expansão de entidade morrem.
 */
function assertSafeSource(source: string, limits: XmlLimits): void {
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw invalid('conteúdo vazio');
  }
  const bytes = Buffer.byteLength(source, 'utf8');
  if (bytes > limits.maxBytes) {
    throw invalid(`arquivo de ${bytes} bytes acima do limite de ${limits.maxBytes}`);
  }
  // `indexOf` sobre o texto em minúsculas: sem regex, sem retrocesso.
  const lowered = source.toLowerCase();
  for (const forbidden of ['<!doctype', '<!entity', '<!notation']) {
    if (lowered.includes(forbidden)) {
      throw invalid(`declaração \`${forbidden}\` não é aceita em documento fiscal`);
    }
  }
}

/** Nome e atributos de uma tag de abertura. */
function parseTag(raw: string): XmlNode {
  const trimmed = raw.trim();
  let cut = trimmed.length;
  for (let i = 0; i < trimmed.length; i++) {
    if (isSpace(trimmed[i])) {
      cut = i;
      break;
    }
  }

  const name = localName(trimmed.slice(0, cut));
  if (!name) {
    throw invalid('elemento sem nome');
  }

  const node: XmlNode = { name, attributes: {}, children: [], text: '' };
  let i = cut;
  while (i < trimmed.length) {
    while (i < trimmed.length && isSpace(trimmed[i])) i++;
    if (i >= trimmed.length) break;

    const eq = trimmed.indexOf('=', i);
    if (eq < 0) break;
    const attribute = localName(trimmed.slice(i, eq).trim());

    let j = eq + 1;
    while (j < trimmed.length && isSpace(trimmed[j])) j++;
    const quote = trimmed[j];
    if (quote !== '"' && quote !== "'") {
      throw invalid(`atributo \`${attribute}\` sem valor entre aspas`);
    }
    const end = trimmed.indexOf(quote, j + 1);
    if (end < 0) {
      throw invalid(`atributo \`${attribute}\` sem fechamento`);
    }
    if (attribute && attribute !== 'xmlns') {
      node.attributes[attribute] = decodeEntities(trimmed.slice(j + 1, end));
    }
    i = end + 1;
  }

  return node;
}

/** Descarta o prefixo de namespace: `nfe:infNFe` e `infNFe` são o mesmo campo. */
function localName(name: string): string {
  const colon = name.lastIndexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

function appendText(node: XmlNode | undefined, raw: string, limits: XmlLimits): void {
  if (!node) {
    // Texto fora da raiz só pode ser espaço em branco do arquivo formatado.
    if (raw.trim().length > 0) throw invalid('texto fora do elemento raiz');
    return;
  }
  appendRawText(node, decodeEntities(raw), limits);
}

function appendRawText(node: XmlNode | undefined, value: string, limits: XmlLimits): void {
  if (!node) {
    if (value.trim().length > 0) throw invalid('texto fora do elemento raiz');
    return;
  }
  const next = node.text + value;
  if (next.length > limits.maxTextLength) {
    throw invalid(
      `elemento \`${node.name}\` com texto acima de ${limits.maxTextLength} caracteres`,
    );
  }
  node.text = next;
}

/** Espaço em branco do XML (S, na gramática) — sem regex, por princípio. */
function isSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

/**
 * Resolve as cinco entidades predefinidas e as referências numéricas.
 *
 * Qualquer outro `&nome;` é recusado: como `<!ENTITY` não é aceito, uma entidade
 * nomeada desconhecida ou é arquivo corrompido ou é tentativa de injetá-la — nos
 * dois casos, decodificar em silêncio seria o erro.
 */
function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;

  let out = '';
  let i = 0;
  while (i < value.length) {
    const amp = value.indexOf('&', i);
    if (amp < 0) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, amp);

    const semicolon = value.indexOf(';', amp);
    // Limite curto: `&` seguido de texto longo sem `;` não é entidade nenhuma.
    if (semicolon < 0 || semicolon - amp > 12) {
      throw invalid('referência de entidade malformada');
    }

    const entity = value.slice(amp + 1, semicolon);
    if (entity.startsWith('#')) {
      const hex = entity[1] === 'x' || entity[1] === 'X';
      const digits = hex ? entity.slice(2) : entity.slice(1);
      const code = Number.parseInt(digits, hex ? 16 : 10);
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) {
        throw invalid(`referência numérica inválida \`&${entity};\``);
      }
      out += String.fromCodePoint(code);
    } else {
      const resolved = NAMED_ENTITIES[entity];
      if (resolved === undefined) {
        throw invalid(`entidade \`&${entity};\` não é aceita`);
      }
      out += resolved;
    }
    i = semicolon + 1;
  }
  return out;
}

function skipUntil(source: string, from: number, marker: string): number {
  const end = source.indexOf(marker, from);
  if (end < 0) {
    throw invalid(`bloco \`${marker}\` sem fechamento`);
  }
  return end;
}

/**
 * XML inválido é erro do cliente, não da API: quem enviou o arquivo é quem pode
 * corrigi-lo, e a mensagem diz o que está errado sem devolver o conteúdo.
 */
function invalid(reason: string): BadRequestException {
  return new BadRequestException(`XML inválido: ${reason}.`);
}
