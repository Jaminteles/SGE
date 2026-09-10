/**
 * Aritmética da tela de compras (RN-012).
 *
 * Quantidade e preço unitário têm até 6 casas; valor, 2. Tudo em `bigint`
 * escalado, nunca `number`: `0.1 * 3` em ponto flutuante já não fecha com o
 * `numeric` do banco. Os números daqui são **prévia** — valor da linha, saldo a
 * receber, divergência. O que vale é o que o servidor devolve.
 */

/** Casas das quantidades e dos preços unitários (`UNIT_VALUE_PATTERN`). */
export const CASAS_UNITARIAS = 6;

/** Decimal canônico em inteiro na escala pedida. Casas além dela são truncadas. */
function paraEscala(valor: string | null | undefined, casas: number): bigint {
  if (valor === null || valor === undefined || valor.trim() === '') return 0n;
  const texto = valor.trim();
  const negativo = texto.startsWith('-');
  const semSinal = negativo ? texto.slice(1) : texto;
  const [inteiro = '0', fracao = ''] = semSinal.split('.');
  const digitos = `${inteiro === '' ? '0' : inteiro}${fracao.padEnd(casas, '0').slice(0, casas)}`;
  const bruto = BigInt(digitos);
  return negativo ? -bruto : bruto;
}

function deEscala(valor: bigint, casas: number): string {
  const negativo = valor < 0n;
  const absoluto = (negativo ? -valor : valor).toString().padStart(casas + 1, '0');
  const texto = casas === 0 ? absoluto : `${absoluto.slice(0, -casas)}.${absoluto.slice(-casas)}`;
  return `${negativo ? '-' : ''}${texto}`;
}

/** Divisão inteira com arredondamento meio-para-cima, simétrico no sinal (`ROUND_HALF_UP`). */
function dividirArredondando(dividendo: bigint, divisor: bigint): bigint {
  const negativo = dividendo < 0n !== divisor < 0n;
  const a = dividendo < 0n ? -dividendo : dividendo;
  const b = divisor < 0n ? -divisor : divisor;
  const quociente = a / b;
  const arredondado = (a % b) * 2n >= b ? quociente + 1n : quociente;
  return negativo ? -arredondado : arredondado;
}

/**
 * Quantidade × preço, com 2 casas — espelho de `quantity.times(unitPrice)
 * .toDecimalPlaces(2, ROUND_HALF_UP)` do backend.
 */
export function valorBruto(quantidade: string | null, preco: string | null): string {
  const produto = paraEscala(quantidade, CASAS_UNITARIAS) * paraEscala(preco, CASAS_UNITARIAS);
  const escala = 10n ** BigInt(CASAS_UNITARIAS * 2 - 2);
  return deEscala(dividirArredondando(produto, escala), 2);
}

/** Valor da linha do pedido: bruto menos o desconto (RF-037). */
export function valorLinha(
  quantidade: string | null,
  preco: string | null,
  desconto: string | null,
): string {
  return deEscala(paraEscala(valorBruto(quantidade, preco), 2) - paraEscala(desconto, 2), 2);
}

export function subtrairQuantidade(a: string | null, b: string | null): string {
  return deEscala(paraEscala(a, CASAS_UNITARIAS) - paraEscala(b, CASAS_UNITARIAS), CASAS_UNITARIAS);
}

/** -1, 0 ou 1, como `a` se compara a `b` — com 6 casas. */
export function compararUnitario(a: string | null, b: string | null): number {
  const diferenca = paraEscala(a, CASAS_UNITARIAS) - paraEscala(b, CASAS_UNITARIAS);
  return diferenca === 0n ? 0 : diferenca < 0n ? -1 : 1;
}

export function positivo(valor: string | null): boolean {
  return paraEscala(valor, CASAS_UNITARIAS) > 0n;
}

/** Quanto do item ainda não chegou: pedida menos recebida (RF-039). */
export function saldoPendente(item: { quantity: string; receivedQuantity: string }): string {
  return subtrairQuantidade(item.quantity, item.receivedQuantity);
}

/**
 * Variação percentual de `atual` sobre `anterior`, com 2 casas ("12.50",
 * "-3.10"). `null` quando não há base — preço anterior zero ou ausente.
 */
export function variacaoPercentual(atual: string | null, anterior: string | null): string | null {
  const base = paraEscala(anterior, CASAS_UNITARIAS);
  if (base === 0n) return null;
  const diferenca = paraEscala(atual, CASAS_UNITARIAS) - base;
  // Percentual com 2 casas = diferença × 100 × 100 / base.
  return deEscala(dividirArredondando(diferenca * 10_000n, base), 2);
}
