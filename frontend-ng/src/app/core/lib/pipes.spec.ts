import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { formatInteger, formatPercent } from './decimal';
import { FORMATO_PIPES } from './pipes';

describe('formatInteger / formatPercent (UI-084)', () => {
  it('agrupa o milhar do inteiro', () => {
    expect(formatInteger('1234567')).toBe('1.234.567');
    expect(formatInteger(1234)).toBe('1.234');
    expect(formatInteger('-1000')).toBe('-1.000');
    expect(formatInteger('999')).toBe('999');
    expect(formatInteger(null)).toBe('');
  });

  it('corta os zeros à direita do percentual e agrupa o milhar', () => {
    expect(formatPercent('18.500000')).toBe('18,5%');
    expect(formatPercent('0.000000')).toBe('0%');
    expect(formatPercent('18')).toBe('18%');
    expect(formatPercent('1234.25')).toBe('1.234,25%');
    expect(formatPercent('')).toBe('');
  });

  it('não converte para número em nenhum caminho', () => {
    // 9007199254740993 não existe em ponto flutuante de dupla precisão: um
    // `Number()` no meio devolveria ...992. A string passa inteira.
    expect(formatInteger('9007199254740993')).toBe('9.007.199.254.740.993');
    expect(formatPercent('0.0000001')).toBe('0,0000001%');
  });
});

describe('Pipes de formatação pt-BR (UI-084)', () => {
  @Component({
    imports: [...FORMATO_PIPES],
    template: `
      <span id="moeda">{{ '1234.5' | sgeMoeda }}</span>
      <span id="decimal">{{ '10.123456' | sgeDecimal: 6 }}</span>
      <span id="inteiro">{{ 1234567 | sgeInteiro }}</span>
      <span id="percentual">{{ '18.500000' | sgePercentual }}</span>
      <span id="data">{{ '2026-08-10' | sgeData }}</span>
      <span id="datahora">{{ '2026-08-10T14:35:00' | sgeDataHora }}</span>
      <span id="cnpj">{{ '12345678000190' | sgeCnpj }}</span>
      <span id="vazio">{{ vazio | sgeMoeda }}</span>
    `,
  })
  class Hospedeiro {
    readonly vazio: string | null = null;
  }

  function texto(id: string): string {
    const fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();
    return (fixture.nativeElement.querySelector(`#${id}`) as HTMLElement).textContent!.trim();
  }

  it('formata moeda, decimal, inteiro e percentual em pt-BR', () => {
    expect(texto('moeda')).toBe('R$ 1.234,50');
    expect(texto('decimal')).toBe('10,123456');
    expect(texto('inteiro')).toBe('1.234.567');
    expect(texto('percentual')).toBe('18,5%');
  });

  it('formata data sem deslocar por fuso e mantém o vazio vazio', () => {
    expect(texto('data')).toBe('10/08/2026');
    expect(texto('datahora')).toBe('10/08/2026 14:35');
    expect(texto('cnpj')).toBe('12.345.678/0001-90');
    expect(texto('vazio')).toBe('');
  });
});
