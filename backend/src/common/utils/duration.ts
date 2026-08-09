/**
 * Converte uma duração no formato "15m", "7d", "12h", "30s" para milissegundos.
 * Aceita também um número puro (interpretado como segundos).
 */
export function parseDurationMs(input: string): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec(input.trim());
  if (!match) {
    throw new Error(`Duração inválida: "${input}"`);
  }
  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * multipliers[unit];
}
