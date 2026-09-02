import { describe, expect, it } from 'vitest';
import { formatCnpj, formatDate, formatDateTime, initials } from './format';

describe('formatDate', () => {
  it('exibe data ISO em pt-BR sem deslocar por fuso', () => {
    expect(formatDate('2026-08-10')).toBe('10/08/2026');
    expect(formatDate('2026-08-10T23:30:00-03:00')).toBe('10/08/2026');
  });

  it('devolve vazio ou o próprio valor quando não reconhece', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('sem data')).toBe('sem data');
  });
});

describe('formatDateTime', () => {
  it('devolve o valor original quando não é data', () => {
    expect(formatDateTime('qualquer coisa')).toBe('qualquer coisa');
    expect(formatDateTime(undefined)).toBe('');
  });
});

describe('initials', () => {
  it('usa primeiro e último nome', () => {
    expect(initials('Jamile Teles')).toBe('JT');
    expect(initials('Ana')).toBe('A');
    expect(initials('  ')).toBe('?');
  });
});

describe('formatCnpj', () => {
  it('formata 14 dígitos e devolve o valor cru quando não é CNPJ', () => {
    expect(formatCnpj('12345678000190')).toBe('12.345.678/0001-90');
    expect(formatCnpj('123')).toBe('123');
    expect(formatCnpj(null)).toBe('');
  });
});
