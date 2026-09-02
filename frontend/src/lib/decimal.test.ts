import { describe, expect, it } from 'vitest';
import { formatCurrency, formatDecimal, isCanonicalDecimal, parseDecimalInput } from './decimal';

describe('parseDecimalInput', () => {
  it('converte o formato pt-BR para o canônico da API', () => {
    expect(parseDecimalInput('1.234,56').value).toBe('1234.56');
    expect(parseDecimalInput('12.450,00').value).toBe('12450.00');
    expect(parseDecimalInput('870').value).toBe('870.00');
    expect(parseDecimalInput('0,5').value).toBe('0.50');
    expect(parseDecimalInput('-6.200,00').value).toBe('-6200.00');
  });

  it('aceita o formato canônico digitado direto', () => {
    expect(parseDecimalInput('1234.56').value).toBe('1234.56');
  });

  it('preserva centavos sem passar por ponto flutuante', () => {
    // 0.1 + 0.2 em float daria 0.30000000000000004; aqui a string é intocada.
    expect(parseDecimalInput('0,10').value).toBe('0.10');
    expect(parseDecimalInput('0,20').value).toBe('0.20');
    expect(parseDecimalInput('999999999999999,99').value).toBe('999999999999999.99');
  });

  it('recusa mais de duas casas decimais', () => {
    const result = parseDecimalInput('10,999');
    expect(result.value).toBeNull();
    expect(result.error).toBe('Use no máximo 2 casas decimais.');
  });

  it('recusa entrada não numérica', () => {
    expect(parseDecimalInput('abc').error).toBe('Valor inválido.');
    expect(parseDecimalInput('12a,00').error).toBe('Valor inválido.');
  });

  it('trata vazio conforme obrigatoriedade', () => {
    expect(parseDecimalInput('')).toEqual({ value: null, error: null });
    expect(parseDecimalInput('  ', { required: true }).error).toBe('Informe um valor.');
  });
});

describe('formatDecimal / formatCurrency', () => {
  it('exibe em pt-BR com duas casas', () => {
    expect(formatDecimal('1234.5')).toBe('1.234,50');
    expect(formatDecimal('45900.00')).toBe('45.900,00');
    expect(formatDecimal('-8450')).toBe('-8.450,00');
    expect(formatCurrency('285430.50')).toBe('R$ 285.430,50');
  });

  it('devolve vazio para valor ausente', () => {
    expect(formatDecimal(null)).toBe('');
    expect(formatCurrency(undefined)).toBe('');
  });
});

describe('isCanonicalDecimal', () => {
  it('reconhece o formato aceito pela API', () => {
    expect(isCanonicalDecimal('1234.56')).toBe(true);
    expect(isCanonicalDecimal('1.234,56')).toBe(false);
  });
});
