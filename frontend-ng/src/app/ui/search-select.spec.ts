import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { FilterBar } from './filter-bar';
import type { OpcaoFiltro } from './filter-bar';
import { SearchSelect } from './search-select';

/** Acesso aos membros protegidos que o template usa. */
interface SearchSelectInterno {
  pesquisar: (termo: string) => void;
  sugestoes: () => OpcaoFiltro[];
  selecionado: () => OpcaoFiltro | null;
  escolher: (evento: { value: OpcaoFiltro }) => void;
  limpar: () => void;
}

function montar(buscar: (termo: string) => Observable<OpcaoFiltro[]>) {
  const fixture = TestBed.createComponent(SearchSelect);
  fixture.componentRef.setInput('rotulo', 'Item');
  fixture.componentRef.setInput('buscar', buscar);
  fixture.detectChanges();
  return fixture;
}

describe('SearchSelect (busca no servidor)', () => {
  it('descarta a resposta de um termo que o usuário já substituiu', () => {
    const respostas: Record<string, Subject<OpcaoFiltro[]>> = {
      vergal: new Subject(),
      vergalhao: new Subject(),
    };
    const fixture = montar((termo) => respostas[termo]);
    const campo = fixture.componentInstance as unknown as SearchSelectInterno;

    campo.pesquisar('vergal');
    campo.pesquisar('vergalhao');

    // A busca antiga responde depois da nova: não pode sobrescrever a lista.
    respostas['vergal'].next([{ value: 'x', label: 'Resposta velha' }]);
    expect(campo.sugestoes()).toEqual([]);

    respostas['vergalhao'].next([{ value: 'p1', label: 'PRD-0148 — Vergalhão' }]);
    expect(campo.sugestoes()).toEqual([{ value: 'p1', label: 'PRD-0148 — Vergalhão' }]);
  });

  it('entrega só o id para o formulário e limpa com null', () => {
    const fixture = montar(() => of([]));
    const componente = fixture.componentInstance;
    const campo = componente as unknown as SearchSelectInterno;
    const recebidos: (string | null)[] = [];
    componente.registerOnChange((valor) => recebidos.push(valor));

    campo.escolher({ value: { value: 'p1', label: 'PRD-0148 — Vergalhão' } });
    campo.limpar();

    expect(recebidos).toEqual(['p1', null]);
  });

  it('resolve o rótulo de um id já preenchido em vez de mostrar o UUID', () => {
    const fixture = montar(() => of([]));
    fixture.componentRef.setInput('resolver', (id: string) =>
      of({ value: id, label: '0001 — Jamínteles Moura' }),
    );
    const componente = fixture.componentInstance;

    componente.writeValue('func-1');

    const campo = componente as unknown as SearchSelectInterno;
    expect(campo.selecionado()).toEqual({ value: 'func-1', label: '0001 — Jamínteles Moura' });
  });

  it('falha na busca vira lista vazia, não erro na tela', () => {
    const falha = new Subject<OpcaoFiltro[]>();
    const fixture = montar(() => falha);
    const campo = fixture.componentInstance as unknown as SearchSelectInterno;

    campo.pesquisar('abc');
    falha.error(new Error('403'));

    expect(campo.sugestoes()).toEqual([]);
  });
});

describe('FilterBar — recorte por período', () => {
  it('só desenha os campos de data quando a tela pede', () => {
    const fixture = TestBed.createComponent(FilterBar);
    fixture.componentRef.setInput('valores', { q: '' });
    fixture.detectChanges();

    const datas = () =>
      (fixture.nativeElement as HTMLElement).querySelectorAll('input[type="date"]').length;
    expect(datas()).toBe(0);

    fixture.componentRef.setInput('periodo', true);
    fixture.detectChanges();
    expect(datas()).toBe(2);
  });
});
