import { deflateRawSync } from 'node:zlib';

interface ArchiveEntry {
  name: string;
  data: Buffer;
  compressed: Buffer;
  crc: number;
  offset: number;
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Escritor de ZIP mínimo, o suficiente para montar um `.xlsx`.
 *
 * Um `.xlsx` é um ZIP com XML dentro. O projeto não tem biblioteca de planilha,
 * e trazer uma para escrever cinco arquivos XML custaria mais em superfície de
 * dependência do que estas linhas custam em manutenção: aqui só existe o caso
 * `deflate` sem senha, sem Zip64 e sem diretório — que é exatamente o que a
 * especificação do OOXML pede.
 *
 * O formato é o do APPNOTE 6.3.3: entrada local, dados, diretório central e
 * "end of central directory". Nenhum descritor de dados, porque o tamanho e o
 * CRC são conhecidos antes de escrever.
 */
export class ZipArchive {
  private readonly entries: ArchiveEntry[] = [];
  private offset = 0;

  add(name: string, content: string | Buffer): void {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(data);
    this.entries.push({ name, data, compressed, crc: crc32(data), offset: this.offset });
    this.offset += 30 + Buffer.byteLength(name, 'utf8') + compressed.length;
  }

  toBuffer(): Buffer {
    const locals: Buffer[] = [];
    const central: Buffer[] = [];

    for (const entry of this.entries) {
      const name = Buffer.from(entry.name, 'utf8');

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // versão mínima
      local.writeUInt16LE(0x0800, 6); // nome em UTF-8
      local.writeUInt16LE(8, 8); // deflate
      local.writeUInt16LE(0, 10); // hora
      local.writeUInt16LE(0x21, 12); // data: 1980-01-01, fixa e reprodutível
      local.writeUInt32LE(entry.crc, 14);
      local.writeUInt32LE(entry.compressed.length, 18);
      local.writeUInt32LE(entry.data.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      locals.push(local, name, entry.compressed);

      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(8, 10);
      header.writeUInt16LE(0, 12);
      header.writeUInt16LE(0x21, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressed.length, 20);
      header.writeUInt32LE(entry.data.length, 24);
      header.writeUInt16LE(name.length, 28);
      header.writeUInt32LE(entry.offset, 42);
      central.push(header, name);
    }

    const centralBuffer = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(centralBuffer.length, 12);
    end.writeUInt32LE(this.offset, 16);

    return Buffer.concat([...locals, centralBuffer, end]);
  }
}
