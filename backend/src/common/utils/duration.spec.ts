import { parseDurationMs } from './duration';

describe('parseDurationMs', () => {
  it('interpreta segundos, minutos, horas e dias', () => {
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('15m')).toBe(900_000);
    expect(parseDurationMs('12h')).toBe(43_200_000);
    expect(parseDurationMs('7d')).toBe(604_800_000);
  });

  it('assume segundos quando sem unidade', () => {
    expect(parseDurationMs('45')).toBe(45_000);
  });

  it('lança erro para formato inválido', () => {
    expect(() => parseDurationMs('abc')).toThrow();
  });
});
