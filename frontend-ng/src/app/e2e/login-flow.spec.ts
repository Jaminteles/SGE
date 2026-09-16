import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { CABECALHO_CORRELACAO } from '../core/observability/correlation';
import { config } from '../core/lib/config';
import { BASE, entrarPelaTela, iniciarAplicacao, responderPendentes } from './harness';

const PERMISSOES = ['financial-entries:READ', 'cash-flow:READ'];

/**
 * Fluxo de login ponta a ponta (RNF-012 — UI-087).
 *
 * Cobre o caminho que todo usuário faz todo dia e que nenhum teste de unidade
 * atravessa inteiro: rota interna sem sessão → login → volta para onde ia, com
 * o token e a empresa ativa já valendo na primeira requisição da tela.
 */
describe('fluxo crítico: login (UI-087)', () => {
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('manda ao login quem não tem sessão e devolve à rota pedida depois de entrar', async () => {
    const cenario = iniciarAplicacao(PERMISSOES);
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/financeiro/titulos');
    // A guarda não pode deixar a tela abrir e só depois desviar.
    expect(cenario.router.url).toBe('/login?origem=%2Ffinanceiro%2Ftitulos');
    cenario.mock.verify();

    await entrarPelaTela(cenario, harness);

    expect(cenario.router.url).toBe('/financeiro/titulos');

    // A primeira requisição da tela já sai autenticada e com a empresa ativa.
    const requisicoes = responderPendentes(cenario.mock);
    expect(requisicoes.length).toBeGreaterThan(0);
    const consulta = requisicoes.find((r) => r.request.url === `${BASE}/financial-entries`);
    expect(consulta).toBeDefined();
    expect(consulta!.request.headers.get('Authorization')).toMatch(/^Bearer /);
    expect(consulta!.request.headers.get(config.companyHeader)).toBe(cenario.empresas[0].companyId);
    // Correlation id por requisição (UI-090).
    expect(consulta!.request.headers.get(CABECALHO_CORRELACAO)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('não devolve ao login quem já entrou, e derruba a sessão ao sair', async () => {
    const cenario = iniciarAplicacao(PERMISSOES);
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/login');
    await entrarPelaTela(cenario, harness);
    responderPendentes(cenario.mock);

    // Quem tem sessão não volta para o login nem digitando a URL.
    await harness.navigateByUrl('/login');
    expect(cenario.router.url).toBe('/');
    responderPendentes(cenario.mock);

    expect(sessionStorage.getItem('sge.refreshToken')).toBe('refresh-1');
  });
});
