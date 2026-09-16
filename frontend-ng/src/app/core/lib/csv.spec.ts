import { TestBed } from '@angular/core/testing';
import { runInInjectionContext, Injector } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import type { PaginatedResult } from '../api/types';
import { paraCsv, valorDoCampo } from './csv';
import { ListState } from './list-state';

describe('paraCsv (UI-080)', () => {
  it('usa ponto e vírgula, aspas e BOM — o que o Excel em português espera', () => {
    const csv = paraCsv(
      [{ legalName: 'Acme "A" LTDA', cnpj: '12345678000190', isActive: true }],
      [
        { campo: 'legalName', cabecalho: 'Razão social' },
        { campo: 'cnpj', cabecalho: 'CNPJ' },
        { campo: 'isActive', cabecalho: 'Ativo' },
      ],
    );

    const linhas = csv.split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(linhas[0]).toBe('﻿"Razão social";"CNPJ";"Ativo"');
    expect(linhas[1]).toBe('"Acme ""A"" LTDA";"12345678000190";"Sim"');
  });

  it('lê campo aninhado por caminho e deixa vazio o que não existe', () => {
    const linha = { partner: { legalName: 'Acme' }, category: null };
    expect(valorDoCampo(linha, 'partner.legalName')).toBe('Acme');
    expect(valorDoCampo(linha, 'category.name')).toBeUndefined();

    const csv = paraCsv(
      [linha],
      [
        { campo: 'partner.legalName', cabecalho: 'Fornecedor' },
        { campo: 'category.name', cabecalho: 'Categoria' },
      ],
    );
    expect(csv.split('\r\n')[1]).toBe('"Acme";""');
  });
});

describe('ListState.exportar (UI-080)', () => {
  interface Linha {
    id: string;
  }

  function pagina(page: number, pageSize: number, total: number): PaginatedResult<Linha> {
    const inicio = (page - 1) * pageSize;
    const quantidade = Math.max(0, Math.min(pageSize, total - inicio));
    return {
      data: Array.from({ length: quantidade }, (_, i) => ({ id: `r${inicio + i}` })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  function montar(total: number, registrar: number[] = []): ListState<Linha> {
    const injector = TestBed.inject(Injector);
    return runInInjectionContext(
      injector,
      () =>
        new ListState<Linha>((consulta) => {
          registrar.push(Number(consulta['page']));
          return of(pagina(Number(consulta['page']), Number(consulta['pageSize']), total));
        }),
    );
  }

  it('busca o recorte inteiro de cem em cem, e não só a página na tela', () => {
    const paginas: number[] = [];
    const lista = montar(250, paginas);

    let resultado: { linhas: Linha[]; truncado: boolean } | null = null;
    lista.exportar().subscribe((r) => (resultado = r));

    expect(paginas).toEqual([1, 2, 3]);
    expect(resultado!.linhas).toHaveLength(250);
    expect(resultado!.truncado).toBe(false);
  });

  it('para no limite e avisa que o arquivo saiu incompleto', () => {
    const paginas: number[] = [];
    const lista = montar(500, paginas);

    let resultado: { linhas: Linha[]; truncado: boolean } | null = null;
    lista.exportar(200).subscribe((r) => (resultado = r));

    expect(paginas).toEqual([1, 2]);
    expect(resultado!.linhas).toHaveLength(200);
    expect(resultado!.truncado).toBe(true);
  });
});
