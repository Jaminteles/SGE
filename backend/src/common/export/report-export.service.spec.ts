import { Prisma } from '@prisma/client';
import { inflateRawSync } from 'node:zlib';
import { ReportExportService } from './report-export.service';
import { ReportDocument } from './report-document';

const document: ReportDocument = {
  title: 'Dashboard financeiro 2026-06-01 a 2026-06-30',
  subtitle: 'Dashboard financeiro',
  filters: [{ label: 'Período', value: '2026-06-01 a 2026-06-30' }],
  generatedAt: new Date('2026-07-01T12:00:00.000Z'),
  sections: [
    {
      title: 'Resumo financeiro',
      columns: [
        { key: 'indicador', label: 'Indicador' },
        { key: 'valor', label: 'Valor', numeric: true },
      ],
      rows: [
        { indicador: 'A receber em aberto', valor: new Prisma.Decimal('1250.5') },
        { indicador: '=CMD("calc")', valor: new Prisma.Decimal('0') },
      ],
      totals: { valor: new Prisma.Decimal('1250.5') },
    },
  ],
};

const service = new ReportExportService();

/** Lê um arquivo de dentro do zip pelo diretório central, como um leitor real. */
function readFromZip(archive: Buffer, name: string): string {
  const target = Buffer.from(name, 'utf8');
  const index = archive.indexOf(target);
  expect(index).toBeGreaterThan(0);

  // O primeiro cabeçalho local do arquivo procurado precede o nome em 30 bytes.
  const headerStart = index - 30;
  expect(archive.readUInt32LE(headerStart)).toBe(0x04034b50);
  const compressedSize = archive.readUInt32LE(headerStart + 18);
  const nameLength = archive.readUInt16LE(headerStart + 26);
  const extraLength = archive.readUInt16LE(headerStart + 28);
  const dataStart = headerStart + 30 + nameLength + extraLength;

  return inflateRawSync(archive.subarray(dataStart, dataStart + compressedSize)).toString('utf8');
}

describe('ReportExportService (RF-113)', () => {
  it('gera CSV com BOM, separador ponto e vírgula e decimal de duas casas', () => {
    const rendered = service.render(document, 'csv');
    const text = rendered.content.toString('utf8');

    expect(rendered.contentType).toContain('text/csv');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('"A receber em aberto";"1250.50"');
    expect(text).toContain('"TOTAL";"1250.50"');
  });

  it('neutraliza fórmula no CSV (CSV injection)', () => {
    const text = service.render(document, 'csv').content.toString('utf8');

    // O campo continua legível, mas a planilha não o executa.
    expect(text).toContain(`"'=CMD(""calc"")"`);
    expect(text).not.toContain('"=CMD');
  });

  it('gera XLSX com o número como número, e não como texto', () => {
    const rendered = service.render(document, 'xlsx');

    expect(rendered.contentType).toContain('spreadsheetml');
    expect(rendered.content.readUInt32LE(0)).toBe(0x04034b50);

    const sheet = readFromZip(rendered.content, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<v>1250.50</v>');
    expect(sheet).toContain('A receber em aberto');
    // A fórmula vai como texto puro; célula de string não é avaliada pelo Excel.
    expect(sheet).toContain('t="inlineStr"');
  });

  it('declara no workbook uma aba por seção', () => {
    const rendered = service.render(document, 'xlsx');
    const workbook = readFromZip(rendered.content, 'xl/workbook.xml');

    expect(workbook).toContain('Resumo financeiro_1');
  });

  it('gera PDF com cabeçalho, xref e o conteúdo do relatório', () => {
    const rendered = service.render(document, 'pdf');
    const text = rendered.content.toString('latin1');

    expect(rendered.contentType).toBe('application/pdf');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('startxref');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('A receber em aberto');
  });

  it('escapa parêntese no PDF, que delimita string no formato', () => {
    const text = service
      .render(
        {
          ...document,
          sections: [
            {
              title: 'Parceiros',
              columns: [{ key: 'nome', label: 'Nome' }],
              rows: [{ nome: 'ACME (Brasil) Ltda' }],
            },
          ],
        },
        'pdf',
      )
      .content.toString('latin1');

    expect(text).toContain('ACME \\(Brasil\\) Ltda');
  });

  it('gera o nome do arquivo no servidor, sem caractere de cabeçalho', () => {
    for (const format of ['csv', 'xlsx', 'pdf'] as const) {
      const { filename } = service.render(document, format);
      expect(filename).toBe(`dashboard_financeiro_2026_06_01_a_2026_06_30.${format}`);
      expect(filename).not.toMatch(/["\r\n;]/);
    }
  });
});
