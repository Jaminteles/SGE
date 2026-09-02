import { describe, expect, it } from 'vitest';

import { toHttpParams } from './params';

describe('toHttpParams', () => {
  it('monta a query string com os valores preenchidos', () => {
    const params = toHttpParams({ page: 1, pageSize: 50, situacao: 'ATIVO' });
    expect(params.toString()).toBe('page=1&pageSize=50&situacao=ATIVO');
  });

  it('ignora valores vazios para não filtrar por string vazia', () => {
    const params = toHttpParams({
      busca: '',
      situacao: null,
      periodo: undefined,
      page: 1,
    });
    expect(params.toString()).toBe('page=1');
  });

  it('preserva zero e false, que são valores legítimos', () => {
    const params = toHttpParams({ page: 0, incluirInativos: false });
    expect(params.get('page')).toBe('0');
    expect(params.get('incluirInativos')).toBe('false');
  });

  it('devolve vazio quando não há filtro', () => {
    expect(toHttpParams(undefined).toString()).toBe('');
    expect(toHttpParams({}).toString()).toBe('');
  });
});
