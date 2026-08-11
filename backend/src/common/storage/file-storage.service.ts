import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/** Arquivo recebido no multipart. Tipado aqui para não depender de @types/multer. */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Metadados do arquivo já armazenado — viram a linha de `gestao.documento`. */
export interface StoredFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageProvider: string;
  storageKey: string;
}

/**
 * Tipos aceitos como comprovante (RF-019), com a assinatura que precisa estar
 * no início do arquivo. A extensão vem daqui, nunca do nome enviado: é o que
 * impede que um `.html` ou `.svg` — executáveis no navegador — seja guardado e
 * depois servido de volta pelo download.
 */
const ACCEPTED_TYPES = [
  { mimeType: 'application/pdf', extension: '.pdf', magic: [0x25, 0x50, 0x44, 0x46] },
  { mimeType: 'image/jpeg', extension: '.jpg', magic: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/png', extension: '.png', magic: [0x89, 0x50, 0x4e, 0x47] },
] as const;

const MAX_FILE_NAME = 120;

/**
 * Hash do conteúdo. Exposto à parte para que o chamador possa reconhecer um
 * arquivo já enviado **antes** de gravá-lo — evita deixar órfão no storage.
 */
export function sha256Of(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Armazenamento de arquivos em disco local (RF-019).
 *
 * O provedor de referência da ERS é S3 (`documento.storage_provider`); esta
 * implementação cobre a sprint sem infraestrutura externa e mantém o contrato:
 * quem grava devolve `storageKey`, e é só isso que a aplicação guarda.
 *
 * A chave é sempre gerada aqui, a partir da empresa e de um uuid. Nenhum trecho
 * de caminho vem do cliente — nome de arquivo com `../` é um clássico, e o
 * caminho ainda é conferido contra a raiz antes de qualquer leitura.
 */
@Injectable()
export class FileStorageService {
  private readonly root: string;
  private readonly maxBytes: number;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('STORAGE_LOCAL_ROOT') ?? './storage');
    this.maxBytes = Number(config.get('UPLOAD_MAX_BYTES') ?? 10 * 1024 * 1024);
  }

  /** Limite aceito, para o interceptor de upload recusar antes de bufferizar. */
  get maxFileBytes(): number {
    return this.maxBytes;
  }

  async save(companyId: string, scope: string, file: UploadedFile): Promise<StoredFile> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Arquivo vazio.');
    }
    if (file.buffer.length > this.maxBytes) {
      throw new BadRequestException(
        `Arquivo maior que o limite de ${Math.floor(this.maxBytes / 1024 / 1024)} MB.`,
      );
    }

    const type = this.detectType(file);
    const storageKey = `${companyId}/${scope}/${new Date().getUTCFullYear()}/${randomUUID()}${type.extension}`;
    const target = this.resolveKey(storageKey);

    await mkdir(dirname(target), { recursive: true });
    // `wx`: a chave contém um uuid — se o arquivo já existe, algo está errado e
    // sobrescrever apagaria um comprovante alheio.
    await writeFile(target, file.buffer, { flag: 'wx' });

    return {
      fileName: this.sanitizeFileName(file.originalname, type.extension),
      mimeType: type.mimeType,
      sizeBytes: file.buffer.length,
      sha256: sha256Of(file.buffer),
      storageProvider: 'LOCAL',
      storageKey,
    };
  }

  async read(storageKey: string): Promise<Buffer> {
    // A validação da chave fica fora do try: chave inválida é 400, arquivo
    // ausente é 404 — colapsar os dois esconderia a tentativa de escapar da raiz.
    const target = this.resolveKey(storageKey);
    try {
      return await readFile(target);
    } catch {
      throw new NotFoundException('Arquivo não encontrado no armazenamento.');
    }
  }

  /** O tipo declarado só vale se a assinatura do conteúdo confirmar (RNF-004). */
  private detectType(file: UploadedFile): (typeof ACCEPTED_TYPES)[number] {
    const declared = (file.mimetype ?? '').split(';')[0].trim().toLowerCase();
    const type = ACCEPTED_TYPES.find((t) => t.mimeType === declared);
    if (!type) {
      throw new BadRequestException(
        `Tipo não aceito. Envie ${ACCEPTED_TYPES.map((t) => t.mimeType).join(', ')}.`,
      );
    }
    const matches = type.magic.every((byte, idx) => file.buffer[idx] === byte);
    if (!matches) {
      throw new BadRequestException('O conteúdo do arquivo não corresponde ao tipo informado.');
    }
    return type;
  }

  /**
   * Nome apenas para exibição e download. Perde diretório, caracteres de
   * controle e aspas — o valor volta no cabeçalho `Content-Disposition`.
   */
  private sanitizeFileName(original: string, extension: string): string {
    const base = (original ?? '')
      .replace(/[\\/]/g, '_')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f"'<>|:*?]/g, '')
      .trim();
    const safe = base.length > 0 ? base : `comprovante${extension}`;
    return safe.slice(0, MAX_FILE_NAME);
  }

  /** Garante que a chave não escape da raiz configurada. */
  private resolveKey(storageKey: string): string {
    const target = resolve(join(this.root, storageKey));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new BadRequestException('Chave de armazenamento inválida.');
    }
    return target;
  }
}
