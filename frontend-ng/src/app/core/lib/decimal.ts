/**
 * Valores monetários no frontend (RN-012 / RNF-008).
 *
 * O backend recebe e devolve `numeric(18,2)` serializado como **string**.
 * Converter para `number` aqui reintroduziria o ponto flutuante binário — e
 * `0.1 + 0.2` deixaria de fechar com o banco. Por isso todo o caminho
 * (input → estado → DTO → API) trafega string, e estas funções só formatam
 * para exibição ou normalizam o que o usuário digitou.
 */

/** Formato canônico aceito pela API: opcional sinal, dígitos e até 2 decimais. */
const CANONICAL = /^-?\d+(\.\d{1,2})?$/;

export interface DecimalParseResult {
  /** Valor canônico (ex.: "-1234.50") ou `null` quando a entrada é inválida/vazia. */
  value: string | null;
  error: string | null;
}

/** `true` quando a string já está no formato aceito pela API. */
export function isCanonicalDecimal(value: string): boolean {
  return CANONICAL.test(value);
}

/**
 * Converte o que o usuário digitou (pt-BR: "1.234,56") para o canônico
 * ("1234.56"). Não usa `parseFloat` em momento algum.
 */
export function parseDecimalInput(
  input: string,
  { required = false, casas = 2 } = {},
): DecimalParseResult {
  const raw = input.trim();
  if (raw === '') {
    return { value: null, error: required ? 'Informe um valor.' : null };
  }

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;

  // Separador decimal é o último "," ou "." presente; o resto é milhar.
  const lastComma = unsigned.lastIndexOf(',');
  const lastDot = unsigned.lastIndexOf('.');
  const sepIndex = Math.max(lastComma, lastDot);

  let intPart = sepIndex >= 0 ? unsigned.slice(0, sepIndex) : unsigned;
  const fracPart = sepIndex >= 0 ? unsigned.slice(sepIndex + 1) : '';

  intPart = intPart.replace(/[.\s]/g, '').replace(/,/g, '');

  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) {
    return { value: null, error: 'Valor inválido.' };
  }
  if (intPart === '' && fracPart === '') {
    return { value: null, error: 'Valor inválido.' };
  }
  if (fracPart.length > casas) {
    return { value: null, error: `Use no máximo ${casas} casas decimais.` };
  }

  const digits = `${intPart === '' ? '0' : intPart}.${fracPart.padEnd(2, '0')}`;
  const normalized = `${negative ? '-' : ''}${digits.replace(/^0+(?=\d)/, '')}`;
  return { value: normalized, error: null };
}

/**
 * Exibe um decimal canônico em pt-BR ("1234.5" -> "1.234,50").
 *
 * `casas` é o **máximo** exibido, nunca o mínimo: sempre saem ao menos duas
 * casas, e as demais só aparecem quando o valor as tem. Quantidade de estoque
 * chega com até 6 (`UNIT_VALUE_PATTERN` do backend) e truncar em 2 esconderia
 * fração de unidade real.
 */
export function formatDecimal(value: string | null | undefined, casas = 2): string {
  if (value === null || value === undefined || value === '') return '';
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [int = '0', frac = ''] = unsigned.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimais = frac.padEnd(2, '0').slice(0, Math.max(2, casas));
  return `${negative ? '-' : ''}${grouped},${decimais}`;
}

/** Exibe um decimal canônico como moeda ("1234.5" -> "R$ 1.234,50"). */
export function formatCurrency(value: string | null | undefined): string {
  const formatted = formatDecimal(value);
  return formatted === '' ? '' : `R$ ${formatted}`;
}
