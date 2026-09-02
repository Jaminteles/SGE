/**
 * Configuração pública do app. Nunca guarde segredo aqui — o bundle é público.
 *
 * Substitui o `import.meta.env` do Vite: no Angular, o valor de produção vem
 * de `environment.production.ts` via `fileReplacements` (angular.json).
 */
export const environment = {
  production: false,
  /** Base da API REST. O proxy do `ng serve` atende `/api/v1` em desenvolvimento. */
  apiUrl: '/api/v1',
};
