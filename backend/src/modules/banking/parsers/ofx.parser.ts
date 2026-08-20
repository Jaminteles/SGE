import {
  MAX_STATEMENT_ENTRIES,
  ParsedStatement,
  ParsedStatementEntry,
  StatementParseError,
} from './statement.types';

const TRANSACTION_BLOCK = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;

/**
 * Leitor de OFX (RF-060).
 *
 * OFX 1.x é SGML: as tags de valor não fecham (`<TRNAMT>-150.00` e ponto). Por
 * isso a leitura é por expressão regular sobre blocos `<STMTTRN>`, e não por um
 * parser XML — que rejeitaria metade dos arquivos que os bancos brasileiros
 * emitem. OFX 2.x, que é XML de verdade, passa pelo mesmo caminho porque a forma
 * fechada (`<TRNAMT>-150.00</TRNAMT>`) também casa.
 *
 * O que **não** se faz aqui: converter valor para `number`. O texto do arquivo
 * vai direto para `Prisma.Decimal` — arredondar centavos na entrada do extrato
 * inviabilizaria a conciliação, que compara valores exatos.
 */
export function parseOfx(content: string): ParsedStatement {
  const entries: ParsedStatementEntry[] = [];

  for (const match of content.matchAll(TRANSACTION_BLOCK)) {
    if (entries.length >= MAX_STATEMENT_ENTRIES) {
      throw new StatementParseError(
        `O arquivo tem mais de ${MAX_STATEMENT_ENTRIES} lançamentos. Importe por período menor.`,
      );
    }

    const block = match[1];
    const rawAmount = tag(block, 'TRNAMT');
    const posted = tag(block, 'DTPOSTED');
    if (!rawAmount || !posted) {
      continue;
    }

    const amount = normalizeAmount(rawAmount);
    if (!amount) {
      continue;
    }

    entries.push({
      externalId: tag(block, 'FITID'),
      movementDate: toIsoDate(posted),
      direction: rawAmount.trim().startsWith('-') ? 'DEBITO' : 'CREDITO',
      amount,
      description: tag(block, 'MEMO') ?? tag(block, 'NAME'),
      document: tag(block, 'CHECKNUM') ?? tag(block, 'REFNUM'),
      counterpartName: tag(block, 'NAME'),
    });
  }

  if (entries.length === 0) {
    throw new StatementParseError('Nenhum lançamento encontrado no arquivo OFX.');
  }

  const start = tag(content, 'DTSTART');
  const end = tag(content, 'DTEND');
  const dates = entries.map((entry) => entry.movementDate).sort();

  return {
    periodStart: start ? toIsoDate(start) : dates[0],
    periodEnd: end ? toIsoDate(end) : dates[dates.length - 1],
    closingBalance: normalizeAmount(tag(content, 'BALAMT') ?? '') ?? undefined,
    entries,
  };
}

/** Primeiro valor da tag, fechada ou não (SGML). */
function tag(source: string, name: string): string | undefined {
  const pattern = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i');
  const value = pattern.exec(source)?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** `20261201120000[-3:BRT]` e `2026-12-01` viram `2026-12-01`. */
function toIsoDate(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 8) {
    throw new StatementParseError(`Data inválida no arquivo OFX: ${value}`);
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** Devolve o valor absoluto, com ponto decimal e no máximo duas casas. */
function normalizeAmount(raw: string): string | undefined {
  const cleaned = raw
    .trim()
    .replace(/[+\-\s]/g, '')
    .replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}
