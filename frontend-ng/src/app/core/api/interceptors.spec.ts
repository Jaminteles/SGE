import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionService } from '../auth/session.service';
import { activeCompanyStore } from '../company/active-company-store';
import { ApiError, NetworkError } from './errors';
import { rotaPublica, semEmpresa } from './http-context';
import { SGE_INTERCEPTORS } from './interceptors';

const BASE = '/api/v1';

describe('interceptors HTTP', () => {
  let http: HttpClient;
  let mock: HttpTestingController;
  let sessao: SessionService;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    activeCompanyStore.set(null);

    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors(SGE_INTERCEPTORS)), provideHttpClientTesting()],
    });

    http = TestBed.inject(HttpClient);
    mock = TestBed.inject(HttpTestingController);
    sessao = TestBed.inject(SessionService);
  });

  afterEach(() => {
    mock.verify();
  });

  it('prefixa a base da API nas URLs relativas', () => {
    http.get('partners').subscribe();
    mock.expectOne(`${BASE}/partners`).flush([]);
  });

  it('envia Authorization e x-company-id da empresa ativa (RF-005)', () => {
    sessao.definirTokens({ accessToken: 'token-abc', refreshToken: 'refresh-abc' });
    activeCompanyStore.set('empresa-1');

    http.get('partners').subscribe();

    const req = mock.expectOne(`${BASE}/partners`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer token-abc');
    expect(req.request.headers.get('x-company-id')).toBe('empresa-1');
    req.flush([]);
  });

  it('passa a mandar a nova empresa assim que a ativa muda', () => {
    sessao.definirTokens({ accessToken: 'token-abc', refreshToken: 'refresh-abc' });
    activeCompanyStore.set('empresa-1');

    http.get('partners').subscribe();
    mock.expectOne(`${BASE}/partners`).flush([]);

    activeCompanyStore.set('empresa-2');
    http.get('partners').subscribe();

    const req = mock.expectOne(`${BASE}/partners`);
    expect(req.request.headers.get('x-company-id')).toBe('empresa-2');
    req.flush([]);
  });

  it('omite o cabeçalho de empresa nas rotas de plataforma', () => {
    sessao.definirTokens({ accessToken: 'token-abc', refreshToken: 'refresh-abc' });
    activeCompanyStore.set('empresa-1');

    http.get('auth/me', { context: semEmpresa() }).subscribe();

    const req = mock.expectOne(`${BASE}/auth/me`);
    expect(req.request.headers.has('x-company-id')).toBe(false);
    expect(req.request.headers.get('Authorization')).toBe('Bearer token-abc');
    req.flush({});
  });

  it('não envia token em rota pública', () => {
    sessao.definirTokens({ accessToken: 'token-abc', refreshToken: 'refresh-abc' });

    http.post('auth/login', {}, { context: rotaPublica() }).subscribe();

    const req = mock.expectOne(`${BASE}/auth/login`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.headers.has('x-company-id')).toBe(false);
    req.flush({});
  });

  it('renova a sessão uma única vez quando várias chamadas tomam 401', () => {
    sessao.definirTokens({ accessToken: 'token-velho', refreshToken: 'refresh-abc' });

    const resultados: string[] = [];
    http.get<string>('a').subscribe((r) => resultados.push(r));
    http.get<string>('b').subscribe((r) => resultados.push(r));
    http.get<string>('c').subscribe((r) => resultados.push(r));

    // As três tomam 401 ao mesmo tempo.
    mock.expectOne(`${BASE}/a`).flush(null, { status: 401, statusText: 'Unauthorized' });
    mock.expectOne(`${BASE}/b`).flush(null, { status: 401, statusText: 'Unauthorized' });
    mock.expectOne(`${BASE}/c`).flush(null, { status: 401, statusText: 'Unauthorized' });

    // ...e apenas UMA renovação é disparada.
    const refresh = mock.match(`${BASE}/auth/refresh`);
    expect(refresh.length).toBe(1);
    expect(refresh[0].request.body).toEqual({ refreshToken: 'refresh-abc' });
    refresh[0].flush({ accessToken: 'token-novo', refreshToken: 'refresh-novo' });

    // As três repetem, agora com o token renovado.
    for (const caminho of ['a', 'b', 'c']) {
      const repetida = mock.expectOne(`${BASE}/${caminho}`);
      expect(repetida.request.headers.get('Authorization')).toBe('Bearer token-novo');
      repetida.flush(`ok-${caminho}`);
    }

    expect(resultados.sort()).toEqual(['ok-a', 'ok-b', 'ok-c']);
    expect(sessao.accessToken).toBe('token-novo');
    expect(sessao.expirada()).toBe(false);
  });

  it('encerra a sessão quando a renovação falha', () => {
    sessao.definirTokens({ accessToken: 'token-velho', refreshToken: 'refresh-abc' });

    let capturado: unknown = null;
    http.get('partners').subscribe({ error: (e: unknown) => (capturado = e) });

    mock.expectOne(`${BASE}/partners`).flush(null, { status: 401, statusText: 'Unauthorized' });
    mock
      .expectOne(`${BASE}/auth/refresh`)
      .flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(sessao.expirada()).toBe(true);
    expect(sessao.accessToken).toBeNull();
    expect(capturado).toBeInstanceOf(ApiError);
    expect((capturado as ApiError).status).toBe(401);
  });

  it('encerra a sessão quando não há refresh token para renovar', () => {
    let capturado: unknown = null;
    http.get('partners').subscribe({ error: (e: unknown) => (capturado = e) });

    mock.expectOne(`${BASE}/partners`).flush(null, { status: 401, statusText: 'Unauthorized' });

    // Sem refresh token guardado, nem chega a chamar /auth/refresh.
    mock.expectNone(`${BASE}/auth/refresh`);
    expect(sessao.expirada()).toBe(true);
    expect(capturado).toBeInstanceOf(ApiError);
  });

  it('traduz o envelope de erro da API (UI-005)', () => {
    let capturado: unknown = null;
    http.post('companies', {}, { context: rotaPublica() }).subscribe({
      error: (e: unknown) => (capturado = e),
    });

    mock.expectOne(`${BASE}/companies`).flush(
      {
        statusCode: 409,
        error: 'Conflict',
        message: 'O CNPJ informado já existe nesta empresa.',
        path: '/api/v1/companies',
        timestamp: '2026-09-02T08:41:12.000Z',
      },
      { status: 409, statusText: 'Conflict' },
    );

    expect(capturado).toBeInstanceOf(ApiError);
    const erro = capturado as ApiError;
    expect(erro.status).toBe(409);
    expect(erro.code).toBe('Conflict');
    expect(erro.message).toBe('O CNPJ informado já existe nesta empresa.');
  });

  it('mantém a lista de erros de validação', () => {
    let capturado: unknown = null;
    http.post('companies', {}, { context: rotaPublica() }).subscribe({
      error: (e: unknown) => (capturado = e),
    });

    mock.expectOne(`${BASE}/companies`).flush(
      {
        statusCode: 400,
        error: 'Bad Request',
        message: ['legalName não pode ser vazio', 'taxId deve ter 14 dígitos'],
      },
      { status: 400, statusText: 'Bad Request' },
    );

    const erro = capturado as ApiError;
    expect(erro.details).toEqual([
      'legalName não pode ser vazio',
      'taxId deve ter 14 dígitos',
    ]);
    expect(erro.message).toBe('legalName não pode ser vazio');
  });

  it('usa a mensagem padrão do status quando a API não manda uma', () => {
    let capturado: unknown = null;
    http.get('partners', { context: rotaPublica() }).subscribe({
      error: (e: unknown) => (capturado = e),
    });

    mock.expectOne(`${BASE}/partners`).flush(null, { status: 403, statusText: 'Forbidden' });

    const erro = capturado as ApiError;
    expect(erro.isForbidden).toBe(true);
    expect(erro.message).toBe('Você não tem permissão para esta ação.');
  });

  it('converte falha de rede em NetworkError', () => {
    let capturado: unknown = null;
    http.get('partners', { context: rotaPublica() }).subscribe({
      error: (e: unknown) => (capturado = e),
    });

    mock.expectOne(`${BASE}/partners`).error(new ProgressEvent('error'));

    expect(capturado).toBeInstanceOf(NetworkError);
    expect((capturado as NetworkError).status).toBe(0);
  });
});
