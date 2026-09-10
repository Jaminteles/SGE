import { Component, computed, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';

import { formatDecimal, parseDecimalInput } from '../core/lib/decimal';

let contador = 0;

/**
 * Campo monetário (RN-012 / RNF-008).
 *
 * O usuário digita em pt-BR ("1.234,56"); o componente entrega o canônico
 * ("1234.56") como **string**. Em nenhum momento o valor passa por `number`,
 * então não há arredondamento binário entre a tela e o `numeric(18,2)` do banco.
 *
 * É por isso que este componente existe em vez de um `p-inputnumber`: aquele
 * trafega `number`, e `0.1 + 0.2` deixaria de fechar com o banco.
 *
 * Enquanto o usuário digita, o texto cru fica num rascunho e o valor de fora
 * continua canônico; ao sair do campo, o rascunho é descartado e o valor volta
 * formatado.
 */
@Component({
  selector: 'sge-decimal-field',
  imports: [InputTextModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DecimalField),
      multi: true,
    },
  ],
  template: `
    <div class="campo">
      <label class="campo__rotulo" [attr.for]="id">{{ rotulo() }}</label>
      <input
        pInputText
        type="text"
        inputMode="decimal"
        autocomplete="off"
        class="campo__controle campo__controle--numerico"
        [id]="id"
        [value]="exibido()"
        [disabled]="desabilitado()"
        [required]="obrigatorio()"
        [attr.aria-invalid]="erroExibido() ? true : null"
        [attr.aria-describedby]="descritoPor()"
        (input)="aoDigitar($any($event.target).value)"
        (blur)="aoSair()"
      />
      @if (dica()) {
        <span class="campo__dica" [id]="id + '-dica'">{{ dica() }}</span>
      }
      @if (erroExibido(); as mensagem) {
        <span class="campo__erro" [id]="id + '-erro'">{{ mensagem }}</span>
      }
    </div>
  `,
})
export class DecimalField implements ControlValueAccessor {
  readonly rotulo = input.required<string>();
  readonly dica = input('');
  /** Erro vindo de fora (ex.: validação da API). */
  readonly erro = input<string | null>(null);
  readonly obrigatorio = input(false);
  /**
   * Casas decimais aceitas. Duas para dinheiro (`numeric(18,2)`); quantidade de
   * estoque e preço unitário chegam a seis (`UNIT_VALUE_PATTERN` do backend), e
   * recusá-las aqui rejeitaria valor que a API aceita.
   */
  readonly casas = input(2);

  protected readonly id = `sge-decimal-${++contador}`;

  /** Valor canônico atual, como veio de fora. */
  private readonly canonico = signal<string | null>(null);
  /** Texto cru enquanto o usuário digita; `null` quando não está editando. */
  private readonly rascunho = signal<string | null>(null);
  private readonly erroLocal = signal<string | null>(null);

  protected readonly desabilitado = signal(false);

  protected readonly exibido = computed(
    () => this.rascunho() ?? formatDecimal(this.canonico(), this.casas()),
  );

  protected readonly erroExibido = computed(() => this.erro() ?? this.erroLocal());

  protected readonly descritoPor = computed(() => {
    const partes = [
      this.dica() ? `${this.id}-dica` : null,
      this.erroExibido() ? `${this.id}-erro` : null,
    ];
    const juntas = partes.filter(Boolean).join(' ');
    return juntas === '' ? null : juntas;
  });

  private aoMudar: (valor: string | null) => void = () => {};
  private aoTocar: () => void = () => {};

  protected aoDigitar(texto: string): void {
    this.rascunho.set(texto);
    const analisado = parseDecimalInput(texto, {
      required: this.obrigatorio(),
      casas: this.casas(),
    });
    this.erroLocal.set(analisado.error);
    // Entrada inválida não propaga valor: o formulário fica com `null` em vez
    // de guardar algo que o backend recusaria.
    this.aoMudar(analisado.error === null ? analisado.value : null);
  }

  protected aoSair(): void {
    this.aoTocar();
    const analisado = parseDecimalInput(this.rascunho() ?? this.exibido(), {
      required: this.obrigatorio(),
      casas: this.casas(),
    });
    this.erroLocal.set(analisado.error);
    if (analisado.error === null) {
      // Descarta o rascunho para reexibir formatado; o estado de fora segue canônico.
      this.canonico.set(analisado.value);
      this.rascunho.set(null);
      this.aoMudar(analisado.value);
    }
  }

  writeValue(valor: string | null): void {
    this.canonico.set(valor);
    this.rascunho.set(null);
    this.erroLocal.set(null);
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
