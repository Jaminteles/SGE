import { Component, DestroyRef, computed, forwardRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { AutoCompleteModule, type AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { Observable, Subject, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import type { OpcaoFiltro } from './filter-bar';

let contador = 0;

/** Quantos resultados cada busca pede ao servidor. */
export const LIMITE_BUSCA = 20;

/**
 * Escolha com busca no servidor (UI-006).
 *
 * Existe para as coleções que não cabem num select carregado de uma vez —
 * catálogo, parceiros, funcionários. Carregar "os primeiros 100" deixaria o
 * item 101 impossível de escolher, sem nenhum aviso ao usuário.
 *
 * Cada digitação consulta a API pelo termo (`q`), e uma busca nova descarta a
 * anterior (`switchMap`): a lista nunca mostra a resposta de um termo que o
 * usuário já apagou.
 *
 * O valor de fora é só o id. Para exibir um valor que já veio preenchido (tela
 * de edição), a página informa `resolver`, que busca o rótulo pelo id.
 */
@Component({
  selector: 'sge-search-select',
  imports: [FormsModule, AutoCompleteModule],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SearchSelect), multi: true },
  ],
  template: `
    <div class="campo">
      <label class="campo__rotulo" [attr.for]="id">{{ rotulo() }}</label>
      <p-autocomplete
        [inputId]="id"
        [suggestions]="sugestoes()"
        optionLabel="label"
        [forceSelection]="true"
        [dropdown]="true"
        [showClear]="!obrigatorio()"
        [delay]="300"
        [minQueryLength]="0"
        [placeholder]="placeholder()"
        [disabled]="desabilitado()"
        [showEmptyMessage]="true"
        emptyMessage="Nenhum resultado para esse termo."
        appendTo="body"
        [ngModel]="selecionado()"
        (ngModelChange)="aoMudarTexto($event)"
        (completeMethod)="pesquisar($event.query)"
        (onSelect)="escolher($event)"
        (onClear)="limpar()"
        (onBlur)="aoTocar()"
        [ariaLabelledBy]="id"
      />
      @if (dica()) {
        <span class="campo__dica" [id]="id + '-dica'">{{ dica() }}</span>
      }
      @if (erro(); as mensagem) {
        <span class="campo__erro" [id]="id + '-erro'">{{ mensagem }}</span>
      }
    </div>
  `,
})
export class SearchSelect implements ControlValueAccessor {
  readonly rotulo = input.required<string>();
  /** Consulta o servidor pelo termo digitado ("" = primeira página). */
  readonly buscar = input.required<(termo: string) => Observable<OpcaoFiltro[]>>();
  /** Rótulo de um id já preenchido — sem ele, a edição mostraria o UUID. */
  readonly resolver = input<((id: string) => Observable<OpcaoFiltro>) | null>(null);
  readonly placeholder = input('Digite para buscar');
  readonly dica = input('');
  readonly erro = input<string | null>(null);
  readonly obrigatorio = input(false);

  protected readonly id = `sge-busca-${++contador}`;
  protected readonly sugestoes = signal<OpcaoFiltro[]>([]);
  protected readonly selecionado = signal<OpcaoFiltro | null>(null);
  protected readonly desabilitado = signal(false);

  /** Id atual, para não resolver de novo o rótulo que já está na tela. */
  private readonly valorAtual = computed(() => this.selecionado()?.value ?? null);

  private readonly termos = new Subject<string>();
  private aoMudar: (valor: string | null) => void = () => {};
  protected aoTocar: () => void = () => {};

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.termos
      .pipe(
        switchMap((termo) => this.buscar()(termo).pipe(catchError(() => of<OpcaoFiltro[]>([])))),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((opcoes) => this.sugestoes.set(opcoes));
  }

  protected pesquisar(termo: string): void {
    this.termos.next(termo.trim());
  }

  protected escolher(evento: AutoCompleteSelectEvent): void {
    const opcao = evento.value as OpcaoFiltro;
    this.selecionado.set(opcao);
    this.aoMudar(opcao.value);
  }

  protected limpar(): void {
    this.selecionado.set(null);
    this.aoMudar(null);
  }

  /**
   * O autocomplete também emite o texto enquanto o usuário digita. Texto não é
   * valor: só a opção escolhida vale, e apagar tudo equivale a limpar.
   */
  protected aoMudarTexto(valor: OpcaoFiltro | string | null): void {
    if (valor === null || valor === '') this.limpar();
  }

  writeValue(id: string | null): void {
    if (!id) {
      this.selecionado.set(null);
      return;
    }
    if (this.valorAtual() === id) return;

    const resolver = this.resolver();
    if (!resolver) {
      this.selecionado.set({ value: id, label: id });
      return;
    }
    // Enquanto o rótulo não chega, a tela mostra reticências, não o UUID.
    this.selecionado.set({ value: id, label: '…' });
    resolver(id)
      .pipe(catchError(() => of<OpcaoFiltro>({ value: id, label: id })))
      .subscribe((opcao) => {
        if (this.valorAtual() === id) this.selecionado.set(opcao);
      });
  }

  registerOnChange(fn: (valor: string | null) => void): void {
    this.aoMudar = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.aoTocar = fn;
  }

  setDisabledState(desabilitado: boolean): void {
    this.desabilitado.set(desabilitado);
  }
}
