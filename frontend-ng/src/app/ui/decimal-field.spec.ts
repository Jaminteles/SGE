import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';

import { DecimalField } from './decimal-field';

@Component({
  imports: [FormsModule, DecimalField],
  template: `
    <sge-decimal-field
      rotulo="Valor do título"
      name="valor"
      [obrigatorio]="obrigatorio()"
      [erro]="erroExterno()"
      [(ngModel)]="valor"
    />
  `,
})
class Hospedeiro {
  valor: string | null = null;
  readonly obrigatorio = signal(false);
  readonly erroExterno = signal<string | null>(null);
}

describe('DecimalField (RN-012)', () => {
  let fixture: ComponentFixture<Hospedeiro>;
  let host: Hospedeiro;

  const campo = () => fixture.nativeElement.querySelector('input') as HTMLInputElement;
  const erro = () => fixture.nativeElement.querySelector('.campo__erro')?.textContent?.trim();

  function digitar(texto: string): void {
    const input = campo();
    input.value = texto;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function sairDoCampo(): void {
    campo().dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Hospedeiro] }).compileComponents();
    fixture = TestBed.createComponent(Hospedeiro);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('entrega o valor canônico em string, nunca number', () => {
    digitar('1.234,56');
    expect(host.valor).toBe('1234.56');
    expect(typeof host.valor).toBe('string');
  });

  it('preserva centavos sem passar por ponto flutuante', () => {
    digitar('0,10');
    expect(host.valor).toBe('0.10');

    digitar('999999999999999,99');
    expect(host.valor).toBe('999999999999999.99');
  });

  it('aceita o formato canônico digitado direto', () => {
    digitar('1234.56');
    expect(host.valor).toBe('1234.56');
  });

  it('reexibe o valor formatado em pt-BR ao sair do campo', () => {
    digitar('1234.5');
    sairDoCampo();
    expect(campo().value).toBe('1.234,50');
    // O estado de fora segue canônico, não o que está na tela.
    expect(host.valor).toBe('1234.50');
  });

  it('acusa mais de duas casas decimais e não propaga valor', () => {
    digitar('10,999');
    expect(erro()).toBe('Use no máximo 2 casas decimais.');
    expect(host.valor).toBeNull();
  });

  it('acusa entrada não numérica e não propaga valor', () => {
    digitar('abc');
    expect(erro()).toBe('Valor inválido.');
    expect(host.valor).toBeNull();
  });

  it('exige valor quando o campo é obrigatório', () => {
    host.obrigatorio.set(true);
    fixture.detectChanges();

    digitar('');
    expect(erro()).toBe('Informe um valor.');
    expect(host.valor).toBeNull();
  });

  it('aceita campo vazio quando não é obrigatório', () => {
    digitar('');
    expect(erro()).toBeUndefined();
    expect(host.valor).toBeNull();
  });

  it('marca o campo como inválido para acessibilidade', () => {
    digitar('10,999');
    expect(campo().getAttribute('aria-invalid')).toBe('true');

    const descritoPor = campo().getAttribute('aria-describedby');
    expect(descritoPor).toBeTruthy();
    const alvo = fixture.nativeElement.querySelector(`#${descritoPor}`);
    expect(alvo?.textContent).toContain('Use no máximo 2 casas decimais.');
  });

  it('exibe formatado o valor que vem de fora', async () => {
    host.valor = '6200.00';
    fixture.detectChanges();
    // O `ngModel` escreve no componente numa microtarefa, não no mesmo tique.
    await fixture.whenStable();
    fixture.detectChanges();
    expect(campo().value).toBe('6.200,00');
  });

  it('dá precedência ao erro vindo da API', () => {
    host.erroExterno.set('O valor excede o saldo disponível.');
    fixture.detectChanges();
    expect(erro()).toBe('O valor excede o saldo disponível.');
  });

  it('lida com negativo', () => {
    digitar('-6.200,00');
    expect(host.valor).toBe('-6200.00');
    sairDoCampo();
    expect(campo().value).toBe('-6.200,00');
  });
});
