import { Injectable, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PaginatedResult } from '../api/types';
import { ListState, type Consulta } from './list-state';

interface Linha {
  id: string;
}

function pagina(data: Linha[], total = data.length): PaginatedResult<Linha> {
  return { data, total, page: 1, pageSize: 20, totalPages: 1 };
}

/**
 * O `ListState` precisa de contexto de injeção (usa `DestroyRef`), então o
 * teste o instancia dentro de um serviço, como as páginas fazem.
 */
@Injectable()
class Hospedeiro {
  readonly consultas: Consulta[] = [];
  readonly respostas: Subject<PaginatedResult<Linha>>[] = [];

  readonly lista = new ListState<Linha>(
    (consulta) => {
      this.consultas.push(consulta);
      const resposta = new Subject<PaginatedResult<Linha>>();
      this.respostas.push(resposta);
      return resposta;
    },
    (filtros) => ({
      q: filtros.q,
      isActive: filtros['situacao'] === '' ? undefined : filtros['situacao'] === 'true',
    }),
  );
}

describe('ListState (UI-006)', () => {
  let host: Hospedeiro;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [Hospedeiro] });
    host = TestBed.runInInjectionContext(() => inject(Hospedeiro));
  });

  it('consulta sempre com página e tamanho — a paginação é do servidor', () => {
    host.lista.carregar();

    expect(host.consultas[0]).toMatchObject({ page: 1, pageSize: 20 });
  });

  it('aplica filtro e volta para a primeira página', () => {
    host.lista.irParaPagina(3, 20);
    host.lista.aplicarFiltros({ q: 'bahia', situacao: 'false' });

    const ultima = host.consultas.at(-1)!;
    expect(ultima).toMatchObject({ q: 'bahia', isActive: false, page: 1 });
    expect(host.lista.pagina()).toBe(1);
  });

  it('descarta a resposta de uma consulta já substituída', () => {
    host.lista.carregar();
    host.lista.aplicarFiltros({ q: 'segunda' });

    // A primeira responde depois da segunda: a tela não pode voltar ao
    // resultado antigo.
    host.respostas[1].next(pagina([{ id: 'novo' }], 1));
    host.respostas[0].next(pagina([{ id: 'antigo' }], 9));

    expect(host.lista.linhas()).toEqual([{ id: 'novo' }]);
    expect(host.lista.total()).toBe(1);
  });

  it('guarda o erro e esvazia as linhas quando a consulta falha', () => {
    host.lista.carregar();
    host.respostas[0].error(new Error('403'));

    expect(host.lista.linhas()).toEqual([]);
    expect(host.lista.erro()).toBeInstanceOf(Error);
    expect(host.lista.carregando()).toBe(false);
  });

  it('sabe quando há filtro em uso, para a mensagem de lista vazia', () => {
    expect(host.lista.temFiltro()).toBe(false);

    host.lista.aplicarFiltros({ q: '', situacao: 'true' });
    expect(host.lista.temFiltro()).toBe(true);

    host.lista.limparFiltros();
    expect(host.lista.temFiltro()).toBe(false);
  });
});
