import { Component, computed, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { SelectModule } from 'primeng/select';

import type { OpcaoFiltro } from './filter-bar';

let contador = 0;

/** Campo de escolha com rótulo, dica e erro ligados por aria (UI-006). */
@Component({
  selector: 'sge-select-field',
  imports: [FormsModule, SelectModule],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectField), multi: true },
  ],
  template: `
    <div class="campo">
      <label class="campo__rotulo" [attr.for]="id">{{ rotulo() }}</label>
      <p-select
        [inputId]="id"
        [options]="opcoes()"
        optionLabel="label"
        optionValue="value"
        [placeholder]="placeholder()"
        [showClear]="!obrigatorio()"
        [disabled]="desabilitado()"
        [ngModel]="valor()"
        (ngModelChange)="aoEscolher($event)"
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
export class SelectField implements ControlValueAccessor {
  readonly rotulo = input.required<string>();
  readonly opcoes = input<OpcaoFiltro[]>([]);
  /** Texto da opção vazia; omita para tornar a escolha obrigatória. */
  readonly placeholder = input('Selecione');
  readonly dica = input('');
  readonly erro = input<string | null>(null);
  readonly obrigatorio = input(false);

  protected readonly id = `sge-select-${++contador}`;
  protected readonly valor = signal<string | null>(null);
  protected readonly desabilitado = signal(false);

  protected readonly descritoPor = computed(() => {
    const partes = [this.dica() ? `${this.id}-dica` : null, this.erro() ? `${this.id}-erro` : null];
    const juntas = partes.filter(Boolean).join(' ');
    return juntas === '' ? null : juntas;
  });

  private aoMudar: (valor: string | null) => void = () => {};
  private aoTocar: () => void = () => {};

  protected aoEscolher(valor: string | null): void {
    this.valor.set(valor);
    this.aoMudar(valor);
    this.aoTocar();
  }

  writeValue(valor: string | null): void {
    this.valor.set(valor);
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
