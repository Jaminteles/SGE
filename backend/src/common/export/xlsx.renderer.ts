import { Prisma } from '@prisma/client';
import { ReportCellValue, ReportDocument, ReportSection, formatCell } from './report-document';
import { ZipArchive } from './zip-archive';

/**
 * XLSX do relatório (RF-113).
 *
 * Uma aba por seção, e os números vão como número — não como texto. É a única
 * razão de existir XLSX aqui em vez de só CSV: quem exporta a carteira vai somar
 * a coluna na planilha, e uma coluna de texto soma zero sem avisar.
 *
 * O arquivo usa `inlineStr` em vez da tabela de strings compartilhadas: com uma
 * tabela a mais o arquivo fica menor, mas passa a ter duas partes que precisam
 * concordar entre si — e um relatório de algumas centenas de linhas não paga
 * esse risco.
 */
export function renderXlsx(document: ReportDocument): Buffer {
  const sheets = document.sections.map((section, index) => ({
    name: sheetName(section.title, index),
    xml: sheetXml(section),
  }));

  if (sheets.length === 0) {
    sheets.push({ name: 'Relatorio', xml: sheetXml({ title: '', columns: [], rows: [] }) });
  }

  const zip = new ZipArchive();

  zip.add(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      sheets
        .map(
          (_, index) =>
            `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ` +
            `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      `</Types>`,
  );

  zip.add(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );

  zip.add(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
      sheets
        .map(
          (sheet, index) =>
            `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
        )
        .join('') +
      `</sheets></workbook>`,
  );

  zip.add(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map(
          (_, index) =>
            `<Relationship Id="rId${index + 1}" ` +
            `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
            `Target="worksheets/sheet${index + 1}.xml"/>`,
        )
        .join('') +
      `</Relationships>`,
  );

  sheets.forEach((sheet, index) => zip.add(`xl/worksheets/sheet${index + 1}.xml`, sheet.xml));

  return zip.toBuffer();
}

function sheetXml(section: ReportSection): string {
  const rows: string[] = [];
  let index = 1;

  if (section.title) rows.push(row(index++, [{ value: section.title }]));
  if (section.columns.length > 0) {
    rows.push(
      row(
        index++,
        section.columns.map((column) => ({ value: column.label })),
      ),
    );
  }

  for (const line of section.rows) {
    rows.push(
      row(
        index++,
        section.columns.map((column) => cellOf(line[column.key], column.numeric)),
      ),
    );
  }

  if (section.totals) {
    rows.push(
      row(
        index++,
        section.columns.map((column, position) =>
          position === 0
            ? { value: 'TOTAL' }
            : cellOf(section.totals?.[column.key], column.numeric),
        ),
      ),
    );
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    rows.join('') +
    `</sheetData></worksheet>`
  );
}

interface Cell {
  value: string;
  numeric?: boolean;
}

/**
 * Decide entre célula numérica e textual.
 *
 * Só vira número o que já era número no banco. Um código de conta como `1.01.02`
 * é texto, e deixá-lo virar número o transformaria em data na abertura do
 * arquivo — o clássico do NCM que vira notação científica.
 */
function cellOf(value: ReportCellValue, numeric?: boolean): Cell {
  const text = formatCell(value, numeric);
  if (!numeric || text === '') return { value: text };
  const isNumber = typeof value === 'number' || Prisma.Decimal.isDecimal(value);
  return { value: text, numeric: isNumber };
}

function row(index: number, cells: Cell[]): string {
  const body = cells
    .map((cell, position) => {
      const reference = `${columnName(position)}${index}`;
      if (cell.numeric) return `<c r="${reference}"><v>${escapeXml(cell.value)}</v></c>`;
      return (
        `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">` +
        `${escapeXml(cell.value)}</t></is></c>`
      );
    })
    .join('');
  return `<row r="${index}">${body}</row>`;
}

function columnName(index: number): string {
  let name = '';
  let value = index;
  do {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return name;
}

/**
 * Nome de aba válido: até 31 caracteres, sem `: \ / ? * [ ]`, único na pasta.
 *
 * O Excel não abre o arquivo quando um deles é violado — falha no arquivo
 * inteiro, não na aba.
 */
function sheetName(title: string, index: number): string {
  const clean = title.replace(/[:\\/?*[\]]/g, ' ').trim() || `Secao ${index + 1}`;
  const suffix = `_${index + 1}`;
  return `${clean.slice(0, 31 - suffix.length)}${suffix}`;
}

function escapeXml(value: string): string {
  return stripControl(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Remove caractere de controle.
 *
 * Não é válido em XML 1.0 e derruba a abertura do arquivo inteiro — e uma
 * observação vinda de importação de extrato ou de OCR pode trazer um.
 */
function stripControl(value: string): string {
  return [...value].filter((char) => char.charCodeAt(0) >= 0x20).join('');
}
