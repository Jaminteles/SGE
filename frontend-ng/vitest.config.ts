import { defineConfig } from 'vitest/config';

/**
 * Configuração do runner de testes.
 *
 * O construtor `@angular/build:unit-test` monta o ambiente (TestBed, polyfills,
 * jsdom); aqui ficam só as duas decisões que o padrão do Vitest erra para este
 * projeto:
 *
 * 1. `fileParallelism: false` — os arquivos de teste rodam **em série**. Os
 *    testes de rota montam a moldura inteira, carregam o módulo por
 *    `loadChildren` e esperam a aplicação estabilizar. Com os arquivos
 *    disputando os mesmos núcleos, essa espera estourava o tempo limite de
 *    forma intermitente: passavam sozinhos, falhavam na suíte. Em série a
 *    suíte leva mais tempo de relógio e para de mentir.
 * 2. `testTimeout` folgado — montar uma rota preguiçosa é mais lento que os 5s
 *    que o Vitest dá por padrão, sobretudo na primeira vez.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
