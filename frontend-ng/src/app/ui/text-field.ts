import { Component, computed, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';

let contador = 0;

/**
 * Campo de texto com rótulo, dica e erro ligados por `aria-describedby`
 * (UI-006). O leitor de tela precisa anunciar o motivo do erro junto com o
 * campo — a UI-082 (WCAG 2.1 AA) vai cobrar isso.
 */
@Component({
  selector: 'sge-text-field',
  imports: [InputTextModule],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TextField), multi: true },
  ],
  template: `
    <div class="campo">
      <label class="campo__rotulo" [attr.for]="id">{{ rotulo() }}</label>
      <input
        pInputText
        class="campo__controle"
        [id]="id"
        [type]="tipo()"
        [value]="valor()"
        [placeholder]="placeholder()"
        [disabled]="desabilitado()"
        [required]="obrigatorio()"
        [attr.autocomplete]="autocomplete() || null"
        [attr.aria-invalid]="erro() ? true : null"
        [attr.aria-describedby]="descritoPor()"
        (input)="aoDigitar($any($event.target).value)"
        (blur)="aoTocar()"
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
export class TextField implements ControlValueAccessor {
  readonly rotulo = input.required<string>();
  readonly tipo = input('text');
  readonly placeholder = input('');
  readonly dica = input('');
  readonly erro = input<string | null>(null);
  readonly obrigatorio = input(false);
  readonly autocomplete = input('');

  protected readonly id = `sge-texto-${++contador}`;
  protected readonly valor = signal('');
  protected readonly desabilitado = signal(false);

  protected readonly descritoPor = computed(() => {
    const partes = [this.dica() ? `${this.id}-dica` : null, this.erro() ? `${this.id}-erro` : null];
    const juntas = partes.filter(Boolean).join(' ');
    return juntas === '' ? null : juntas;
  });

  private aoMudar: (valor: string) => void = () => {};
  protected aoTocar: () => void = () => {};

  protected aoDigitar(texto: string): void {
    this.valor.set(texto);
    this.aoMudar(texto);
  }

  writeValue(valor: string | null): void {
    this.valor.set(valor ?? '');
  }

  registerOnChange(fn: (valor: string) => void): void {
    this.aoMudar = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.aoTocar = fn;
  }

  setDisabledState(desabilitado: boolean): void {
    this.desabilitado.set(desabilitado);
  }
}
