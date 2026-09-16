import {
  Component,
  ElementRef,
  TemplateRef,
  afterRenderEffect,
  computed,
  contentChild,
  inject,
  input,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MultiSelectModule } from 'primeng/multiselect';
import { TableModule, TableLazyLoadEvent } from 'primeng/table';

import { UserPreferencesService } from '../core/prefs/user-preferences.service';

/** Descrição de uma coluna. `campo` é a chave do objeto da linha. */
export interface Coluna {
  campo: string;
  cabecalho: string;
  /** Alinha à direita e usa dígitos de largura fixa — valores monetários. */
  numerica?: boolean;
  largura?: string;
  /** Coluna que o usuário não pode esconder (identificador, ações). */
  fixa?: boolean;
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
 *
 * O modo `virtual` (UI-085) é a exceção deliberada: ali a coleção **já está**
 * inteira em memória porque o endpoint não pagina, e o que se evita é desenhar
 * `<tr>` que ninguém vê. Nesse modo não há paginador nem carregamento
 * preguiçoso — pedir página ao servidor no meio de uma rolagem virtual faria o
 * componente disputar a rolagem com o próprio PrimeNG.
 *
 * Com `chave` preenchida, a tabela ganha o seletor de colunas visíveis e guarda
 * a escolha nas preferências do usuário (UI-078). Esconder é feito por índice
 * de célula, e não removendo a coluna da lista: o `<tr>` de cada página é
 * desenhado pelo template da própria tela, com `<td>` escritos à mão — tirar a
 * coluna do cabeçalho e deixar a célula no corpo desalinharia a linha inteira.
 */
@Component({
  selector: 'sge-data-table',
  imports: [NgTemplateOutlet, FormsModule, MultiSelectModule, TableModule],
  template: `
    @if (chaveEfetiva() || temFerramentas()) {
      <div class="tabela__ferramentas">
        <ng-content select="[ferramentas]" />
        @if (chaveEfetiva()) {
          <p-multiselect
            styleClass="tabela__colunas"
            [options]="opcoesDeColuna()"
            optionLabel="cabecalho"
            optionValue="campo"
            [ngModel]="visiveis()"
            (ngModelChange)="definirVisiveis($event)"
            [showToggleAll]="true"
            [maxSelectedLabels]="0"
            selectedItemsLabel="{0} colunas visíveis"
            placeholder="Colunas"
            ariaLabel="Colunas visíveis"
          />
        }
      </div>
    }

    <p-table
      [value]="linhas()"
      [columns]="colunas()"
      [lazy]="!virtual()"
      [paginator]="!virtual()"
      [scrollable]="virtual()"
      [scrollHeight]="virtual() ? altura() : ''"
      [virtualScroll]="virtual()"
      [virtualScrollItemSize]="alturaLinha()"
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
    .tabela__ferramentas {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.6rem 0.875rem;
      border-bottom: 1px solid var(--p-content-border-color);
    }
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
  /**
   * Identificador da tabela nas preferências do usuário — ex.:
   * `cadastros.parceiros`. Vazio desliga o seletor de colunas.
   */
  readonly chave = input('');
  /** Liga a barra de ferramentas mesmo sem seletor de colunas (exportação, UI-080). */
  readonly temFerramentas = input(false);

  /**
   * Rolagem virtual (RNF-008 — UI-085).
   *
   * Vale para a tabela que desenha a coleção inteira de uma vez — parâmetros do
   * sistema, conferência de importação, resultado de um recorte que não pagina.
   * Aí o navegador monta milhares de `<tr>` que ninguém vai ver, e a rolagem
   * engasga. Com a virtualização, ele monta a janela visível e mais um pouco.
   *
   * **Não** ligue na listagem paginada comum: com 20 a 50 linhas por página, a
   * virtualização só acrescenta um contêiner de rolagem dentro de outro e uma
   * altura fixa onde a página já tinha a sua.
   */
  readonly virtual = input(false);
  /** Altura de uma linha em pixels — precisa bater com o CSS, ou a barra mente. */
  readonly alturaLinha = input(44);
  /** Altura da janela de rolagem. */
  readonly altura = input('60vh');

  readonly paginaMudou = output<PaginaSolicitada>();

  private readonly prefs = inject(UserPreferencesService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  /**
   * `<ng-template #linha let-item>` opcional para desenhar o `<tr>` — é o que
   * permite etiquetas de situação e botões de ação na linha. Sem ele, cada
   * coluna vira uma célula de texto.
   */
  protected readonly modeloLinha = contentChild<TemplateRef<unknown>>('linha');

  /** O PrimeNG conta registros a partir de 0; a aplicação conta páginas a partir de 1. */
  protected readonly primeiroRegistro = computed(() => (this.pagina() - 1) * this.tamanhoPagina());

  /**
   * O seletor de colunas esconde célula por índice, depois de cada render. A
   * tabela virtual recicla `<tr>` durante a rolagem, e as linhas que entram
   * depois nasceriam com todas as colunas de volta. Em vez de um seletor que
   * funciona pela metade, ele não aparece no modo virtual.
   */
  protected readonly chaveEfetiva = computed(() => (this.virtual() ? '' : this.chave()));

  /** Só colunas com cabeçalho e não fixas entram no seletor. */
  protected readonly opcoesDeColuna = computed(() =>
    this.colunas().filter((coluna) => !coluna.fixa && coluna.cabecalho.trim() !== ''),
  );

  private readonly ocultas = computed(() => {
    const chave = this.chaveEfetiva();
    if (!chave) return new Set<string>();
    const opcionais = new Set(this.opcoesDeColuna().map((coluna) => coluna.campo));
    // Uma coluna que deixou de existir (ou virou fixa) não pode continuar
    // escondendo célula nenhuma.
    return new Set(this.prefs.colunasOcultas(chave).filter((campo) => opcionais.has(campo)));
  });

  protected readonly visiveis = computed(() =>
    this.opcoesDeColuna()
      .map((coluna) => coluna.campo)
      .filter((campo) => !this.ocultas().has(campo)),
  );

  constructor() {
    // Roda depois de cada render: a troca de página redesenha o `<tbody>`
    // inteiro, e as células novas nascem sem o estilo aplicado.
    afterRenderEffect(() => {
      const ocultas = this.ocultas();
      const colunas = this.colunas();
      // Dependência explícita: novas linhas precisam do mesmo tratamento.
      this.linhas();

      const indices = colunas.map((coluna) => ocultas.has(coluna.campo));
      const raiz = this.host.nativeElement;
      for (const linha of Array.from(raiz.querySelectorAll('table tr'))) {
        const celulas = Array.from(linha.children) as HTMLElement[];
        // Linhas de mensagem usam `colspan`; mexer nelas esconderia o aviso.
        if (celulas.length !== colunas.length) continue;
        celulas.forEach((celula, i) => {
          celula.style.display = indices[i] ? 'none' : '';
        });
      }
    });
  }

  protected definirVisiveis(campos: string[]): void {
    const chave = this.chaveEfetiva();
    if (!chave) return;
    const visiveis = new Set(campos);
    this.prefs.definirColunasOcultas(
      chave,
      this.opcoesDeColuna()
        .map((coluna) => coluna.campo)
        .filter((campo) => !visiveis.has(campo)),
    );
  }

  protected aoPedirPagina(evento: TableLazyLoadEvent): void {
    const tamanho = evento.rows ?? this.tamanhoPagina();
    const pagina = Math.floor((evento.first ?? 0) / tamanho) + 1;
    if (pagina === this.pagina() && tamanho === this.tamanhoPagina()) return;
    this.paginaMudou.emit({ page: pagina, pageSize: tamanho });
  }
}
