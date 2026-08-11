import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { FileStorageService, UploadedFile } from './file-storage.service';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(16, 2)]);

function upload(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    originalname: 'nota.pdf',
    mimetype: 'application/pdf',
    size: PDF.length,
    buffer: PDF,
    ...overrides,
  };
}

describe('FileStorageService', () => {
  let root: string;
  let service: FileStorageService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sge-storage-'));
    const config = {
      get: (key: string) => (key === 'STORAGE_LOCAL_ROOT' ? root : undefined),
    } as unknown as ConfigService;
    service = new FileStorageService(config);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('grava o arquivo e devolve hash, tamanho e chave sob a empresa', async () => {
    const stored = await service.save('empresa-1', 'comprovantes', upload());

    expect(stored.storageKey.startsWith('empresa-1/comprovantes/')).toBe(true);
    expect(stored.sizeBytes).toBe(PDF.length);
    expect(stored.sha256).toHaveLength(64);
    expect(readFileSync(join(root, ...stored.storageKey.split('/')))).toEqual(PDF);
  });

  // O nome do arquivo é entrada do cliente e vira caminho: nunca pode escapar.
  it('ignora diretório no nome enviado e gera a extensão pelo tipo', async () => {
    const stored = await service.save(
      'empresa-1',
      'comprovantes',
      upload({ originalname: '../../etc/passwd' }),
    );

    expect(stored.fileName).not.toContain('/');
    expect(stored.fileName).not.toContain('\\');
    expect(stored.storageKey.endsWith('.pdf')).toBe(true);
    expect(join(root, ...stored.storageKey.split('/')).startsWith(root + sep)).toBe(true);
  });

  it('remove aspas e caracteres de controle do nome exibido', async () => {
    const stored = await service.save(
      'empresa-1',
      'comprovantes',
      upload({ originalname: 'nota"; rm -rf\n.pdf' }),
    );

    expect(stored.fileName).not.toContain('"');
    expect(stored.fileName).not.toContain('\n');
  });

  it('recusa tipo fora da lista aceita', async () => {
    await expect(
      service.save('empresa-1', 'comprovantes', upload({ mimetype: 'text/html' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Declarar PDF e enviar outra coisa é a forma mais simples de contornar a lista.
  it('recusa conteúdo que não confere com o tipo declarado', async () => {
    await expect(
      service.save('empresa-1', 'comprovantes', upload({ buffer: PNG })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa arquivo vazio', async () => {
    await expect(
      service.save('empresa-1', 'comprovantes', upload({ buffer: Buffer.alloc(0) })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa leitura de chave que sai da raiz configurada', async () => {
    await expect(service.read('../../etc/passwd')).rejects.toBeInstanceOf(BadRequestException);
  });
});
