import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';

import { routes } from '../app.routes';
import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type { Integration, IntegrationEvent, IntegrationHealth } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { IntegrationMonitorPage } from './integration-monitor-page';
import { IntegrationsPage } from './integrations-page';
import {
  formIntegracaoDe,
  formIntegracaoVazio,
  montarEdicaoIntegracao,
  montarIntegracao,
  montarParametros,
  parametrosMudaram,
  problemaIntegracao,
  problemaParametros,
  problemaSuspensao,
} from './rotulos';

const BASE = '/api/v1';
const VAZIO = { data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };

function prepararSessao(
  permissoes: string[],
  comRotas = false,
): { mock: HttpTestingController; companyId: string } {
  const membership = makeMembership({ permissions: permissoes });
  const usuario = makeUser({ memberships: [membership] });

  localStorage.clear();
  activeCompanyStore.set(membership.companyId);

  TestBed.configureTestingModule({
    providers: [
      provideRouter(comRotas ? routes : []),
      provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
      provideHttpClientTesting(),
      {
        provide: AuthService,
        useValue: {
          usuario: () => usuario,
          superAdmin: () => false,
          autenticado: () => true,
          prontidao: () => Promise.resolve(),
          expiraEm: () => null,
          logout: () => Promise.resolve(),
        },
      },
      {
        provide: CompanyService,
        useValue: {
          ativaId: () => membership.companyId,
          ativa: () => membership,
          permissoes: () => new Set(permissoes),
          prontidao: () => Promise.resolve(),
          recarregarPlataforma: () => {},
          precisaSelecionar: () => false,
        },
      },
    ],
  });

  return { mock: TestBed.inject(HttpTestingController), companyId: membership.companyId };
}

function integracao(sobrescrever: Partial<Integration> = {}): Integration {
  return {
    id: 'int-1',
    code: 'BANCO-PIX',
    name: 'Banco PIX',
    environment: 'PRODUCAO',
    parameters: { endpoint: 'https://api.banco.exemplo/v1' },
    status: 'ATIVA',
    isActive: true,
    timeoutMs: 10_000,
    maxAttempts: 5,
    failureStreak: 0,
    failureThreshold: 10,
    lastRunAt: '2026-03-10T12:00:00.000Z',
    lastSuccessAt: '2026-03-10T12:00:00.000Z',
    lastFailureAt: null,
    lastError: null,
    suspensionReason: null,
    note: null,
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-03-10T12:00:00.000Z',
    provider: {
      id: 'prov-1',
      code: 'BANCO',
      name: 'Banco Exemplo',
      category: 'BANCO',
      capabilities: {} as Integration['provider']['capabilities'],
    },
    credential: null,
    ...sobrescrever,
  };
}

function saude(): IntegrationHealth {
  return {
    integrations: [
      {
        id: 'int-1',
        code: 'BANCO-PIX',
        name: 'Banco PIX',
        status: 'ATIVA',
        isActive: true,
        provider: { code: 'BANCO', category: 'BANCO' },
        failureStreak: 3,
        failureThreshold: 10,
        lastRunAt: '2026-03-10T12:00:00.000Z',
        lastSuccessAt: '2026-03-09T12:00:00.000Z',
        lastFailureAt: '2026-03-10T12:00:00.000Z',
        lastError: 'timeout ao chamar o provedor',
        events24h: 40,
        errors24h: 3,
        lastErrorEventAt: '2026-03-10T12:00:00.000Z',
        degraded: true,
      },
    ],
    totals: { total: 1, active: 1, suspended: 0, degraded: 1, errors24h: 3 },
    queue: { window: '7d', byStatus: {}, pending: 2, failed: 1 },
    webhooks: { window: '7d', byStatus: {}, pending: 0, failed: 0 },
  };
}

function evento(): IntegrationEvent {
  return {
    id: 'evt-1',
    integrationId: 'int-1',
    providerId: 'prov-1',
    type: 'CHAMADA',
    severity: 'ERRO',
    operation: 'pagamento.enviar',
    message: 'timeout ao chamar o provedor',
    detail: null,
    referenceType: null,
    referenceId: null,
    httpStatus: 504,
    durationMs: 10_000,
    attempt: 3,
    correlationId: 'cor-1',
    occurredAt: '2026-03-10T12:00:00.000Z',
    integration: { id: 'int-1', code: 'BANCO-PIX', name: 'Banco PIX' },
  };
}

// ---------------------------------------------------------------------------

describe('cadastro de integração — regras espelhadas do backend (UI-074)', () => {
  it('recusa parâmetro com nome de credencial, chave vazia e chave repetida (RF-127)', () => {
    expect(problemaParametros([{ chave: 'endpoint', valor: 'https://x' }])).toBeNull();
    expect(problemaParametros([{ chave: 'api_key', valor: 'abc' }])).toContain('credencial');
    expect(problemaParametros([{ chave: 'SENHA', valor: 'abc' }])).toContain('credencial');
    expect(problemaParametros([{ chave: '  ', valor: 'x' }])).toContain('sem nome');
    expect(
      problemaParametros([
        { chave: 'endpoint', valor: 'a' },
        { chave: 'endpoint', valor: 'b' },
      ]),
    ).toContain('duas vezes');
  });

  it('confere provedor, código e limites antes de chamar a API', () => {
    const base = {
      ...formIntegracaoVazio(),
      providerId: 'prov-1',
      code: 'banco-pix',
      name: 'Banco PIX',
    };
    expect(problemaIntegracao(base)).toBeNull();
    expect(problemaIntegracao({ ...base, providerId: '' })).toContain('provedor');
    expect(problemaIntegracao({ ...base, code: 'banco pix' })).toContain('código');
    expect(problemaIntegracao({ ...base, timeoutMs: '100' })).toContain('tempo limite');
    expect(problemaIntegracao({ ...base, maxAttempts: '99' })).toContain('tentativas');

    // O código vai maiúsculo, como o backend o normaliza.
    expect(montarIntegracao(base)).toMatchObject({ code: 'BANCO-PIX', providerId: 'prov-1' });
  });

  it('a edição não manda código nem provedor, e parâmetros vão por rota própria', () => {
    const atual = integracao();
    const form = formIntegracaoDe(atual);
    expect(montarEdicaoIntegracao(form, atual)).toEqual({});
    expect(parametrosMudaram(form, atual)).toBe(false);

    const renomeada = { ...form, code: 'OUTRO', providerId: 'prov-9', name: 'Banco PIX v2' };
    expect(montarEdicaoIntegracao(renomeada, atual)).toEqual({ name: 'Banco PIX v2' });

    const comParametro = {
      ...form,
      parametros: [...form.parametros, { chave: 'timeout', valor: '30' }],
    };
    expect(parametrosMudaram(comParametro, atual)).toBe(true);
    expect(montarParametros(comParametro.parametros)).toEqual({
      endpoint: 'https://api.banco.exemplo/v1',
      timeout: '30',
    });
  });

  it('suspensão exige motivo escrito', () => {
    expect(problemaSuspensao('')).toContain('Explique');
    expect(problemaSuspensao('erro')).toContain('Explique');
    expect(problemaSuspensao('Provedor em manutenção até sexta')).toBeNull();
  });
});

describe('administração de integrações (UI-074)', () => {
  it('lista a empresa ativa e esconde as ações sem permissão de escrita', () => {
    const { mock, companyId } = prepararSessao(['integrations:READ']);
    const fixture = TestBed.createComponent(IntegrationsPage);
    fixture.detectChanges();

    const requisicao = mock.expectOne((r) => r.url === `${BASE}/integrations`);
    expect(requisicao.request.headers.get('x-company-id')).toBe(companyId);
    requisicao.flush({ ...VAZIO, data: [integracao()], total: 1 });
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('BANCO-PIX');
    expect(texto).toContain('Ativa');
    expect(texto).not.toContain('Nova integração');
    expect(texto).not.toContain('Suspender');
    // Sem `integration-credentials:READ` o catálogo de provedores nem é pedido.
    mock.expectNone((r) => r.url === `${BASE}/banking/providers`);
    mock.verify();
  });

  it('suspende com motivo e não envia nada sem ele', () => {
    const { mock } = prepararSessao(['integrations:READ', 'integrations:UPDATE']);
    const fixture = TestBed.createComponent(IntegrationsPage);
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/integrations`)
      .flush({ ...VAZIO, data: [integracao()], total: 1 });
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as {
      abrirSuspensao(i: Integration): void;
      motivo: { set(v: string): void };
      suspender(): void;
    };
    pagina.abrirSuspensao(integracao());
    pagina.suspender();
    mock.expectNone((r) => r.url === `${BASE}/integrations/int-1/suspend`);

    pagina.motivo.set('Provedor em manutenção até sexta');
    pagina.suspender();

    const requisicao = mock.expectOne(`${BASE}/integrations/int-1/suspend`);
    expect(requisicao.request.method).toBe('POST');
    expect(requisicao.request.body).toEqual({ reason: 'Provedor em manutenção até sexta' });
    requisicao.flush(integracao({ status: 'SUSPENSA' }));

    mock
      .expectOne((r) => r.url === `${BASE}/integrations`)
      .flush({ ...VAZIO, data: [integracao({ status: 'SUSPENSA' })], total: 1 });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Nada é enviado por ela');
    mock.verify();
  });

  it('a edição só chama a rota de parâmetros quando eles mudaram', () => {
    const { mock } = prepararSessao([
      'integrations:READ',
      'integrations:UPDATE',
      'integration-credentials:READ',
    ]);
    const fixture = TestBed.createComponent(IntegrationsPage);
    fixture.detectChanges();

    mock.expectOne((r) => r.url === `${BASE}/banking/providers`).flush([]);
    mock.expectOne((r) => r.url === `${BASE}/banking/credentials`).flush([]);
    mock
      .expectOne((r) => r.url === `${BASE}/integrations`)
      .flush({ ...VAZIO, data: [integracao()], total: 1 });
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as {
      abrirEdicao(i: Integration): void;
      mudar(campo: string, valor: unknown): void;
      salvar(): void;
    };
    pagina.abrirEdicao(integracao());
    pagina.mudar('name', 'Banco PIX v2');
    pagina.salvar();

    const alteracao = mock.expectOne(`${BASE}/integrations/int-1`);
    expect(alteracao.request.method).toBe('PATCH');
    expect(alteracao.request.body).toEqual({ name: 'Banco PIX v2' });
    alteracao.flush(integracao({ name: 'Banco PIX v2' }));

    mock.expectNone((r) => r.url === `${BASE}/integrations/int-1/parameters`);
    mock
      .expectOne((r) => r.url === `${BASE}/integrations`)
      .flush({ ...VAZIO, data: [integracao({ name: 'Banco PIX v2' })], total: 1 });
    mock.verify();
  });
});

describe('monitoramento das integrações (UI-075)', () => {
  it('destaca a integração degradada e conta a fila', () => {
    const { mock } = prepararSessao(['integrations:READ']);
    const fixture = TestBed.createComponent(IntegrationMonitorPage);
    fixture.detectChanges();

    mock.expectOne(`${BASE}/integrations/health`).flush(saude());
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Degradada');
    expect(texto).toContain('timeout ao chamar o provedor');
    expect(texto).toContain('Fila de trabalho');
    // Sem `integration-events:READ` não há diário nem lista de falhas.
    expect(texto).toContain('Sem acesso ao diário');
    mock.expectNone((r) => r.url === `${BASE}/integrations/events`);
    mock.verify();
  });

  it('reprocessa o que falhou e avisa quando já havia reprocessamento pendente', () => {
    const { mock } = prepararSessao([
      'integrations:READ',
      'integration-events:READ',
      'integration-events:APPROVE',
    ]);
    const fixture = TestBed.createComponent(IntegrationMonitorPage);
    fixture.detectChanges();

    mock.expectOne(`${BASE}/integrations/health`).flush(saude());
    mock
      .expectOne((r) => r.url === `${BASE}/integrations/events`)
      .flush({ ...VAZIO, data: [evento()], total: 1 });
    mock
      .match((r) => r.url === `${BASE}/integrations/failed`)
      .forEach((r) => r.flush({ ...VAZIO }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('timeout ao chamar o provedor');

    (
      fixture.componentInstance as unknown as { reprocessar(alvo: string, id: string): void }
    ).reprocessar('JOB', 'job-1');

    const requisicao = mock.expectOne(`${BASE}/integrations/reprocess`);
    expect(requisicao.request.body).toEqual({ target: 'JOB', id: 'job-1' });
    requisicao.flush({ target: 'JOB', sourceId: 'job-1', jobId: null, queue: 'padrao' });
    mock.match((r) => r.url === `${BASE}/integrations/failed`).forEach((r) => r.flush({ ...VAZIO }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('nada foi duplicado');
    mock.verify();
  });
});

describe('rotas das Integrações (UI-074/UI-075)', () => {
  it('abre a lista dentro da moldura de abas', async () => {
    const { mock } = prepararSessao(['integrations:READ'], true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/integracoes');

    mock.match((r) => r.url === `${BASE}/integrations`).forEach((r) => r.flush(VAZIO));
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/integracoes/provedores');
    const texto = harness.routeNativeElement?.textContent ?? '';
    expect(texto).toContain('Integrações');
    expect(texto).toContain('Monitoramento');
  });
});
