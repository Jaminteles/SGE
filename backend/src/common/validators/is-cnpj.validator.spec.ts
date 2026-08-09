import { isValidCnpj, onlyDigits } from './is-cnpj.validator';

describe('isValidCnpj', () => {
  it('aceita CNPJ válido com e sem máscara', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
  });

  it('rejeita dígitos verificadores incorretos', () => {
    expect(isValidCnpj('11222333000180')).toBe(false);
  });

  it('rejeita tamanho inválido', () => {
    expect(isValidCnpj('1122233300')).toBe(false);
  });

  it('rejeita sequências repetidas', () => {
    expect(isValidCnpj('00000000000000')).toBe(false);
  });

  it('onlyDigits remove máscara', () => {
    expect(onlyDigits('11.222.333/0001-81')).toBe('11222333000181');
  });
});
