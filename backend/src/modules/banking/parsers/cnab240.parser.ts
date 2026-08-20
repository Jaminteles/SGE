import {
  MAX_STATEMENT_ENTRIES,
  ParsedStatement,
  ParsedStatementEntry,
  StatementParseError,
} from './statement.types';

/** Comprimento nominal do registro CNAB 240, sem o terminador de linha. */
const RECORD_LENGTH = 240;

/** Posições 1-based do layout FEBRABAN, como aparecem no manual do banco. */
const FIELD = {
  recordType: [8, 8],
  segment: [14, 14],
  // Segmento E — detalhe do extrato.
  movementDate: [155, 162],
  amount: [163, 180],
  direction: [181, 181],
  document: [196, 210],
  description: [211, 230],
  // Trailer de lote (registro 5) — saldos e período.
  trailerOpeningBalance: [42, 59],
  trailerOpeningSign: [60, 60],
  trailerClosingBalance: [61, 78],
  trailerClosingSign: [79, 79],
} as const;

/**
 * Leitor de extrato CNAB 240 (RF-071).
 *
 * É o formato que os bancos entregam quando o cliente tem convênio de cobrança
 * e não quer OFX — e o único dos três que é posicional. Isso muda o que dá
 * errado: no OFX e no CSV o risco é a tag ou a coluna faltar; aqui é a linha ter
 * comprimento diferente do layout e todo campo sair deslocado em silêncio. Por
 * isso o comprimento é conferido antes de qualquer recorte, e uma linha curta
 * derruba a importação em vez de virar um lançamento com valor de outro campo.
 *
 * Só o **segmento E** é lido: é ele que carrega o movimento do extrato. Os
 * segmentos de cobrança (T/U) descrevem títulos, não o que o banco fez com o
 * dinheiro, e conciliá-los seria conciliar contra a expectativa em vez de contra
 * o fato.
 *
 * Como nos outros leitores, valor não passa por `number`: os 15 dígitos + 2
 * decimais do layout viram string decimal direto para `Prisma.Decimal`.
 */
export function parseCnab240(content: string): ParsedStatement {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new StatementParseError('O arquivo CNAB 240 está vazio.');
  }

  const entries: ParsedStatementEntry[] = [];
  let openingBalance: string | undefined;
  let closingBalance: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // O CNAB permite preenchimento à direita com brancos: o que não se aceita é
    // a linha ser mais curta que o layout, porque aí o recorte pega outro campo.
    if (line.length < RECORD_LENGTH) {
      throw new StatementParseError(
        `Linha ${i + 1} tem ${line.length} caracteres: o registro CNAB 240 tem ${RECORD_LENGTH}.`,
      );
    }

    const recordType = at(line, FIELD.recordType);

    if (recordType === '5') {
      openingBalance ??= balance(line, FIELD.trailerOpeningBalance, FIELD.trailerOpeningSign);
      closingBalance = balance(line, FIELD.trailerClosingBalance, FIELD.trailerClosingSign);
      continue;
    }

    if (recordType !== '3' || at(line, FIELD.segment) !== 'E') {
      continue;
    }

    if (entries.length >= MAX_STATEMENT_ENTRIES) {
      throw new StatementParseError(
        `O arquivo tem mais de ${MAX_STATEMENT_ENTRIES} lançamentos. Importe por período menor.`,
      );
    }

    const rawAmount = at(line, FIELD.amount);
    const amount = toDecimal(rawAmount);
    if (!amount || amount === '0.00') {
      continue;
    }

    const document = at(line, FIELD.document).replace(/^0+/, '');

    entries.push({
      movementDate: toIsoDate(at(line, FIELD.movementDate), i + 1),
      direction: at(line, FIELD.direction) === 'D' ? 'DEBITO' : 'CREDITO',
      amount,
      description: at(line, FIELD.description) || undefined,
      document: document || undefined,
    });
  }

  if (entries.length === 0) {
    throw new StatementParseError(
      'Nenhum lançamento de extrato (segmento E) encontrado no arquivo CNAB 240.',
    );
  }

  const dates = entries.map((entry) => entry.movementDate).sort();

  return {
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    openingBalance,
    closingBalance,
    entries,
  };
}

/** Reconhece o arquivo pelo cabeçalho: registro 0 no primeiro bloco de 240. */
export function isCnab240(content: string): boolean {
  const first = content.split(/\r?\n/).find((line) => line.trim().length > 0);
  return first !== undefined && first.length >= RECORD_LENGTH && at(first, FIELD.recordType) === '0';
}

/** Recorte 1-based, como o manual do layout numera as posições. */
function at(line: string, [start, end]: readonly [number, number]): string {
  return line.slice(start - 1, end).trim();
}

/** `15(9)v99` do layout: os dois últimos dígitos são os centavos. */
function toDecimal(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 3) {
    return undefined;
  }
  const cents = digits.slice(-2);
  const units = digits.slice(0, -2).replace(/^0+/, '') || '0';
  return `${units}.${cents}`;
}

/**
 * Saldo do trailer com o indicador de posição (`D`/`C`).
 *
 * Saldo é a única grandeza do arquivo que pode ser negativa — conta no
 * cheque especial —, e é por isso que ele não passa pelo mesmo caminho dos
 * lançamentos, cujo sinal vira `direction`.
 */
function balance(
  line: string,
  field: readonly [number, number],
  signField: readonly [number, number],
): string | undefined {
  const value = toDecimal(at(line, field));
  if (!value) {
    return undefined;
  }
  return at(line, signField) === 'D' ? `-${value}` : value;
}

/** `DDMMAAAA` do layout vira `AAAA-MM-DD`. */
function toIsoDate(raw: string, lineNumber: number): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 8) {
    throw new StatementParseError(`Data inválida na linha ${lineNumber} do CNAB 240: ${raw}`);
  }
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  const iso = `${year}-${month}-${day}`;
  if (Number.isNaN(Date.parse(`${iso}T00:00:00.000Z`))) {
    throw new StatementParseError(`Data inválida na linha ${lineNumber} do CNAB 240: ${raw}`);
  }
  return iso;
}
