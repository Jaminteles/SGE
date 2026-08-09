import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('gera hash argon2id e valida a senha correta', async () => {
    const hash = await service.hash('SenhaForte123');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(service.verify(hash, 'SenhaForte123')).resolves.toBe(true);
  });

  it('rejeita senha incorreta', async () => {
    const hash = await service.hash('SenhaForte123');
    await expect(service.verify(hash, 'senhaErrada')).resolves.toBe(false);
  });

  it('não lança para hash malformado', async () => {
    await expect(service.verify('nao-e-um-hash', 'qualquer')).resolves.toBe(false);
  });
});
