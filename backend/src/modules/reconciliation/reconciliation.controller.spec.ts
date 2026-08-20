import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { PERMISSION_BY_CODE } from '../../common/authorization/permission-catalog';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationRulesController } from './reconciliation-rules.controller';

type Handler = (...args: unknown[]) => unknown;

/** Todos os métodos de rota da classe, sem o construtor. */
function routes(controller: new (...args: never[]) => object): [string, Handler][] {
  const prototype = controller.prototype as Record<string, Handler>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => [name, prototype[name]]);
}

/**
 * Nenhuma rota da conciliação é pública.
 *
 * O guard é global (`APP_GUARD`), então uma rota sem `@RequirePermissions` não
 * quebra — ela simplesmente passa a exigir só autenticação, e ninguém percebe
 * até alguém de outra empresa listar o que não devia. Este teste é a rede: uma
 * rota nova sem permissão declarada falha aqui, no commit em que foi escrita.
 */
describe.each([
  ['ReconciliationController', ReconciliationController],
  ['ReconciliationRulesController', ReconciliationRulesController],
])('%s', (_name, controller) => {
  it.each(routes(controller as never))('a rota %s exige permissão declarada', (_route, handler) => {
    const required = Reflect.getMetadata(PERMISSIONS_KEY, handler) as string[] | undefined;
    const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler) as boolean | undefined;

    expect(isPublic).toBeFalsy();
    expect(required?.length).toBeGreaterThan(0);
  });

  it.each(routes(controller as never))(
    'a permissão da rota %s existe no catálogo',
    (_route, handler) => {
      const required = (Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? []) as string[];

      for (const code of required) {
        expect(PERMISSION_BY_CODE.has(code)).toBe(true);
      }
    },
  );
});
