import { ReportDocument, ReportSection, formatCell } from './report-document';

/** A4 paisagem, em pontos. Relatório de gestão tem mais coluna que altura. */
const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 36;
const FONT_SIZE = 8;
/** Courier: 0,6 em de largura por caractere, em qualquer caractere. */
const CHAR_WIDTH = FONT_SIZE * 0.6;
const LINE_HEIGHT = 11;
const MAX_COLUMNS = Math.floor((PAGE_WIDTH - 2 * MARGIN) / CHAR_WIDTH);
const MAX_LINES = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LINE_HEIGHT);

/**
 * PDF do relatório (RF-113).
 *
 * O PDF aqui é o formato de **conferência e arquivo**: é o que se imprime, se
 * anexa a uma ata e se manda para quem não vai recalcular nada. Quem vai
 * recalcular pede XLSX.
 *
 * Por isso ele é montado em Courier, com as colunas alinhadas por preenchimento
 * de espaço: fonte de largura fixa é a única forma de uma tabela ficar alinhada
 * sem uma engine de layout, e uma engine de layout é a biblioteca que este
 * módulo não traz. O preço é largura limitada — colunas que não cabem na página
 * são truncadas com `>`, e não empurradas para fora do papel em silêncio.
 *
 * Estrutura: PDF 1.4, um objeto por página, um stream de conteúdo por página,
 * fonte Courier base-14 (não embutida, presente em todo leitor).
 * Texto em WinAnsi, que é o que cobre o português.
 */
export function renderPdf(document: ReportDocument): Buffer {
  const lines: string[] = [document.title];
  if (document.subtitle) lines.push(document.subtitle);
  for (const filter of document.filters ?? []) {
    lines.push(`${filter.label}: ${filter.value}`);
  }
  lines.push(`Gerado em ${document.generatedAt.toISOString()}`);

  for (const section of document.sections) {
    lines.push('');
    lines.push(...sectionLines(section));
  }

  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += MAX_LINES) {
    pages.push(lines.slice(index, index + MAX_LINES));
  }
  if (pages.length === 0) pages.push([document.title]);

  return assemble(pages);
}

/** Uma seção vira cabeçalho, régua, linhas e, se houver, a linha de total. */
function sectionLines(section: ReportSection): string[] {
  const widths = section.columns.map((column) => {
    const values = section.rows.map((row) => formatCell(row[column.key], column.numeric).length);
    const total = section.totals
      ? formatCell(section.totals[column.key], column.numeric).length
      : 0;
    return Math.max(column.label.length, total, ...values, 3);
  });

  const render = (cells: string[]) =>
    truncate(
      cells
        .map((cell, index) =>
          section.columns[index].numeric
            ? cell.padStart(widths[index])
            : cell.padEnd(widths[index]),
        )
        .join('  '),
    );

  const out = [
    truncate(section.title),
    render(section.columns.map((column) => column.label)),
    truncate(
      '-'.repeat(
        Math.min(
          widths.reduce((a, b) => a + b + 2, 0),
          MAX_COLUMNS,
        ),
      ),
    ),
    ...section.rows.map((row) =>
      render(section.columns.map((column) => formatCell(row[column.key], column.numeric))),
    ),
  ];

  if (section.totals) {
    out.push(
      render(
        section.columns.map((column, index) =>
          index === 0 ? 'TOTAL' : formatCell(section.totals?.[column.key], column.numeric),
        ),
      ),
    );
  }

  return out;
}

function truncate(line: string): string {
  return line.length <= MAX_COLUMNS ? line : `${line.slice(0, MAX_COLUMNS - 1)}>`;
}

function assemble(pages: string[][]): Buffer {
  const objects: string[] = [];
  const pageCount = pages.length;
  // 1: catálogo, 2: árvore de páginas, 3: fonte; daí em diante um par
  // (página, conteúdo) por página.
  const firstPageObject = 4;
  const pageIds = pages.map((_, index) => firstPageObject + index * 2);

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Count ${pageCount} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');

  pages.forEach((page, index) => {
    const contentId = pageIds[index] + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );

    const body =
      `BT /F1 ${FONT_SIZE} Tf ${LINE_HEIGHT} TL ` +
      `1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - MARGIN} Tm\n` +
      page.map((line) => `(${escapePdf(line)}) Tj T*\n`).join('') +
      'ET';
    objects.push(`<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`);
  });

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  let position = chunks[0].length;

  objects.forEach((object, index) => {
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'latin1');
    offsets.push(position);
    position += chunk.length;
    chunks.push(chunk);
  });

  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`;

  chunks.push(Buffer.from(xref + trailer, 'latin1'));
  return Buffer.concat(chunks);
}

/**
 * Escapa o texto do stream.
 *
 * Parêntese e barra invertida delimitam string em PDF: um nome de parceiro com
 * `(` desalinharia o restante do arquivo, e o leitor simplesmente não abriria o
 * documento. O que não existe em WinAnsi vira `?` — melhor um caractere trocado
 * do que um PDF que não abre.
 */
function escapePdf(line: string): string {
  return line
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .split('')
    .map((char) => (char.charCodeAt(0) <= 255 ? char : '?'))
    .join('');
}
