import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Hashing de senhas com argon2id (RNF-001). Parâmetros conforme recomendação
 * OWASP (memória de 19 MiB, 2 iterações, paralelismo 1).
 */
@Injectable()
export class PasswordService {
  private readonly options = {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  };

  hash(plain: string): Promise<string> {
    return hash(plain, this.options);
  }

  async verify(hashValue: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashValue, plain, this.options);
    } catch {
      // Hash malformado/ inválido não deve derrubar a autenticação.
      return false;
    }
  }
}
