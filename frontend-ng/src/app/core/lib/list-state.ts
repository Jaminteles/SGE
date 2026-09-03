import { DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';

import type { QueryValue } from '../api/params';
import { PAGE_SIZE } from '../api/query';
import type { PaginatedResult } from '../api/types';
import type { ValoresFiltro } from '../../ui/filter-bar';

export type Consulta = Record<string, QueryValue>;

/**
 * Estado de uma listagem paginada (UI-006).
 *
 * Existe porque as seis telas da Sprint 19 repetem exatamente o mesmo ciclo:
 * filtros → consulta ao servidor → página → erro. A paginação e a filtragem são
 * **sempre** server-side: a coleção inteira de um ERP não cabe no navegador, e
 * filtrar no cliente esconderia registros que o usuário acha que não existem.
 *
 * Instancie dentro do construtor do componente: o cancelamento das requisições
 * pendentes depende do `DestroyRef` do contexto de injeção.
 */
export class ListState<T> {
  readonly linhas = signal<T[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(1);
  readonly tamanhoPagina = signal(PAGE_SIZE);
  readonly filtros = signal<ValoresFiltro>({ q: '' });
  readonly carregando = signal(false);
  readonly erro = signal<unknown>(null);

  private readonly destroyRef = inject(DestroyRef);
  /** Descarta a resposta de uma consulta que já foi substituída por outra. */
  private requisicao = 0;

  constructor(
    private readonly buscar: (consulta: Consulta) => Observable<PaginatedResult<T>>,
    /** Traduz os valores da barra de filtros para os parâmetros da API. */
    private readonly paraConsulta: (filtros: ValoresFiltro) => Consulta = (filtros) => ({
      q: filtros.q,
    }),
  ) {}

  consultaAtual(): Consulta {
    return {
      ...this.paraConsulta(this.filtros()),
      page: this.pagina(),
      pageSize: this.tamanhoPagina(),
    };
  }

  carregar(): void {
    const atual = ++this.requisicao;
    this.carregando.set(true);
    this.erro.set(null);

    this.buscar(this.consultaAtual())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => {
          if (atual !== this.requisicao) return;
          this.linhas.set(resultado.data);
          this.total.set(resultado.total);
          this.carregando.set(false);
        },
        error: (erro: unknown) => {
          if (atual !== this.requisicao) return;
          this.linhas.set([]);
          this.total.set(0);
          this.erro.set(erro);
          this.carregando.set(false);
        },
      });
  }

  irParaPagina(page: number, pageSize: number): void {
    this.pagina.set(page);
    this.tamanhoPagina.set(pageSize);
    this.carregar();
  }

  /** Filtro novo volta para a primeira página: a antiga pode nem existir mais. */
  aplicarFiltros(valores: ValoresFiltro): void {
    this.filtros.set(valores);
    this.pagina.set(1);
    this.carregar();
  }

  limparFiltros(): void {
    this.aplicarFiltros({ q: '' });
  }

  /** `true` quando há filtro ou busca em uso — muda a mensagem de lista vazia. */
  temFiltro(): boolean {
    return Object.values(this.filtros()).some((valor) => valor !== '');
  }
}
