import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';

import { UserPreferencesService } from '../core/prefs/user-preferences.service';
import { ConfirmService } from './confirm.service';

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
  imports: [ButtonModule, DialogModule, FormsModule, InputTextModule, SelectModule],
  template: `
    <div class="barra-filtro" role="search" aria-label="Busca e filtros da listagem">
      @if (busca()) {
        <span class="barra-filtro__busca">
          <i class="pi pi-search" aria-hidden="true"></i>
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

      @if (chave()) {
        <span class="barra-filtro__salvos">
          <p-select
            [options]="salvos()"
            optionLabel="nome"
            optionValue="id"
            [showClear]="true"
            placeholder="Filtros salvos"
            ariaLabel="Filtros salvos"
            [ngModel]="selecionado()"
            (ngModelChange)="aplicarSalvo($event)"
          />
          @if (selecionado()) {
            <p-button
              icon="pi pi-trash"
              severity="secondary"
              [text]="true"
              ariaLabel="Excluir filtro salvo"
              (onClick)="excluirSalvo()"
            />
          }
          <p-button
            icon="pi pi-bookmark"
            label="Salvar filtro"
            severity="secondary"
            [text]="true"
            (onClick)="abrirSalvar()"
          />
        </span>
      }
    </div>

    @if (salvando()) {
      <p-dialog
        [visible]="true"
        [modal]="true"
        [draggable]="false"
        [resizable]="false"
        [style]="{ width: '24rem' }"
        header="Salvar filtro"
        (visibleChange)="salvando.set(false)"
      >
        <div class="campo">
          <label class="campo__rotulo" for="nome-filtro">Nome do filtro</label>
          <input
            id="nome-filtro"
            pInputText
            class="campo__controle"
            [ngModel]="nomeNovo()"
            (ngModelChange)="nomeNovo.set($event)"
            (keyup.enter)="salvar()"
          />
          <p class="campo__dica">
            O recorte vale nesta tela e na empresa ativa. Um nome repetido substitui o anterior.
          </p>
        </div>

        <ng-template #footer>
          <p-button
            label="Cancelar"
            severity="secondary"
            [text]="true"
            (onClick)="salvando.set(false)"
          />
          <p-button label="Salvar" [disabled]="nomeNovo().trim().length < 2" (onClick)="salvar()" />
        </ng-template>
      </p-dialog>
    }
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
    .barra-filtro__salvos {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      margin-left: auto;
    }

    /* Celular e tablet em pé (UI-083): busca ocupa a linha inteira e os filtros
       descem para a linha seguinte, em vez de virarem seis campos de 60px. */
    @media (max-width: 900px) {
      .barra-filtro {
        flex-wrap: wrap;
      }
      .barra-filtro__busca {
        flex-basis: 100%;
      }
      .barra-filtro__periodo,
      .barra-filtro__salvos {
        margin-left: 0;
      }
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
  /**
   * Identificador da tela nas preferências (UI-078) — ex.:
   * `cadastros.parceiros`. Vazio esconde os filtros salvos.
   */
  readonly chave = input('');

  readonly mudou = output<ValoresFiltro>();

  protected readonly termo = signal('');
  protected readonly salvando = signal(false);
  protected readonly nomeNovo = signal('');
  protected readonly selecionado = signal<string | null>(null);

  private readonly prefs = inject(UserPreferencesService);
  private readonly confirmacao = inject(ConfirmService);

  protected readonly salvos = computed(() => this.prefs.filtrosDe(this.chave()));

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
    // Qualquer mexida manual desfaz o vínculo com o recorte salvo: o que está
    // na tela deixou de ser aquele filtro.
    this.selecionado.set(null);
    this.mudou.emit({ ...this.valores(), [nome]: valor ?? '' });
  }

  // ---------- Filtros salvos (UI-078) ----------

  protected aplicarSalvo(id: string | null): void {
    this.selecionado.set(id);
    if (!id) return;
    const salvo = this.salvos().find((filtro) => filtro.id === id);
    if (salvo) this.mudou.emit({ ...salvo.valores });
  }

  protected abrirSalvar(): void {
    this.nomeNovo.set('');
    this.salvando.set(true);
  }

  protected salvar(): void {
    const nome = this.nomeNovo().trim();
    if (nome.length < 2) return;
    const salvo = this.prefs.salvarFiltro(this.chave(), nome, this.valores());
    this.selecionado.set(salvo.id);
    this.salvando.set(false);
  }

  protected async excluirSalvo(): Promise<void> {
    const id = this.selecionado();
    if (!id) return;
    const salvo = this.salvos().find((filtro) => filtro.id === id);
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Excluir filtro salvo?',
      mensagem: `O recorte "${salvo?.nome ?? ''}" sai da lista. Os registros não são afetados.`,
      rotuloConfirmar: 'Excluir',
      destrutivo: true,
    });
    if (!confirmado) return;
    this.prefs.removerFiltro(id);
    this.selecionado.set(null);
  }
}
