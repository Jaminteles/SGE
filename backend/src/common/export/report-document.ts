import { Prisma } from '@prisma/client';

/** Formatos de saída oferecidos pela exportação (RF-113). */
export const REPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/**
 * Valor de célula aceito por um relatório.
 *
 * `Decimal` está aqui de propósito: dinheiro atravessa o relatório como
 * `Decimal` e só vira texto no renderizador, com duas casas. Converter para
 * `number` no meio do caminho — para "facilitar a formatação" — é onde um total
 * de carteira ganha o centavo que não fecha com o extrato.
 */
export type ReportCellValue = string | number | Prisma.Decimal | Date | null | undefined;

export interface ReportColumn {
  key: string;
  label: string;
  /** Alinha à direita e formata com duas casas quando o valor é `Decimal`. */
  numeric?: boolean;
}

/** Um bloco do relatório: um cabeçalho e as linhas sob ele. */
export interface ReportSection {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCellValue>[];
  /** Linha de totais, renderizada destacada ao pé da seção. */
  totals?: Record<string, ReportCellValue>;
}

/**
 * Relatório pronto para render, independente do formato.
 *
 * Cada consulta do M15 sabe montar isto; nenhuma delas sabe o que é PDF, XLSX ou
 * CSV. É o que impede que acrescentar um formato obrigue a mexer em toda
 * consulta — e que uma consulta produza um número diferente conforme o formato
 * escolhido.
 */
export interface ReportDocument {
  title: string;
  subtitle?: string;
  /** Filtros aplicados, impressos no cabeçalho: relatório sem recorte engana. */
  filters?: { label: string; value: string }[];
  generatedAt: Date;
  sections: ReportSection[];
}

export interface RenderedReport {
  format: ReportFormat;
  filename: string;
  contentType: string;
  content: Buffer;
}

/** Texto de uma célula, no formato em que ela é lida por humano. */
export function formatCell(value: ReportCellValue, numeric = false): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Prisma.Decimal.isDecimal(value)) return value.toFixed(2);
  if (typeof value === 'number') return numeric ? value.toString() : String(value);
  return value;
}

/**
 * Nome de arquivo seguro, gerado aqui e nunca recebido do cliente.
 *
 * Só letras, dígitos, `-` e `_` sobrevivem: o nome vai para o
 * `Content-Disposition`, e aspa ou quebra de linha vinda de um filtro digitado
 * pelo usuário quebraria o cabeçalho da resposta.
 */
export function safeFilename(base: string, format: ReportFormat): string {
  const slug = base
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return `${slug || 'relatorio'}.${format}`;
}
