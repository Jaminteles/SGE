import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isValidCnpj, onlyDigits } from '../../common/validators/is-cnpj.validator';
import { isValidCpf } from '../../common/validators/is-cpf.validator';

/** Campos que o OCR consegue afirmar sobre um comprovante (RF-097). */
export interface ExtractedFields {
  amount?: Prisma.Decimal;
  issueDate?: Date;
  merchantName?: string;
  /** Só dígitos: 11 (CPF) ou 14 (CNPJ), já validados. */
  merchantDocument?: string;
  /** Chave de acesso da NF-e/NFC-e, 44 dígitos. */
  documentKey?: string;
  documentNumber?: string;
}

/**
 * Rótulos que antecedem o valor total num cupom ou recibo, do mais específico
 * para o mais genérico. A ordem é a prioridade: "VALOR TOTAL" ganha de "TOTAL",
 * que ganha de "VALOR" — num cupom fiscal os três aparecem, e só o primeiro é o
 * que a pessoa pagou.
 */
const AMOUNT_LABELS = [
  'valor total pago',
  'valor total',
  'total a pagar',
  'total geral',
  'valor pago',
  'total',
  'valor',
];

/** `1.234,56` ou `1,234.56` ou `1234.56` — com ou sem símbolo antes. */
const AMOUNT_PATTERN = /(?:r\$\s*)?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2})?)/;

const DATE_PATTERNS = [
  /(\d{2})[/.-](\d{2})[/.-](\d{4})/, // 07/09/2026
  /(\d{4})-(\d{2})-(\d{2})/, // 2026-09-07
];

/** Chave de acesso: 44 dígitos, normalmente impressa em blocos de quatro. */
const DOCUMENT_KEY_PATTERN = /\b(\d[\s.]?){43}\d\b/;

const DOCUMENT_NUMBER_PATTERN =
  /(?:n[ºo°.]?|numero|número|nota|cupom|documento)\s*[:-]?\s*(\d{1,9})\b/i;

/** Linhas que nunca são o nome do estabelecimento. */
const NOT_A_MERCHANT = /^(cupom|nota|documento|extrato|recibo|cnpj|cpf|data|valor|total)\b/i;

const MAX_MERCHANT_NAME = 255;

/**
 * Leitura dos campos de um comprovante a partir do texto do OCR (RF-097).
 *
 * Serviço puro: recebe texto, devolve campos. Nada de banco, nada de provedor —
 * é o que permite testá-lo com o texto real de um cupom, que é a única forma de
 * saber se ele funciona.
 *
 * Nenhum campo é obrigatório, e essa é a decisão central: comprovante amassado,
 * foto torta e cupom térmico apagado são a regra, não a exceção. O que não for
 * lido fica nulo e a pessoa preenche na validação (RF-099) — inventar valor a
 * partir de leitura ruim é o único erro que este serviço pode cometer de forma
 * irreversível, porque ele vira sugestão de lançamento adiante.
 *
 * Valor é `Prisma.Decimal` desde a primeira conversão: o texto vira Decimal
 * direto, sem passar por `number` (RN-012).
 */
@Injectable()
export class OcrExtractionService {
  extract(text: string): ExtractedFields {
    if (!text || text.trim().length === 0) {
      return {};
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const lowered = lines.map((line) => line.toLowerCase());

    const merchantDocument = this.findDocument(text);

    return {
      amount: this.findAmount(lines, lowered),
      issueDate: this.findDate(text),
      merchantName: this.findMerchantName(lines),
      merchantDocument,
      documentKey: this.findDocumentKey(text),
      documentNumber: this.findDocumentNumber(text),
    };
  }

  /**
   * Valor total. Procura pelo rótulo mais específico presente no texto e lê o
   * número que vem depois dele — na mesma linha ou na seguinte, porque cupom
   * quebrado em duas linhas é comum.
   */
  private findAmount(lines: string[], lowered: string[]): Prisma.Decimal | undefined {
    for (const label of AMOUNT_LABELS) {
      for (let i = 0; i < lowered.length; i += 1) {
        const at = lowered[i].indexOf(label);
        if (at < 0) continue;

        const rest = lines[i].slice(at + label.length);
        const value = this.parseAmount(rest) ?? this.parseAmount(lines[i + 1] ?? '');
        if (value) {
          return value;
        }
      }
    }
    return undefined;
  }

  /**
   * Converte o primeiro número monetário do trecho.
   *
   * A separação decimal é decidida pelo último separador com dois dígitos
   * depois: `1.234,56` e `1,234.56` são o mesmo valor escrito por convenções
   * diferentes, e chutar errado muda o número por um fator de mil.
   */
  private parseAmount(chunk: string): Prisma.Decimal | undefined {
    const match = AMOUNT_PATTERN.exec(chunk.toLowerCase());
    if (!match) {
      return undefined;
    }

    const raw = match[1];
    const lastSeparator = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));
    const hasCents = lastSeparator >= 0 && raw.length - lastSeparator - 1 === 2;

    const normalized = hasCents
      ? `${raw.slice(0, lastSeparator).replace(/[.,]/g, '')}.${raw.slice(lastSeparator + 1)}`
      : raw.replace(/[.,]/g, '');

    if (!/^\d{1,16}(\.\d{2})?$/.test(normalized)) {
      return undefined;
    }

    const value = new Prisma.Decimal(normalized);
    // Zero não é leitura: é o que sobra de um "R$ 0,00" de rodapé de cupom.
    return value.isZero() ? undefined : value;
  }

  /** Data do documento, como dia civil (coluna `date`). */
  private findDate(text: string): Date | undefined {
    for (const pattern of DATE_PATTERNS) {
      const match = pattern.exec(text);
      if (!match) continue;

      const [year, month, day] =
        match[3].length === 4
          ? [Number(match[3]), Number(match[2]), Number(match[1])]
          : [Number(match[1]), Number(match[2]), Number(match[3])];

      if (month < 1 || month > 12 || day < 1 || day > 31) continue;

      const date = new Date(Date.UTC(year, month - 1, day));
      // Rejeita 31/02 e afins: o Date "corrige" para março, e uma data corrigida
      // em silêncio é pior que data nenhuma.
      if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;

      return date;
    }
    return undefined;
  }

  /** CNPJ ou CPF do emitente, validado pelo dígito verificador. */
  private findDocument(text: string): string | undefined {
    const candidates = text.match(/\d[\d./-]{9,17}\d/g) ?? [];
    for (const candidate of candidates) {
      const digits = onlyDigits(candidate);
      if (digits.length === 14 && isValidCnpj(digits)) {
        return digits;
      }
      if (digits.length === 11 && isValidCpf(digits)) {
        return digits;
      }
    }
    return undefined;
  }

  /**
   * Nome do estabelecimento: a primeira linha que parece um nome.
   *
   * Cupom fiscal e recibo abrem com a razão social — é a única convenção
   * confiável. Linhas que começam com rótulo conhecido, ou que são só números,
   * ficam de fora.
   */
  private findMerchantName(lines: string[]): string | undefined {
    for (const line of lines.slice(0, 6)) {
      if (line.length < 3 || NOT_A_MERCHANT.test(line)) continue;
      if (!/[a-zà-ú]/i.test(line)) continue;
      if (onlyDigits(line).length > line.length / 2) continue;

      return line.slice(0, MAX_MERCHANT_NAME);
    }
    return undefined;
  }

  private findDocumentKey(text: string): string | undefined {
    const match = DOCUMENT_KEY_PATTERN.exec(text);
    if (!match) {
      return undefined;
    }
    const digits = onlyDigits(match[0]);
    return digits.length === 44 ? digits : undefined;
  }

  private findDocumentNumber(text: string): string | undefined {
    const match = DOCUMENT_NUMBER_PATTERN.exec(text);
    return match ? match[1] : undefined;
  }
}
