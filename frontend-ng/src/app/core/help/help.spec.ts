import { describe, expect, it } from 'vitest';

import { AJUDA, ajudaPara, modulosSemAjuda } from './help-content';

describe('ajuda contextual por módulo (UI-092)', () => {
  it('cobre todos os módulos da navegação', () => {
    // Módulo novo sem ajuda escrita ganharia um botão que abre vazio.
    expect(modulosSemAjuda()).toEqual([]);
  });

  it('resolve pelo módulo, não pela rota exata', () => {
    expect(ajudaPara('/financeiro')?.titulo).toBe('Financeiro');
    expect(ajudaPara('/financeiro/titulos/abc-123')?.titulo).toBe('Financeiro');
    expect(ajudaPara('/conciliacao/movimentos/1?dias=5')?.titulo).toBe('Conciliação');
    expect(ajudaPara('/')?.titulo).toBe('Início');
  });

  it('não inventa ajuda para rota que não é módulo', () => {
    // Sem conteúdo, o botão nem aparece — melhor que abrir uma gaveta vazia.
    expect(ajudaPara('/preferencias')).toBeNull();
    expect(ajudaPara('/design-system')).toBeNull();
  });

  it('todo módulo tem resumo, passos e dúvidas — ajuda vazia não ajuda', () => {
    for (const modulo of AJUDA) {
      expect(modulo.resumo.length, modulo.path).toBeGreaterThan(20);
      expect(modulo.passos.length, modulo.path).toBeGreaterThan(0);
      expect(modulo.duvidas.length, modulo.path).toBeGreaterThan(0);
      for (const duvida of modulo.duvidas) {
        expect(duvida.resposta.length, `${modulo.path}: ${duvida.pergunta}`).toBeGreaterThan(20);
      }
    }
  });
});
