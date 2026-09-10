/**
 * Aritmética de dinheiro da tela financeira (RN-012).
 *
 * Tudo em centavos `bigint`, nunca `number`: `0.1 + 0.2` em ponto flutuante já
 * não fecha com o `numeric(18,2)` do banco. Os valores daqui são **prévia** —
 * soma das parcelas, saldo depois da baixa. O número que vale é o que o
 * servidor devolve.
 */

/** Decimal canônico ("-1234.5") em centavos. Casas além de duas são truncadas. */
export function paraCentavos(valor: string | null | undefined): bigint {
  if (valor === null || valor === undefined || valor.trim() === '') return 0n;
  const texto = valor.trim();
  const negativo = texto.startsWith('-');
  const semSinal = negativo ? texto.slice(1) : texto;
  const [inteiro = '0', fracao = ''] = semSinal.split('.');
  const centavos =
    BigInt(inteiro === '' ? '0' : inteiro) * 100n + BigInt(fracao.padEnd(2, '0').slice(0, 2));
  return negativo ? -centavos : centavos;
}

/** Centavos de volta ao canônico da API ("123.45"). */
export function deCentavos(centavos: bigint): string {
  const negativo = centavos < 0n;
  const absoluto = (negativo ? -centavos : centavos).toString().padStart(3, '0');
  return `${negativo ? '-' : ''}${absoluto.slice(0, -2)}.${absoluto.slice(-2)}`;
}

export function somar(...valores: (string | null | undefined)[]): string {
  return deCentavos(valores.reduce((total, valor) => total + paraCentavos(valor), 0n));
}

export function subtrair(a: string | null | undefined, b: string | null | undefined): string {
  return deCentavos(paraCentavos(a) - paraCentavos(b));
}

/** -1, 0 ou 1, como `a` se compara a `b`. */
export function comparar(a: string | null | undefined, b: string | null | undefined): number {
  const diferenca = paraCentavos(a) - paraCentavos(b);
  return diferenca === 0n ? 0 : diferenca < 0n ? -1 : 1;
}

export function ehNegativo(valor: string | null | undefined): boolean {
  return paraCentavos(valor) < 0n;
}

// ---------------------------------------------------------------------------
// Datas "YYYY-MM-DD" (sem fuso: vencimento é dia, não instante)
// ---------------------------------------------------------------------------

const DIA_MS = 86_400_000;

function paraUtc(data: string): number {
  const [ano, mes, dia] = data.split('-').map((parte) => Number.parseInt(parte, 10));
  return Date.UTC(ano, mes - 1, dia);
}

function deUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Hoje no fuso do navegador, em "YYYY-MM-DD". */
export function hoje(): string {
  const agora = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`;
}

export function adicionarDias(data: string, dias: number): string {
  return deUtc(paraUtc(data) + dias * DIA_MS);
}

/** Dias corridos de `de` até `ate` (negativo quando `ate` é anterior). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((paraUtc(ate.slice(0, 10)) - paraUtc(de.slice(0, 10))) / DIA_MS);
}

export function dataValida(data: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(data) && !Number.isNaN(paraUtc(data));
}

// ---------------------------------------------------------------------------
// Parcelamento (RF-053)
// ---------------------------------------------------------------------------

export interface ParcelaPlanejada {
  numero: number;
  vencimento: string;
  valor: string;
}

/**
 * Espelho de `planEqualInstallments` do backend, só para a prévia: a base é o
 * líquido dividido e truncado no centavo, e o resto vai para a última parcela
 * — 1.000,00 em três dá 333,33 + 333,33 + 333,34, e nenhum centavo some.
 */
export function planejarParcelas(
  liquido: string,
  quantidade: number,
  primeiroVencimento: string,
  intervaloDias: number,
): ParcelaPlanejada[] {
  if (!Number.isInteger(quantidade) || quantidade < 1) return [];
  const total = paraCentavos(liquido);
  if (total <= 0n) return [];
  const n = BigInt(quantidade);
  const base = total / n;
  const resto = total - base * n;

  return Array.from({ length: quantidade }, (_, indice) => ({
    numero: indice + 1,
    vencimento: adicionarDias(primeiroVencimento, indice * intervaloDias),
    valor: deCentavos(indice === quantidade - 1 ? base + resto : base),
  }));
}
