import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../api/interceptors';
import { activeCompanyStore } from '../company/active-company-store';
import { makeUser } from '../test/factories';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

const BASE = '/api/v1';

/**
 * `restaurar()` encadeia duas chamadas com `await` entre elas. Depois de
 * responder a primeira, é preciso deixar a fila de microtarefas correr para a
 * segunda chegar ao backend de teste.
 */
const proximaTarefa = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AuthService', () => {
  let auth: AuthService;
  let sessao: SessionService;
  let mock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    activeCompanyStore.set(null);

    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors(SGE_INTERCEPTORS)), provideHttpClientTesting()],
    });

    auth = TestBed.inject(AuthService);
    sessao = TestBed.inject(SessionService);
    mock = TestBed.inject(HttpTestingController);
  });

  it('começa carregando, antes de saber se há sessão', () => {
    expect(auth.status()).toBe('carregando');
    expect(auth.autenticado()).toBe(false);
  });

  it('fica anônimo quando não há refresh token guardado', async () => {
    await auth.restaurar();
    expect(auth.status()).toBe('anonimo');
    mock.expectNone(`${BASE}/auth/refresh`);
  });

  it('restaura a sessão da aba a partir do refresh token', async () => {
    sessao.definirTokens({ accessToken: 'antigo', refreshToken: 'refresh-abc' });
    const usuario = makeUser();

    const restaurando = auth.restaurar();

    mock
      .expectOne(`${BASE}/auth/refresh`)
      .flush({ accessToken: 'novo', refreshToken: 'refresh-novo' });
    await proximaTarefa();
    mock.expectOne(`${BASE}/auth/me`).flush(usuario);
    await restaurando;

    expect(auth.status()).toBe('autenticado');
    expect(auth.usuario()?.email).toBe('jamile@empresa.com.br');
    expect(sessao.accessToken).toBe('novo');
  });

  it('cai para anônimo quando a renovação da restauração falha', async () => {
    sessao.definirTokens({ accessToken: 'antigo', refreshToken: 'refresh-vencido' });

    const restaurando = auth.restaurar();
    mock
      .expectOne(`${BASE}/auth/refresh`)
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    await restaurando;

    expect(auth.status()).toBe('anonimo');
    expect(auth.usuario()).toBeNull();
    expect(sessao.accessToken).toBeNull();
  });

  it('cai para anônimo quando o perfil não pode ser lido', async () => {
    sessao.definirTokens({ accessToken: 'antigo', refreshToken: 'refresh-abc' });

    const restaurando = auth.restaurar();
    mock
      .expectOne(`${BASE}/auth/refresh`)
      .flush({ accessToken: 'novo', refreshToken: 'refresh-novo' });
    await proximaTarefa();
    mock.expectOne(`${BASE}/auth/me`).flush(null, { status: 500, statusText: 'Server Error' });
    await restaurando;

    expect(auth.status()).toBe('anonimo');
    expect(auth.usuario()).toBeNull();
  });

  it('guarda tokens e perfil no login', async () => {
    const usuario = makeUser();
    const entrando = auth.login('jamile@empresa.com.br', 'senha-secreta');

    const req = mock.expectOne(`${BASE}/auth/login`);
    expect(req.request.body).toEqual({
      email: 'jamile@empresa.com.br',
      password: 'senha-secreta',
    });
    req.flush({ accessToken: 'tok', refreshToken: 'ref', tokenType: 'Bearer', user: usuario });
    await entrando;

    expect(auth.status()).toBe('autenticado');
    expect(auth.usuario()).toEqual(usuario);
    expect(sessao.accessToken).toBe('tok');
    expect(sessao.refreshToken).toBe('ref');
  });

  it('encerra a sessão local mesmo se a API de logout falhar', async () => {
    sessao.definirTokens({ accessToken: 'tok', refreshToken: 'ref' });
    activeCompanyStore.set('empresa-1');

    const saindo = auth.logout();
    mock.expectOne(`${BASE}/auth/logout`).flush(null, { status: 503, statusText: 'Unavailable' });
    await saindo;

    expect(auth.status()).toBe('anonimo');
    expect(sessao.accessToken).toBeNull();
    expect(activeCompanyStore.get()).toBeNull();
  });

  it('não chama a API de logout quando não há refresh token', async () => {
    await auth.logout();
    mock.expectNone(`${BASE}/auth/logout`);
    expect(auth.status()).toBe('anonimo');
  });

  it('limpa o estado quando o interceptor marca a sessão como expirada', async () => {
    const usuario = makeUser();
    const entrando = auth.login('jamile@empresa.com.br', 'senha');
    mock
      .expectOne(`${BASE}/auth/login`)
      .flush({ accessToken: 'tok', refreshToken: 'ref', tokenType: 'Bearer', user: usuario });
    await entrando;
    expect(auth.autenticado()).toBe(true);

    // É o que o authInterceptor faz quando a renovação é impossível.
    sessao.expirar();
    TestBed.tick();

    expect(auth.status()).toBe('anonimo');
    expect(auth.usuario()).toBeNull();
  });
});
