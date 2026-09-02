import { describe, expect, it } from 'vitest';
import { NAVIGATION } from './navigation';

describe('NAVIGATION', () => {
  it('usa códigos no formato recurso:AÇÃO do catálogo do backend', () => {
    const codes = NAVIGATION.flatMap((item) => [
      ...(item.permissions.all ?? []),
      ...(item.permissions.any ?? []),
    ]);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z][a-z-]*:(CREATE|READ|UPDATE|DELETE|APPROVE|EXPORT)$/);
    }
  });

  it('não repete rotas', () => {
    const paths = NAVIGATION.map((item) => item.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
