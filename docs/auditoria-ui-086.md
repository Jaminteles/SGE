# Auditoria de acessibilidade e responsividade — UI-086

Escopo: todas as telas entregues até a Sprint 30 (`frontend-ng/src`), auditadas
na Sprint 31 contra WCAG 2.1 AA (UI-082) e uso em tablet e celular
(RNF-014 — UI-083).

## Como reproduzir

```bash
npm run auditoria:ui
```

O executável é `frontend-ng/scripts/auditoria-ui.mjs`. Ele lê o fonte (templates
embutidos em `.ts` e arquivos `.html`), não o DOM: o objetivo é pegar o problema
onde ele nasce e impedir que volte. Com `-- --ci` ele sai com código 1 quando há
achado, para servir de porta num pipeline.

A auditoria **não substitui** verificação manual com leitor de tela nem teste em
aparelho real. Ela cobre o que é mecânico e repetitivo — que é justamente o que
escapa na revisão de código, porque aparece duzentas vezes.

## Regras auditadas

| Regra | O que pega | Critério WCAG |
| --- | --- | --- |
| A11Y-1 | Ícone sem `aria-hidden` (decorativo) nem nome acessível | 1.1.1 |
| A11Y-2 | `<img>` sem `alt` | 1.1.1 |
| A11Y-3 | `<button>` só de ícone sem nome acessível | 4.1.2 |
| A11Y-4 | `<th>` sem `scope` | 1.3.1 |
| A11Y-5 | `p-button` com `icon` e sem `label`/`ariaLabel` | 4.1.2 |
| A11Y-6 | `(click)` em elemento não interativo sem `role`/`tabindex` | 2.1.1 |
| RESP-1 | Largura fixa acima de 420px | RNF-014 |
| RESP-2 | `grid-template-columns: repeat(N≥3, …)` sem ponto de quebra | RNF-014 |

## Achados e tratamento

Primeira execução: **343 achados brutos**, reduzidos a **213 reais** depois de a
auditoria passar a ler o elemento inteiro em vez de linha a linha — um
`<p-button>` com `ariaLabel` na linha seguinte não é um botão sem nome, e a
versão linha a linha acusava 123 desses. Execução final: **0 achados**.

| Regra | Achados | Tratamento |
| --- | --- | --- |
| A11Y-4 | 210 `<th>` em 21 arquivos | Corrigido: `scope="col"` em todo cabeçalho de coluna com conteúdo. `<th>` vazio (coluna de ações) não rotula nada e ficou como está. |
| A11Y-1 | 2 (plano de contas, detalhe de título) | Corrigido: `aria-hidden="true"`. Nos dois, o texto ao lado já diz o que o ícone ilustra, e o estado do chevron já sai do `aria-expanded` do botão. |
| A11Y-6 | 1 (véu da gaveta) | Não é defeito: o véu nasceu nesta sprint marcado `aria-hidden="true"`, e a saída por teclado é o `Esc` ou o próprio botão da gaveta. A regra passou a desconsiderar elementos fora da árvore de acessibilidade. |
| A11Y-2, A11Y-3, A11Y-5, RESP-1, RESP-2 | 0 | Nada a fazer. |

## Correções fora do alcance da auditoria automática

Encontradas na leitura das primitivas compartilhadas e corrigidas na mesma
sprint:

- `sge-select-field` calculava `aria-describedby` e **não o usava**: dica e erro
  não chegavam ao leitor de tela. Mesmo problema em `sge-search-select`.
  Corrigido pela diretiva `sgeDescribedBy`, que escreve o atributo no controle
  interno gerado pelo PrimeNG — escrever no elemento de fora não adianta, porque
  não é ele que tem o papel nem o foco.
- Os dois campos usavam `ariaLabelledBy` apontando para o **próprio id** do
  controle: o campo se rotulava por si mesmo. Passaram a apontar para o `<label>`.
- `sge-global-search` deixava as opções do `role="listbox"` na ordem de
  tabulação, o que quebra o padrão combobox (a navegação é por seta, com
  `aria-activedescendant`). Receberam `tabindex="-1"`.
- Seleção de empresa marcava a empresa ativa só com um ícone de check, sem texto.
- Períodos contábeis usavam `aria-label` num `<i>` sem papel, que boa parte dos
  leitores de tela descarta. Virou texto em `.sr-only`.

## Limites conhecidos

- A auditoria não mede **contraste de cor**: as cores vêm todas do preset
  (`theme/sge-preset.ts`) e resolvem por `light-dark()`, então a conferência é
  por par de tokens, não por template. Fica registrado como verificação manual
  pendente.
- Não verifica **ordem de leitura visual vs. DOM** nem **rótulo de campo
  associado**, que dependem de renderização.
- `RESP-1` e `RESP-2` olham CSS escrito no projeto; não alcançam largura vinda de
  token do PrimeNG.
- Tabela de listagem **não** vira cartão no celular: as listagens do SGE põem
  valor, vencimento e situação lado a lado para serem comparados. No estreito
  elas rolam na horizontal, e quem quer menos coluna usa o seletor de colunas
  (UI-078).
