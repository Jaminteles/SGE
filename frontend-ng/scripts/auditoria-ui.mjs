#!/usr/bin/env node
/**
 * Auditoria de acessibilidade e responsividade das telas entregues (UI-086).
 *
 * Não substitui teste de tela nem leitor de tela de verdade: o que ela pega são
 * as regras que dá para conferir no template e que, justamente por serem
 * repetitivas, escapam na revisão — ícone sem `aria-hidden`, botão só de ícone
 * sem nome acessível, `<th>` sem `scope`, `(click)` em `<div>`, largura fixa
 * larga o bastante para estourar a tela do celular.
 *
 * Roda sobre o fonte (`.ts` com template embutido e `.html`), porque é onde o
 * problema nasce. Uso:
 *
 *   npm run auditoria:ui          # relatório na saída padrão
 *   npm run auditoria:ui -- --ci  # sai com código 1 se houver achado
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/**
 * Duas famílias de regra, porque os dois problemas moram em lugares diferentes:
 *
 * - `tag`: olha o elemento inteiro, mesmo quebrado em dez linhas. Um
 *   `<p-button>` com `ariaLabel` na linha de baixo não é achado, e uma regra
 *   linha a linha diria que é — cento e vinte vezes.
 * - `linha`: olha uma linha de CSS, onde a declaração cabe inteira.
 */
const REGRAS = [
  {
    id: 'A11Y-1',
    tipo: 'tag',
    tag: 'i',
    titulo: 'Ícone sem papel definido',
    porque:
      'O leitor de tela lê o nome da fonte de ícones ou nada. Decorativo leva aria-hidden; significativo leva texto em .sr-only.',
    testar: (tag) =>
      /class="pi|\[class\]|class="\{\{/.test(tag) && !/aria-hidden|aria-label/.test(tag),
  },
  {
    id: 'A11Y-2',
    tipo: 'tag',
    tag: 'img',
    titulo: 'Imagem sem texto alternativo',
    porque: 'Sem alt, quem não enxerga não sabe o que a imagem informa (critério 1.1.1).',
    testar: (tag) => !/\balt\s*=/.test(tag),
  },
  {
    id: 'A11Y-3',
    tipo: 'tag',
    tag: 'button',
    titulo: 'Botão de ícone sem nome acessível',
    porque:
      'Botão cujo conteúdo é só um ícone é anunciado como "botão", sem dizer o que faz (critério 4.1.2).',
    testar: (tag, corpo) =>
      /icon|pi-/.test(tag + corpo) &&
      corpo.replace(/<[^>]*>/g, '').trim() === '' &&
      !/aria-label|ariaLabel|aria-labelledby|sr-only/.test(tag + corpo),
  },
  {
    id: 'A11Y-4',
    tipo: 'tag',
    tag: 'th',
    titulo: '<th> sem scope',
    porque:
      'Sem scope, o leitor de tela não sabe a que coluna a célula pertence numa tabela de listagem (critério 1.3.1).',
    // Cabeçalho vazio é a coluna de ações: não rotula coisa alguma.
    testar: (tag, corpo) => !/scope=/.test(tag) && corpo.trim() !== '',
  },
  {
    id: 'A11Y-5',
    tipo: 'tag',
    tag: 'p-button',
    titulo: 'p-button de ícone sem nome acessível',
    porque: 'Mesma coisa do A11Y-3, na versão PrimeNG: icon sem label e sem ariaLabel.',
    testar: (tag) =>
      /icon=|\[icon\]/.test(tag) && !/ariaLabel|aria-label|label=|\[label\]/.test(tag),
  },
  {
    id: 'A11Y-6',
    tipo: 'tag',
    tag: '(?:div|span|li|td|tr|p)',
    titulo: 'Clique em elemento não interativo',
    porque:
      'div e span não recebem foco nem respondem ao Enter: a ação fica fora do alcance do teclado (critério 2.1.1).',
    // Elemento com aria-hidden está fora da árvore de acessibilidade de
    // propósito (o véu da gaveta, por exemplo): o caminho de teclado é outro, e
    // dar foco a ele só acrescentaria uma parada de tabulação sem nome.
    testar: (tag) =>
      /\(click\)/.test(tag) &&
      !/tabindex/.test(tag) &&
      !/role=/.test(tag) &&
      !/aria-hidden="true"/.test(tag),
  },
  {
    id: 'RESP-1',
    tipo: 'linha',
    titulo: 'Largura fixa maior que a tela do celular',
    porque:
      'width/min-width acima de 420px não cabe num aparelho de 375px e força rolagem lateral.',
    testar: (linha) => {
      const m = /(?:^|[^-\w])(?:min-)?width:\s*(\d{3,})px/.exec(linha);
      return !!m && Number(m[1]) > 420;
    },
  },
  {
    id: 'RESP-2',
    tipo: 'linha',
    titulo: 'Grade de colunas fixas sem ponto de quebra',
    porque:
      'repeat(N, 1fr) com N>=3 espreme as colunas no celular; use auto-fit com minmax ou uma media query.',
    testar: (linha) => /grid-template-columns:\s*repeat\(\s*[3-9]\s*,/.test(linha),
    porArquivo: (conteudo) => !/@media/.test(conteudo),
  },
];

/** Linhas de comentário não são interface. */
function ignorar(linha) {
  const t = linha.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function arquivos(dir) {
  const saida = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      saida.push(...arquivos(caminho));
    } else if (/\.(ts|html)$/.test(nome) && !/\.spec\.ts$/.test(nome)) {
      saida.push(caminho);
    }
  }
  return saida;
}

/** Linha (1-based) de um deslocamento dentro do arquivo. */
function linhaDe(conteudo, indice) {
  return conteudo.slice(0, indice).split('\n').length;
}

/** Ocorrências de `<tag ...>`, com o conteúdo até o fechamento correspondente. */
function tags(conteudo, nome) {
  const achadas = [];
  for (const m of conteudo.matchAll(new RegExp('<' + nome + '\\b[^>]*>', 'gs'))) {
    const tag = m[0];
    let corpo = '';
    if (!tag.endsWith('/>')) {
      const nomeReal = /^<([\w-]+)/.exec(tag)[1];
      const fim = conteudo.indexOf('</' + nomeReal + '>', m.index + tag.length);
      corpo = fim > 0 ? conteudo.slice(m.index + tag.length, fim) : '';
    }
    achadas.push({ tag, corpo, indice: m.index });
  }
  return achadas;
}

const achados = [];
for (const caminho of arquivos(RAIZ)) {
  const conteudo = readFileSync(caminho, 'utf8');
  const arquivo = relative(RAIZ, caminho).split(sep).join('/');
  const linhas = conteudo.split(/\r?\n/);

  for (const regra of REGRAS) {
    if (regra.porArquivo && !regra.porArquivo(conteudo)) continue;

    if (regra.tipo === 'tag') {
      for (const { tag, corpo, indice } of tags(conteudo, regra.tag)) {
        if (!regra.testar(tag, corpo)) continue;
        achados.push({
          regra,
          arquivo,
          linha: linhaDe(conteudo, indice),
          trecho: tag.replace(/\s+/g, ' ').slice(0, 110),
        });
      }
      continue;
    }

    linhas.forEach((linha, i) => {
      if (ignorar(linha) || !regra.testar(linha)) return;
      achados.push({ regra, arquivo, linha: i + 1, trecho: linha.trim().slice(0, 110) });
    });
  }
}

const porRegra = new Map();
for (const achado of achados) {
  const lista = porRegra.get(achado.regra.id) ?? [];
  lista.push(achado);
  porRegra.set(achado.regra.id, lista);
}

console.log(`Auditoria de interface (UI-086) — ${achados.length} achado(s)\n`);
for (const regra of REGRAS) {
  const lista = porRegra.get(regra.id) ?? [];
  if (lista.length === 0) continue;
  console.log(`${regra.id} — ${regra.titulo} (${lista.length})`);
  console.log(`  ${regra.porque}`);
  for (const achado of lista) {
    console.log(`  src/${achado.arquivo}:${achado.linha}  ${achado.trecho}`);
  }
  console.log('');
}
if (achados.length === 0) console.log('Nenhum achado nas regras auditadas.');

if (process.argv.includes('--ci') && achados.length > 0) process.exit(1);
