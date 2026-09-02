import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

/**
 * Tema do SGE, derivado do preset Aura do PrimeNG.
 *
 * Duas decisões de cor, ambas por causa do domínio:
 *
 * 1. **Primária violeta (iris), não verde nem azul.** O Aura vem com `emerald`
 *    como primária, e num sistema financeiro verde já significa "entrou
 *    dinheiro". Usar a mesma cor para "botão principal" e para "crédito"
 *    confunde a leitura de qualquer tabela de lançamento. Violeta deixa
 *    `emerald`, `amber` e `rose` livres para o significado financeiro.
 *
 * 2. **Superfície de carvão azulado, não zinco puro.** O Aura usa `slate` no
 *    claro e `zinc` no escuro. O zinco é neutro demais e faz a interface
 *    parecer cinza morta em telas grandes de tabela; um azulado leve dá
 *    profundidade sem puxar para o azul que a paleta antiga usava.
 *
 * A v3 do `@primeuix/themes` resolve claro/escuro com a função CSS
 * `light-dark()`: o primeiro valor vale no tema claro, o segundo no escuro.
 * Não existe mais o bloco `colorScheme: { light, dark }` das versões antigas.
 *
 * O índice mantém o mesmo papel de luminosidade nos dois temas (50 = mais
 * claro, 950 = mais escuro). Quem troca são os índices consumidos: no escuro,
 * `content.background` usa `surface.900` e o texto usa `surface.0`.
 */
export const SgePreset = definePreset(Aura, {
  semantic: {
    // Violeta "iris". Vale nos dois temas — o Aura já escolhe o tom certo:
    // `primary.color` é light-dark({primary.500}, {primary.400}), então o
    // escuro usa o 400, mais claro, que é o que se lê bem sobre carvão.
    primary: {
      50: '#f3f1ff',
      100: '#e9e5ff',
      200: '#d5cdff',
      300: '#b8a8ff',
      400: '#9a7dff',
      500: '#7f56ff',
      600: '#6d3ff2',
      700: '#5c2fd6',
      800: '#4c28ad',
      900: '#402589',
      950: '#26145e',
    },

    // Superfícies. Claro = slate (mantido), escuro = carvão azulado.
    surface: {
      0: '#ffffff',
      50: 'light-dark(#f8fafc, #f5f6fa)',
      100: 'light-dark(#f1f5f9, #e9ebf2)',
      200: 'light-dark(#e2e8f0, #d3d7e4)',
      300: 'light-dark(#cbd5e1, #aeb5cb)',
      400: 'light-dark(#94a3b8, #8b93ae)',
      500: 'light-dark(#64748b, #6a7291)',
      600: 'light-dark(#475569, #4e5570)',
      700: 'light-dark(#334155, #363c52)',
      800: 'light-dark(#1e293b, #232838)',
      900: 'light-dark(#0f172a, #171b27)',
      950: 'light-dark(#020617, #0e111a)',
    },

    // O anel de foco precisa ser visível sobre carvão — a UI-082 (WCAG 2.1 AA)
    // vai cobrar isso, então já entra certo.
    focusRing: {
      width: '2px',
      style: 'solid',
      color: '{primary.color}',
      offset: '2px',
    },

    formField: {
      borderRadius: '8px',
    },

    content: {
      borderRadius: '12px',
    },
  },
});
