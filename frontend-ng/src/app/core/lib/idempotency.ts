/**
 * Chave de idempotência das operações que movem dinheiro (RN-004) — UUID v4.
 *
 * `crypto.randomUUID` só existe em contexto seguro (HTTPS ou localhost); fora
 * dele, monta o mesmo formato com `getRandomValues`, que existe em qualquer
 * contexto. `Math.random` não serve: chave previsível colide.
 */
export function novaChaveIdempotencia(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
