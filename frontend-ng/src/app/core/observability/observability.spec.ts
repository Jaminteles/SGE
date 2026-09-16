import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError, NetworkError } from '../api/errors';
import { SGE_INTERCEPTORS } from '../api/interceptors';
import { CABECALHO_CORRELACAO } from './correlation';
import { ClientErrorsService, SgeErrorHandler } from './client-errors.service';

const BASE = '/api/v1';

describe('correlation id e captura de erros do cliente (UI-090)', () => {
  let mock: HttpTestingController;
  let http: HttpClient;
  let registro: ClientErrorsService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
      ],
    });
    mock = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
    registro = TestBed.inject(ClientErrorsService);
    registro.limpar();
  });

  it('manda um correlation id diferente em cada requisição', () => {
    http.get('branches').subscribe({ error: () => {} });
    http.get('partners').subscribe({ error: () => {} });

    const [primeira, segunda] = mock.match(() => true);
    const idA = primeira.request.headers.get(CABECALHO_CORRELACAO);
    const idB = segunda.request.headers.get(CABECALHO_CORRELACAO);

    expect(idA).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idB).not.toBe(idA);
    primeira.flush({});
    segunda.flush({});
  });

  it('carimba o id no erro exibível e registra a ocorrência', () => {
    let capturado: unknown = null;
    http.get('financial-entries').subscribe({ error: (e: unknown) => (capturado = e) });

    const requisicao = mock.expectOne(`${BASE}/financial-entries`);
    const id = requisicao.request.headers.get(CABECALHO_CORRELACAO);
    requisicao.flush(
      { statusCode: 500, message: 'Erro interno' },
      { status: 500, statusText: 'Erro' },
    );

    expect(capturado).toBeInstanceOf(ApiError);
    // É o mesmo id que o backend usou nos logs daquela requisição.
    expect((capturado as ApiError).correlationId).toBe(id);

    const ocorrencia = registro.ultima();
    expect(ocorrencia?.correlationId).toBe(id);
    expect(ocorrencia?.origem).toBe('http');
    expect(registro.paraSuporte()).toContain(id!);
  });

  it('não guarda corpo, token nem cabeçalho na ocorrência', () => {
    http
      .post('auth/login', { email: 'jamile@empresa.com.br', password: 'senha-secreta' })
      .subscribe({ error: () => {} });

    mock
      .expectOne(`${BASE}/auth/login`)
      .flush(
        { statusCode: 401, message: 'Credenciais inválidas' },
        { status: 401, statusText: 'x' },
      );

    const texto = JSON.stringify(registro.ocorrencias());
    expect(texto).not.toContain('senha-secreta');
    expect(texto).not.toContain('Bearer');
    expect(texto).not.toContain('password');
  });

  it('guarda só as últimas ocorrências, da mais recente para a mais antiga', () => {
    for (let i = 0; i < 25; i++) registro.registrar(new Error(`falha ${i}`));

    const ocorrencias = registro.ocorrencias();
    expect(ocorrencias).toHaveLength(20);
    expect(ocorrencias[0].mensagem).toContain('falha 24');
  });

  it('o ErrorHandler registra erro da aplicação e não duplica o que já veio da API', () => {
    const handler = TestBed.runInInjectionContext(() => new SgeErrorHandler());

    handler.handleError(new NetworkError());
    expect(registro.ocorrencias()).toHaveLength(0);

    handler.handleError({ rejection: new TypeError('x is not a function') });
    const ocorrencia = registro.ultima();
    expect(ocorrencia?.origem).toBe('aplicacao');
    expect(ocorrencia?.mensagem).toContain('TypeError');
  });
});
