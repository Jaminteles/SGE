import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CryptoService, safeCompare, sha256 } from './crypto.service';

function serviceWith(key: string): CryptoService {
  return new CryptoService({ get: () => key } as unknown as ConfigService);
}

const KEY = randomBytes(32).toString('base64');

describe('CryptoService', () => {
  it('recupera o segredo cifrado', () => {
    const crypto = serviceWith(KEY);
    const secret = JSON.stringify({ apiKey: 'chave-do-banco', baseUrl: 'https://api.banco.test' });

    expect(crypto.decrypt(crypto.encrypt(secret))).toBe(secret);
  });

  it('usa IV diferente a cada cifragem', () => {
    const crypto = serviceWith(KEY);

    const first = Buffer.from(crypto.encrypt('mesmo-segredo')).toString('hex');
    const second = Buffer.from(crypto.encrypt('mesmo-segredo')).toString('hex');

    expect(first).not.toBe(second);
  });

  it('recusa conteúdo adulterado — GCM autentica o texto cifrado', () => {
    const crypto = serviceWith(KEY);
    const payload = Buffer.from(crypto.encrypt('credencial'));
    payload[payload.length - 1] ^= 0xff;

    expect(() => crypto.decrypt(payload)).toThrow(InternalServerErrorException);
  });

  it('recusa decifrar com outra chave', () => {
    const original = serviceWith(KEY);
    const outra = serviceWith(randomBytes(32).toString('base64'));

    expect(() => outra.decrypt(original.encrypt('credencial'))).toThrow(
      InternalServerErrorException,
    );
  });

  it('recusa chave que não tem 32 bytes', () => {
    expect(() => serviceWith(randomBytes(16).toString('base64'))).toThrow(
      InternalServerErrorException,
    );
  });

  it('sha256 é estável entre string e buffer', () => {
    expect(sha256('conteúdo')).toBe(sha256(Buffer.from('conteúdo', 'utf8')));
  });

  it('safeCompare distingue assinaturas de tamanhos diferentes sem estourar', () => {
    expect(safeCompare('abc', 'abc')).toBe(true);
    expect(safeCompare('abc', 'abcdef')).toBe(false);
  });
});
