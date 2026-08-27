import { ReportDocument, ReportSection, formatCell } from './report-document';

/** Marca de ordem de bytes UTF-8, exigida pelo Excel para abrir o CSV acentuado. */
const BOM = '\uFEFF';

/**
 * CSV do relatório (RF-113).
 *
 * Mesmas escolhas do exportador contábil (RF-087), pelos mesmos motivos: `;`
 * porque a planilha em português espera isso e o decimal usa ponto, e todo campo
 * entre aspas.
 *
 * Um documento com várias seções vira um CSV só, com a seção anunciada em uma
 * linha antes do seu cabeçalho. Um arquivo por seção obrigaria a devolver um zip
 * — e quem abre CSV quer abrir CSV.
 */
export function renderCsv(document: ReportDocument): Buffer {
  const lines: string[] = [escape(document.title)];
  if (document.subtitle) lines.push(escape(document.subtitle));
  for (const filter of document.filters ?? []) {
    lines.push([escape(filter.label), escape(filter.value)].join(';'));
  }
  lines.push(escape(`Gerado em ${document.generatedAt.toISOString()}`));

  for (const section of document.sections) {
    lines.push('');
    lines.push(escape(section.title));
    lines.push(...sectionLines(section));
  }

  // BOM: sem ele o Excel abre o arquivo em ANSI e todo acento vira caractere
  // trocado — o relatório fica certo e parece corrompido.
  return Buffer.concat([Buffer.from(BOM, 'utf8'), Buffer.from(lines.join('\r\n'), 'utf8')]);
}

function sectionLines(section: ReportSection): string[] {
  const header = section.columns.map((column) => escape(column.label)).join(';');
  const rows = section.rows.map((row) =>
    section.columns.map((column) => escape(formatCell(row[column.key], column.numeric))).join(';'),
  );

  if (!section.totals) return [header, ...rows];

  const totals = section.columns
    .map((column, index) =>
      escape(index === 0 ? 'TOTAL' : formatCell(section.totals?.[column.key], column.numeric)),
    )
    .join(';');

  return [header, ...rows, totals];
}

/**
 * Escapa o campo e neutraliza fórmula.
 *
 * Descrição de título, nome de parceiro e observação são texto digitado por
 * usuário; uma planilha trata `=CMD(...)` como fórmula ao abrir o arquivo
 * (CSV injection).
 */
function escape(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
