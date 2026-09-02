import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DataTable, type Coluna, type PaginaSolicitada } from './data-table';

interface Titulo {
  numero: string;
  fornecedor: string;
  valor: string;
}

@Component({
  imports: [DataTable],
  template: `
    <sge-data-table
      [colunas]="colunas"
      [linhas]="linhas()"
      [total]="total()"
      [pagina]="pagina()"
      [tamanhoPagina]="2"
      (paginaMudou)="pedidos.push($event)"
    />
  `,
})
class Hospedeiro {
  readonly colunas: Coluna[] = [
    { campo: 'numero', cabecalho: 'Título' },
    { campo: 'fornecedor', cabecalho: 'Fornecedor' },
    { campo: 'valor', cabecalho: 'Valor', numerica: true },
  ];
  readonly linhas = signal<Titulo[]>([
    { numero: 'TP-004821', fornecedor: 'Ferragens Bahia', valor: '18.420,00' },
    { numero: 'TP-004820', fornecedor: 'Posto Rodoviário', valor: '3.180,50' },
  ]);
  readonly total = signal(6);
  readonly pagina = signal(1);
  pedidos: PaginaSolicitada[] = [];
}

describe('DataTable (UI-006)', () => {
  let fixture: ComponentFixture<Hospedeiro>;
  let host: Hospedeiro;

  const textos = (seletor: string): string[] =>
    [...fixture.nativeElement.querySelectorAll(seletor)].map((el) =>
      (el as HTMLElement).textContent!.trim(),
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Hospedeiro] }).compileComponents();
    fixture = TestBed.createComponent(Hospedeiro);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('desenha cabeçalhos e as linhas da página recebida', () => {
    expect(textos('thead th')).toEqual(['Título', 'Fornecedor', 'Valor']);
    expect(textos('tbody tr td')).toEqual([
      'TP-004821',
      'Ferragens Bahia',
      '18.420,00',
      'TP-004820',
      'Posto Rodoviário',
      '3.180,50',
    ]);
  });

  it('alinha a coluna numérica à direita', () => {
    const numericas = fixture.nativeElement.querySelectorAll('td.coluna--numerica');
    expect(numericas.length).toBe(2);
  });

  it('não pede página nenhuma só por ter montado', () => {
    // A `p-table` dispara `onLazyLoad` na inicialização; sem a guarda, cada
    // listagem faria duas consultas ao abrir.
    expect(host.pedidos).toEqual([]);
  });

  it('pede a página seguinte quando o usuário avança', () => {
    const proxima = fixture.nativeElement.querySelector(
      '.p-paginator-next',
    ) as HTMLButtonElement | null;
    expect(proxima).not.toBeNull();

    proxima!.click();
    fixture.detectChanges();

    expect(host.pedidos).toEqual([{ page: 2, pageSize: 2 }]);
  });

  it('mostra o estado vazio quando não há registros', async () => {
    host.linhas.set([]);
    host.total.set(0);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Nenhum registro encontrado.');
  });
});
