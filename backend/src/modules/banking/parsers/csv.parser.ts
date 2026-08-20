import {
  MAX_STATEMENT_ENTRIES,
  ParsedStatement,
  ParsedStatementEntry,
  StatementParseError,
} from './statement.types';

/** Sinônimos aceitos por coluna — bancos brasileiros não combinaram nomes. */
const COLUMNS: Record<string, string[]> = {
  date: ['data', 'data lancamento', 'data movimento', 'date', 'data_movimento'],
  amount: ['valor', 'amount', 'valor (r$)', 'valor r$'],
  description: ['descricao', 'historico', 'lancamento', 'memo', 'description'],
  document: ['documento', 'doc', 'numero documento', 'nr documento'],
  externalId: ['identificador', 'id', 'fitid', 'codigo'],
  direction: ['tipo', 'sentido', 'natureza', 'd/c'],
};

/**
 * Leitor de CSV de extrato (RF-060).
 *
 * Não existe CSV padrão de extrato: cada banco escolhe separador, nome de coluna
 * e formato de data. O que este leitor assume é o mínimo comum — cabeçalho na
 * primeira linha útil, uma data e um valor por linha — e o resto é reconhecido
 * por sinônimo. O que não for reconhecido vira erro de importação com a linha
 * citada, e não uma linha silenciosamente ignorada: extrato com lançamento
 * faltando é pior que extrato que não importou.
 *
 * O sinal do valor define o sentido; havendo coluna de tipo (`D`/`C`), ela ganha
 * — é mais explícita que a convenção de sinal, que varia entre bancos.
 */
export function parseCsv(content: string): ParsedStatement {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new StatementParseError('O arquivo CSV não tem cabeçalho e lançamentos.');
  }

  const separator = detectSeparator(lines[0]);
  const header = splitLine(lines[0], separator).map(normalizeHeader);
  const index = mapColumns(header);

  if (index.date === undefined || index.amount === undefined) {
    throw new StatementParseError(
      'O CSV precisa de uma coluna de data e uma de valor. Colunas encontradas: ' +
        header.join(', '),
    );
  }

  const entries: ParsedStatementEntry[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    if (entries.length >= MAX_STATEMENT_ENTRIES) {
      throw new StatementParseError(
        `O arquivo tem mais de ${MAX_STATEMENT_ENTRIES} lançamentos. Importe por período menor.`,
      );
    }

    const cells = splitLine(lines[i], separator);
    const rawDate = cells[index.date]?.trim();
    const rawAmount = cells[index.amount]?.trim();
    if (!rawDate && !rawAmount) {
      continue;
    }

    const movementDate = toIsoDate(rawDate, i + 1);
    const amount = normalizeAmount(rawAmount, i + 1);
    const declared = index.direction !== undefined ? cells[index.direction]?.trim() : undefined;

    entries.push({
      movementDate,
      direction: resolveDirection(declared, rawAmount),
      amount,
      description: pick(cells, index.description),
      document: pick(cells, index.document),
      externalId: pick(cells, index.externalId),
    });
  }

  if (entries.length === 0) {
    throw new StatementParseError('Nenhum lançamento encontrado no arquivo CSV.');
  }

  const dates = entries.map((entry) => entry.movementDate).sort();
  return { periodStart: dates[0], periodEnd: dates[dates.length - 1], entries };
}

function detectSeparator(headerLine: string): string {
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  if (tabs > semicolons && tabs > commas) return '\t';
  return semicolons >= commas ? ';' : ',';
}

/** Divide respeitando aspas — descrição com separador dentro é comum. */
function splitLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === separator && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/["']/g, '');
}

function mapColumns(header: string[]): Record<string, number | undefined> {
  const index: Record<string, number | undefined> = {};
  for (const [field, aliases] of Object.entries(COLUMNS)) {
    index[field] = header.findIndex((name) => aliases.includes(name));
    if (index[field] === -1) {
      index[field] = undefined;
    }
  }
  return index;
}

function pick(cells: string[], position: number | undefined): string | undefined {
  if (position === undefined) return undefined;
  const value = cells[position]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** Aceita `DD/MM/AAAA`, `AAAA-MM-DD` e `DD-MM-AAAA`. */
function toIsoDate(raw: string | undefined, line: number): string {
  if (!raw) {
    throw new StatementParseError(`Linha ${line}: data ausente.`);
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const br = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(raw);
  if (br) {
    return `${br[3]}-${br[2]}-${br[1]}`;
  }
  throw new StatementParseError(`Linha ${line}: data "${raw}" em formato não reconhecido.`);
}

/**
 * `1.234,56`, `1234.56` e `-1.234,56` viram `1234.56`.
 *
 * A regra do separador decimal: se há vírgula, ela é o decimal e o ponto é
 * milhar (formato brasileiro); sem vírgula, o ponto é o decimal.
 */
function normalizeAmount(raw: string | undefined, line: number): string {
  if (!raw) {
    throw new StatementParseError(`Linha ${line}: valor ausente.`);
  }
  const cleaned = raw.replace(/[R$\s+]/gi, '').replace(/^-/, '');
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new StatementParseError(`Linha ${line}: valor "${raw}" não é um decimal válido.`);
  }
  return normalized;
}

function resolveDirection(declared: string | undefined, rawAmount: string | undefined) {
  const flag = declared?.trim().toUpperCase();
  if (flag) {
    if (flag.startsWith('D') || flag.includes('DEBIT') || flag.includes('SAI')) return 'DEBITO';
    if (flag.startsWith('C') || flag.includes('CREDIT') || flag.includes('ENTR')) return 'CREDITO';
  }
  return rawAmount?.trim().startsWith('-') ? 'DEBITO' : 'CREDITO';
}
