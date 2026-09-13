import { Component, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';

export interface OpcaoFiltro {
  value: string;
  label: string;
}

export interface DefinicaoFiltro {
  name: string;
  label: string;
  options: OpcaoFiltro[];
  placeholder?: string;
}

export type ValoresFiltro = Record<string, string> & { q: string };

/**
 * Barra de busca e filtros das listagens (UI-006).
 *
 * A filtragem é **server-side**: o componente só devolve os valores; quem
 * consulta é a página. A busca sai com atraso para não disparar uma requisição
 * por tecla digitada.
 */
@Component({
  selector: 'sge-filter-bar',
  imports: [FormsModule, InputTextModule, SelectModule],
  template: `
    <div class="barra-filtro">
      @if (busca()) {
        <span class="barra-filtro__busca">
          <i class="pi pi-search"></i>
          <input
            pInputText
            type="search"
            [placeholder]="placeholderBusca()"
            [attr.aria-label]="placeholderBusca()"
            [ngModel]="termo()"
            (ngModelChange)="termo.set($event)"
          />
        </span>
      }

      @for (filtro of filtros(); track filtro.name) {
        <p-select
          [options]="filtro.options"
          optionLabel="label"
          optionValue="value"
          [showClear]="true"
          [placeholder]="filtro.placeholder ?? filtro.label"
          [ariaLabel]="filtro.label"
          [ngModel]="valor(filtro.name)"
          (ngModelChange)="mudarFiltro(filtro.name, $event)"
        />
      }

      @if (periodo()) {
        <span class="barra-filtro__periodo">
          <input
            pInputText
            type="date"
            aria-label="Período — a partir de"
            [ngModel]="valor('from')"
            (ngModelChange)="mudarFiltro('from', $event)"
          />
          <span aria-hidden="true">a</span>
          <input
            pInputText
            type="date"
            aria-label="Período — até"
            [ngModel]="valor('to')"
            (ngModelChange)="mudarFiltro('to', $event)"
          />
        </span>
      }
    </div>
  `,
  styles: `
    .barra-filtro {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.75rem 0.875rem;
      background: var(--p-content-background);
      border: 1px solid var(--p-content-border-color);
      border-radius: var(--p-content-border-radius);
    }
    .barra-filtro__busca {
      position: relative;
      flex: 1;
      display: flex;
      align-items: center;
    }
    .barra-filtro__busca i {
      position: absolute;
      left: 0.7rem;
      font-size: 0.8rem;
      color: var(--p-text-muted-color);
      pointer-events: none;
    }
    .barra-filtro__busca input {
      width: 100%;
      padding-left: 2.1rem;
    }
    .barra-filtro__periodo {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      color: var(--p-text-muted-color);
    }
  `,
})
export class FilterBar {
  readonly valores = input.required<ValoresFiltro>();
  readonly filtros = input<DefinicaoFiltro[]>([]);
  readonly placeholderBusca = input('Buscar');
  /** Esconde a busca textual onde o endpoint não tem `q` (ex.: histórico de conciliação). */
  readonly busca = input(true);
  /**
   * Mostra o recorte por período (`from`/`to`, `YYYY-MM-DD`). Data é escolha
   * deliberada, como os selects: sai na hora, sem o atraso da busca.
   */
  readonly periodo = input(false);
  /** Atraso da busca, em ms. */
  readonly atrasoMs = input(300);

  readonly mudou = output<ValoresFiltro>();

  protected readonly termo = signal('');

  private temporizador: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Mantém o campo em dia quando o filtro é limpo de fora (botão "limpar").
    effect(() => {
      const q = this.valores().q;
      if (untracked(this.termo) !== q) this.termo.set(q);
    });

    // Debounce só da busca: os selects emitem na hora, porque a escolha já é
    // deliberada e esperar 300 ms depois de um clique parece travamento.
    effect(() => {
      const termo = this.termo();
      const valores = untracked(this.valores);
      if (termo === valores.q) return;

      if (this.temporizador) clearTimeout(this.temporizador);
      this.temporizador = setTimeout(() => {
        this.mudou.emit({ ...valores, q: termo });
      }, untracked(this.atrasoMs));
    });
  }

  /** Valor de um filtro livre (fora de `filtros`), vazio quando ausente. */
  protected valor(nome: string): string {
    return this.valores()[nome] || '';
  }

  protected mudarFiltro(nome: string, valor: string | null): void {
    this.mudou.emit({ ...this.valores(), [nome]: valor ?? '' });
  }
}
