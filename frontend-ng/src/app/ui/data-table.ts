import { Component, TemplateRef, computed, contentChild, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TableModule, TableLazyLoadEvent } from 'primeng/table';

/** Descrição de uma coluna. `campo` é a chave do objeto da linha. */
export interface Coluna {
  campo: string;
  cabecalho: string;
  /** Alinha à direita e usa dígitos de largura fixa — valores monetários. */
  numerica?: boolean;
  largura?: string;
}

export interface PaginaSolicitada {
  page: number;
  pageSize: number;
}

/**
 * Tabela de listagem (UI-006).
 *
 * A paginação é **server-side**: o componente desenha só a página recebida e
 * avisa quando o usuário pede outra. Nunca ordena nem fatia a coleção inteira —
 * numa base de ERP a coleção inteira não cabe no navegador.
 */
@Component({
  selector: 'sge-data-table',
  imports: [NgTemplateOutlet, TableModule],
  template: `
    <p-table
      [value]="linhas()"
      [columns]="colunas()"
      [lazy]="true"
      [paginator]="true"
      [rows]="tamanhoPagina()"
      [totalRecords]="total()"
      [first]="primeiroRegistro()"
      [loading]="carregando()"
      [tableStyle]="{ 'min-width': '100%' }"
      [currentPageReportTemplate]="'{first}–{last} de {totalRecords}'"
      [showCurrentPageReport]="true"
      (onLazyLoad)="aoPedirPagina($event)"
    >
      <ng-template #header let-colunas>
        <tr>
          @for (coluna of colunas; track coluna.campo) {
            <th
              [style.width]="coluna.largura"
              [class.coluna--numerica]="coluna.numerica"
              scope="col"
            >
              {{ coluna.cabecalho }}
            </th>
          }
        </tr>
      </ng-template>

      <ng-template #body let-linha let-colunas="columns">
        @if (modeloLinha(); as modelo) {
          <ng-container *ngTemplateOutlet="modelo; context: { $implicit: linha }" />
        } @else {
          <tr>
            @for (coluna of colunas; track coluna.campo) {
              <td [class.coluna--numerica]="coluna.numerica">{{ linha[coluna.campo] }}</td>
            }
          </tr>
        }
      </ng-template>

      <ng-template #emptymessage let-colunas>
        <tr>
          <td [attr.colspan]="colunas.length" class="tabela__vazio">{{ mensagemVazia() }}</td>
        </tr>
      </ng-template>
    </p-table>
  `,
  styles: `
    :host ::ng-deep .coluna--numerica {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    :host ::ng-deep .tabela__vazio {
      padding: 2.5rem 1rem;
      text-align: center;
      color: var(--p-text-muted-color);
    }
  `,
})
export class DataTable {
  readonly colunas = input.required<Coluna[]>();
  // A `p-table` recebe o array e o trata como mutável, então `readonly` aqui
  // quebraria a atribuição no template.
  readonly linhas = input.required<unknown[]>();
  readonly total = input(0);
  readonly pagina = input(1);
  readonly tamanhoPagina = input(50);
  readonly carregando = input(false);
  readonly mensagemVazia = input('Nenhum registro encontrado.');

  readonly paginaMudou = output<PaginaSolicitada>();

  /**
   * `<ng-template #linha let-item>` opcional para desenhar o `<tr>` — é o que
   * permite etiquetas de situação e botões de ação na linha. Sem ele, cada
   * coluna vira uma célula de texto.
   */
  protected readonly modeloLinha = contentChild<TemplateRef<unknown>>('linha');

  /** O PrimeNG conta registros a partir de 0; a aplicação conta páginas a partir de 1. */
  protected readonly primeiroRegistro = computed(() => (this.pagina() - 1) * this.tamanhoPagina());

  protected aoPedirPagina(evento: TableLazyLoadEvent): void {
    const tamanho = evento.rows ?? this.tamanhoPagina();
    const pagina = Math.floor((evento.first ?? 0) / tamanho) + 1;
    if (pagina === this.pagina() && tamanho === this.tamanhoPagina()) return;
    this.paginaMudou.emit({ page: pagina, pageSize: tamanho });
  }
}
