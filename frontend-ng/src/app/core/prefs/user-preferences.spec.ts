import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../api/interceptors';
import type { UserProfile } from '../api/types';
import { AuthService } from '../auth/auth.service';
import { CompanyService } from '../company/company.service';
import { activeCompanyStore } from '../company/active-company-store';
import { makeMembership, makeUser } from '../test/factories';
import { UserPreferencesService } from './user-preferences.service';

const BASE = '/api/v1';
const EMPRESA_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const EMPRESA_B = 'bbbbbbbb-2222-4222-8222-222222222222';

describe('UserPreferencesService (UI-078)', () => {
  let mock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    activeCompanyStore.set(null);
    document.documentElement.className = '';

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
      ],
    });
    mock = TestBed.inject(HttpTestingController);
  });

  async function autenticar(usuario: UserProfile): Promise<UserPreferencesService> {
    const auth = TestBed.inject(AuthService);
    TestBed.inject(CompanyService);
    const prefs = TestBed.inject(UserPreferencesService);
    const entrando = auth.login('jamile@empresa.com.br', 'senha');
    mock
      .expectOne(`${BASE}/auth/login`)
      .flush({ accessToken: 'tok', refreshToken: 'ref', tokenType: 'Bearer', user: usuario });
    await entrando;
    TestBed.tick();
    return prefs;
  }

  function usuarioEm(empresaId: string, id?: string): UserProfile {
    return makeUser({
      ...(id ? { id } : {}),
      memberships: [makeMembership({ companyId: empresaId })],
    });
  }

  it('aplica a densidade compacta como classe no <html> e a persiste', async () => {
    const prefs = await autenticar(usuarioEm(EMPRESA_A));

    prefs.definirDensidade('compacta');
    TestBed.tick();

    expect(prefs.compacta()).toBe(true);
    expect(document.documentElement.classList.contains('sge-compacto')).toBe(true);
    expect(localStorage.getItem(`sge.preferencias.${usuarioEm(EMPRESA_A).id}`)).toContain(
      'compacta',
    );
  });

  it('guarda as colunas escondidas por tabela e as devolve por chave', async () => {
    const prefs = await autenticar(usuarioEm(EMPRESA_A));

    prefs.definirColunasOcultas('cadastros.parceiros', ['personType']);
    TestBed.tick();

    expect(prefs.colunasOcultas('cadastros.parceiros')).toEqual(['personType']);
    expect(prefs.colunasOcultas('cadastros.produtos')).toEqual([]);

    prefs.restaurarColunas();
    TestBed.tick();
    expect(prefs.colunasOcultas('cadastros.parceiros')).toEqual([]);
  });

  it('só oferece o filtro salvo na tela e na empresa em que foi salvo', async () => {
    const prefs = await autenticar(
      makeUser({
        memberships: [
          makeMembership({ companyId: EMPRESA_A, isDefault: true }),
          makeMembership({ companyId: EMPRESA_B, isDefault: false }),
        ],
      }),
    );

    prefs.salvarFiltro('cadastros.parceiros', 'Fornecedores ativos', {
      q: '',
      role: 'SUPPLIER',
      isActive: 'true',
    });
    TestBed.tick();

    expect(prefs.filtrosDe('cadastros.parceiros').map((f) => f.nome)).toEqual([
      'Fornecedores ativos',
    ]);
    // Outra tela não herda o recorte: os ids guardados não significam nada lá.
    expect(prefs.filtrosDe('cadastros.produtos')).toEqual([]);

    // Na outra empresa o recorte não pode reaparecer: ele carrega ids
    // (categoria, conta, filial) que só existem na empresa onde foi salvo.
    TestBed.inject(CompanyService).selecionar(EMPRESA_B);
    TestBed.tick();
    expect(prefs.filtrosDe('cadastros.parceiros')).toEqual([]);
  });

  it('nome repetido substitui o recorte anterior em vez de duplicar', async () => {
    const prefs = await autenticar(usuarioEm(EMPRESA_A));

    prefs.salvarFiltro('cadastros.parceiros', 'Clientes', { q: 'a' });
    prefs.salvarFiltro('cadastros.parceiros', 'Clientes', { q: 'b' });
    TestBed.tick();

    const salvos = prefs.filtrosDe('cadastros.parceiros');
    expect(salvos).toHaveLength(1);
    expect(salvos[0].valores.q).toBe('b');
  });

  it('as preferências de um usuário não vazam para o outro na mesma máquina', async () => {
    const primeiro = await autenticar(usuarioEm(EMPRESA_A, '11111111-1111-4111-8111-aaaaaaaaaaaa'));
    primeiro.definirDensidade('compacta');
    primeiro.salvarFiltro('cadastros.parceiros', 'Meu recorte', { q: 'x' });
    TestBed.tick();

    // Outro login na mesma máquina, com o `localStorage` intacto.
    TestBed.resetTestingModule();
    activeCompanyStore.set(null);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
      ],
    });
    mock = TestBed.inject(HttpTestingController);

    const segundo = await autenticar(usuarioEm(EMPRESA_A, '22222222-2222-4222-8222-bbbbbbbbbbbb'));
    expect(segundo.densidade()).toBe('confortavel');
    expect(segundo.filtrosDe('cadastros.parceiros')).toEqual([]);
  });

  it('preferência corrompida no armazenamento volta ao padrão sem quebrar a tela', async () => {
    const usuario = usuarioEm(EMPRESA_A);
    localStorage.setItem(`sge.preferencias.${usuario.id}`, '{isto não é json');

    const prefs = await autenticar(usuario);

    expect(prefs.densidade()).toBe('confortavel');
    expect(prefs.todosOsFiltros()).toEqual([]);
  });
});
