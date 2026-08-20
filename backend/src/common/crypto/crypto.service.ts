import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** AES-256-GCM: 12 bytes de IV (recomendação do NIST) e 16 de tag. */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Criptografia simétrica dos segredos de integração (RNF-003/RNF-005).
 *
 * Guarda credencial de banco — o que assina uma ordem de pagamento. Três
 * decisões que vêm daí:
 *
 *  1. **GCM, não CBC**: o texto cifrado é autenticado. Um byte trocado no banco
 *     faz a decifragem falhar, em vez de devolver lixo que o adaptador tentaria
 *     mandar para o provedor;
 *  2. **a chave vem do ambiente**, nunca do código nem do banco. `chave_kms` em
 *     `credencial_integracao` existe para quando ela passar a viver num KMS —
 *     o formato gravado (`iv || tag || ciphertext`) não muda;
 *  3. **nada aqui loga**. Nem o texto claro, nem o cifrado, nem a chave.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('INTEGRATION_ENCRYPTION_KEY') ?? '';
    const key = Buffer.from(raw, 'base64');
    // O env já é validado no boot (env.validation.ts); esta é a segunda linha,
    // para o caso de o serviço ser instanciado fora do ciclo do ConfigModule.
    if (key.length !== KEY_BYTES) {
      throw new InternalServerErrorException(
        'INTEGRATION_ENCRYPTION_KEY deve ser 32 bytes em base64.',
      );
    }
    this.key = key;
  }

  /**
   * Cifra o segredo. O IV é sorteado a cada chamada — nunca reutilizado.
   *
   * Devolve `Uint8Array` porque é o que a coluna `bytea` espera no Prisma; o
   * `Buffer` do Node não satisfaz o tipo quando o `ArrayBuffer` é genérico.
   */
  encrypt(plaintext: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    const copy = new Uint8Array(new ArrayBuffer(payload.length));
    copy.set(payload);
    return copy;
  }

  /** Decifra; lança se o conteúdo foi adulterado ou a chave mudou. */
  decrypt(value: Uint8Array): string {
    const payload = Buffer.from(value);
    if (payload.length <= IV_BYTES + TAG_BYTES) {
      throw new InternalServerErrorException('Credencial armazenada em formato inválido.');
    }
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // A causa original não vai adiante de propósito: ela diferencia chave
      // errada de conteúdo adulterado, e isso é informação para quem ataca.
      throw new InternalServerErrorException(
        'Não foi possível decifrar a credencial de integração.',
      );
    }
  }
}

/** SHA-256 em hexadecimal — hash de corpo de requisição e de arquivo. */
export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Compara duas assinaturas em tempo constante.
 *
 * `timingSafeEqual` exige buffers do mesmo tamanho; comparar os comprimentos
 * antes vazaria o tamanho da assinatura esperada, então o que se compara é o
 * hash de cada uma — sempre 32 bytes.
 */
export function safeCompare(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}
