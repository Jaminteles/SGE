import { BadRequestException } from '@nestjs/common';
import { requireIdempotencyKey } from './idempotency-key';

describe('requireIdempotencyKey', () => {
  it('recusa a operação sem chave', () => {
    expect(() => requireIdempotencyKey(undefined, 'no registro de baixas')).toThrow(
      BadRequestException,
    );
    expect(() => requireIdempotencyKey('   ', 'no registro de baixas')).toThrow(
      'O header Idempotency-Key é obrigatório no registro de baixas.',
    );
  });

  it('recusa chave curta ou longa demais', () => {
    expect(() => requireIdempotencyKey('abc', 'x')).toThrow(BadRequestException);
    expect(() => requireIdempotencyKey('a'.repeat(256), 'x')).toThrow(BadRequestException);
  });

  it('devolve a chave sem espaços nas pontas', () => {
    expect(requireIdempotencyKey('  0b8f6c2e-baixa  ', 'x')).toBe('0b8f6c2e-baixa');
  });
});
