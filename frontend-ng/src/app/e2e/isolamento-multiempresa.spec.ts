import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { firstValueFrom } from 'rxjs';

import { BranchesApiService } from '../core/api/branches-api.service';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { config } from '../core/lib/config';
import {
  BASE,
  PAGINA_VAZIA,
  entrarPelaTela,
  iniciarAplicacao,
  responderPendentes,
} from './harness';

/**
 * Isolamento multiempresa na interface (RF-005 / RNF-004 — UI-088).
 *
 * O isolamento de verdade é a RLS do PostgreSQL, e nada aqui substitui isso: o
 * backend revalida o `x-company-id` a cada requisição, e uma tela forçada não
 * consegue ler dado de outra empresa.
 *
 * O que estes testes protegem é o outro lado do problema — o cliente **vazando
 * por conta própria** o que o servidor isolou:
 *
 * - requisição saindo sem o cabeçalho, ou com o da empresa anterior;
 * - cache do navegador servindo a resposta da empresa A depois da troca;
 * - permissão da empresa A continuando a valer depois de trocar para a B;
 * - empresa escolhida sobrevivendo ao logout, para o próximo usuário da máquina.
 *
 * Nenhum deles seria pego pelo backend: da perspectiva dele, a requisição
 * errada é uma requisição perfeitamente válida de outro contexto.
 */
describe('isolamento multiempresa na interface (UI-088)', () => {
  const PERMISSOES = ['financial-entries:READ', 'branches:READ'];

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  /** Entra com duas empresas e para na seleção — é o caminho de quem tem mais de uma. */
  async function entrarComDuas(permissoesPorEmpresa: string[][] = [PERMISSOES, PERMISSOES]) {
    const cenario = iniciarAplicacao(PERMISSOES, permissoesPorEmpresa.length);
    cenario.empresas.forEach((empresa, i) => {
      empresa.permissions = permissoesPorEmpresa[i];
      // Sem vínculo padrão, a escolha é obrigatória — é o que queremos exercitar.
      empresa.isDefault = false;
    });

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/financeiro/titulos');
    await entrarPelaTela(cenario, harness);

    expect(cenario.router.url).toBe('/selecionar-empresa');
    return { cenario, harness, empresa: TestBed.inject(CompanyService) };
  }

  it('troca o cabeçalho da empresa em toda requisição feita depois da troca', async () => {
    const { cenario, harness, empresa } = await entrarComDuas();
    const [primeira, segunda] = cenario.empresas;

    empresa.selecionar(primeira.companyId);
    await harness.navigateByUrl('/financeiro/titulos');
    const antes = responderPendentes(cenario.mock);
    expect(antes.length).toBeGreaterThan(0);
    for (const req of antes) {
      expect(req.request.headers.get(config.companyHeader)).toBe(primeira.companyId);
    }

    empresa.selecionar(segunda.companyId);
    await harness.navigateByUrl('/');
    await harness.navigateByUrl('/financeiro/titulos');
    const depois = responderPendentes(cenario.mock);
    expect(depois.length).toBeGreaterThan(0);
    for (const req of depois) {
      expect(req.request.headers.get(config.companyHeader)).toBe(segunda.companyId);
    }
  });

  it('não serve da memória a resposta da empresa anterior', async () => {
    const { cenario, empresa } = await entrarComDuas();
    const [primeira, segunda] = cenario.empresas;
    const filiais = TestBed.inject(BranchesApiService);

    empresa.selecionar(primeira.companyId);
    const daPrimeira = firstValueFrom(filiais.list());
    cenario.mock
      .expectOne(`${BASE}/branches`)
      .flush({ ...PAGINA_VAZIA, data: [{ id: 'fil-a', name: 'Matriz da empresa 1' }], total: 1 });
    expect((await daPrimeira).data[0].id).toBe('fil-a');

    // Mesma URL, mesmos parâmetros, dentro da janela do cache: sem a empresa na
    // chave, esta chamada seria respondida com as filiais da empresa anterior.
    empresa.selecionar(segunda.companyId);
    const daSegunda = firstValueFrom(filiais.list());
    const requisicao = cenario.mock.expectOne(`${BASE}/branches`);
    expect(requisicao.request.headers.get(config.companyHeader)).toBe(segunda.companyId);
    requisicao.flush({
      ...PAGINA_VAZIA,
      data: [{ id: 'fil-b', name: 'Matriz da empresa 2' }],
      total: 1,
    });
    expect((await daSegunda).data[0].id).toBe('fil-b');
  });

  it('aplica as permissões do vínculo da empresa ativa, não as da anterior', async () => {
    const { cenario, harness, empresa } = await entrarComDuas([
      ['financial-entries:READ'],
      ['partners:READ'],
    ]);
    const [comFinanceiro, semFinanceiro] = cenario.empresas;

    empresa.selecionar(comFinanceiro.companyId);
    await harness.navigateByUrl('/financeiro/titulos');
    expect(cenario.router.url).toBe('/financeiro/titulos');
    responderPendentes(cenario.mock);

    empresa.selecionar(semFinanceiro.companyId);
    await harness.navigateByUrl('/');
    responderPendentes(cenario.mock);
    await harness.navigateByUrl('/financeiro/titulos');

    expect(cenario.router.url).toContain('/sem-permissao');
    // E nenhuma requisição do módulo chegou a sair.
    cenario.mock.verify();
  });

  it('descarta empresa forjada no armazenamento e nunca a envia no cabeçalho', async () => {
    const FORJADA = '99999999-9999-4999-8999-999999999999';
    const cenario = iniciarAplicacao(PERMISSOES);

    // É o que um usuário consegue fazer sozinho: editar o `localStorage` pelo
    // console e recarregar. Na volta, a empresa ativa é lida dali.
    activeCompanyStore.set(FORJADA);
    expect(localStorage.getItem('sge.activeCompanyId')).toBe(FORJADA);

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/financeiro/titulos');
    await entrarPelaTela(cenario, harness);

    // A escolha sem vínculo é descartada e o vínculo válido entra no lugar.
    expect(TestBed.inject(CompanyService).ativaId()).toBe(cenario.empresas[0].companyId);
    expect(activeCompanyStore.get()).toBe(cenario.empresas[0].companyId);

    const requisicoes = responderPendentes(cenario.mock);
    expect(requisicoes.length).toBeGreaterThan(0);
    for (const req of requisicoes) {
      expect(req.request.headers.get(config.companyHeader)).not.toBe(FORJADA);
    }
  });

  it('recusa selecionar uma empresa com a qual o usuário não tem vínculo', async () => {
    const cenario = iniciarAplicacao(PERMISSOES);
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/login');
    await entrarPelaTela(cenario, harness);
    responderPendentes(cenario.mock);

    const empresa = TestBed.inject(CompanyService);
    empresa.selecionar('99999999-9999-4999-8999-999999999999');

    // A escolha é simplesmente ignorada — a ativa continua sendo a do vínculo.
    expect(empresa.ativaId()).toBe(cenario.empresas[0].companyId);
  });

  it('descarta a empresa ativa ao encerrar a sessão', async () => {
    const cenario = iniciarAplicacao(PERMISSOES);
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/login');
    await entrarPelaTela(cenario, harness);
    responderPendentes(cenario.mock);
    expect(activeCompanyStore.get()).toBe(cenario.empresas[0].companyId);

    const saida = TestBed.inject(AuthService).logout();
    cenario.mock.expectOne(`${BASE}/auth/logout`).flush(null);
    await saida;
    await harness.fixture.whenStable();

    // Nem a empresa nem o refresh token podem sobrar para o próximo usuário.
    expect(activeCompanyStore.get()).toBeNull();
    expect(localStorage.getItem('sge.activeCompanyId')).toBeNull();
    expect(sessionStorage.getItem('sge.refreshToken')).toBeNull();
  });
});
