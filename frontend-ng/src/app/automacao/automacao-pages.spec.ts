import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';

import { routes } from '../app.routes';
import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type { AppNotification, AutomationRule } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { CompanyService } from '../core/company/company.service';
import { makeMembership, makeUser } from '../core/test/factories';
import { AlertPreferencesPage } from './alert-preferences-page';
import { AutomationRulesPage } from './automation-rules-page';
import { NotificationsPage } from './notifications-page';
import {
  destinoInterno,
  formRegraDe,
  formRegraVazia,
  montarEdicaoRegra,
  montarRegra,
  naoLida,
  problemaRegra,
  resumoAcoes,
  resumoCondicoes,
  rotuloPrioridade,
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

function aviso(sobrescrever: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'not-1',
    userId: 'usr-1',
    channel: 'INTERNO',
    type: 'VENCIMENTO',
    title: 'Título vence em 2 dias',
    message: 'Fornecedor ACME — R$ 1.200,00 vence em 12/02/2026.',
    priority: 2,
    entity: 'titulo',
    entityId: 'tit-1',
    link: '/financeiro/titulos/tit-1',
    status: 'ENVIADA',
    sentAt: '2026-02-10T12:00:00.000Z',
    readAt: null,
    createdAt: '2026-02-10T12:00:00.000Z',
    ...sobrescrever,
  };
}

function regra(sobrescrever: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'reg-1',
    name: 'Vencimento em 3 dias',
    description: null,
    triggerEvent: 'TITULO_VENCENDO',
    conditions: { daysAhead: 3, includeOverdue: true },
    actions: [
      { type: 'NOTIFICAR', channel: 'INTERNO', permission: 'financial-entries:READ', priority: 2 },
    ],
    isActive: true,
    lastRunAt: '2026-02-10T12:00:00.000Z',
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-02-10T12:00:00.000Z',
    ...sobrescrever,
  };
}

// ---------------------------------------------------------------------------

describe('vocabulário de notificações e automação (UI-065 a UI-067)', () => {
  it('a prioridade vira rótulo, e o não lido é o que ainda não foi aberto', () => {
    expect(rotuloPrioridade(1)).toBe('Urgente');
    expect(rotuloPrioridade(9)).toBe('Prioridade 9');
    expect(naoLida(aviso())).toBe(true);
    expect(naoLida(aviso({ readAt: '2026-02-10T13:00:00.000Z' }))).toBe(false);
    expect(naoLida(aviso({ status: 'CANCELADA' }))).toBe(false);
  });

  it('só navega para caminho interno — link absoluto do servidor é descartado', () => {
    expect(destinoInterno(aviso())).toBe('/financeiro/titulos/tit-1');
    expect(destinoInterno(aviso({ link: 'https://exemplo.invalido/phish' }))).toBeNull();
    expect(destinoInterno(aviso({ link: '//exemplo.invalido' }))).toBeNull();
    expect(destinoInterno(aviso({ link: null }))).toBeNull();
  });

  it('exige destinatário e recusa permissão fora do formato recurso:AÇÃO (RF-125)', () => {
    const base = { ...formRegraVazia(), name: 'Vencimento' };
    expect(problemaRegra(base)).toContain('permissão');

    const comDestino = {
      ...base,
      acoes: [{ channel: 'INTERNO' as const, permission: 'financial-entries:READ', priority: '2' }],
    };
    expect(problemaRegra(comDestino)).toBeNull();
    expect(
      problemaRegra({ ...comDestino, acoes: [{ ...comDestino.acoes[0], permission: 'qualquer' }] }),
    ).toContain('recurso:AÇÃO');
    expect(problemaRegra({ ...comDestino, daysAhead: '200' })).toContain('0 a 90');
    expect(problemaRegra({ ...comDestino, minAmount: '10,5' })).toContain('2 casas');

    expect(montarRegra(comDestino)).toEqual({
      name: 'Vencimento',
      triggerEvent: 'TITULO_VENCENDO',
      isActive: true,
      conditions: { includeOverdue: true, daysAhead: 3 },
      actions: [
        { type: 'NOTIFICAR', channel: 'INTERNO', permission: 'financial-entries:READ', priority: 2 },
      ],
    });
  });

  it('a edição manda ação e condição inteiras, nunca um pedaço', () => {
    const atual = regra();
    const form = formRegraDe(atual);
    expect(montarEdicaoRegra(form, atual)).toEqual({});

    const mudado = { ...form, daysAhead: '7' };
    expect(montarEdicaoRegra(mudado, atual)).toEqual({
      conditions: { includeOverdue: true, daysAhead: 7 },
    });

    const outroCanal = {
      ...form,
      acoes: [{ ...form.acoes[0], channel: 'EMAIL' as const }],
    };
    expect(montarEdicaoRegra(outroCanal, atual).actions).toHaveLength(1);
  });

  it('resume condições e destinatários para a lista', () => {
    expect(resumoCondicoes(regra())).toContain('3 dia(s)');
    expect(resumoCondicoes(regra({ triggerEvent: 'APROVACAO_PENDENTE' }))).toBe(
      'Todo fato observado',
    );
    expect(resumoAcoes(regra())).toBe('Aviso interno → financial-entries:READ');
  });
});

// ---------------------------------------------------------------------------

describe('central de notificações (UI-065)', () => {
  it('lista a caixa do usuário na empresa ativa e destaca o não lido', () => {
    const { mock, companyId } = prepararSessao(['notifications:READ']);
    const fixture = TestBed.createComponent(NotificationsPage);
    fixture.detectChanges();

    const requisicao = mock.expectOne((r) => r.url === `${BASE}/notifications`);
    expect(requisicao.request.headers.get('x-company-id')).toBe(companyId);
    requisicao.flush({ ...VAZIO, data: [aviso()], total: 1 });
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Título vence em 2 dias');
    expect(texto).toContain('Alta');
    expect(texto).toContain('Abrir o registro');
    // Sem `notifications:UPDATE` não há como marcar como lido.
    expect(texto).not.toContain('Marcar como lido');
    expect(texto).not.toContain('Marcar todas como lidas');
    mock.verify();
  });

  it('marca como lido sem recarregar a lista inteira', () => {
    const { mock } = prepararSessao(['notifications:READ', 'notifications:UPDATE']);
    const fixture = TestBed.createComponent(NotificationsPage);
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/notifications`)
      .flush({ ...VAZIO, data: [aviso()], total: 1 });
    fixture.detectChanges();

    (fixture.componentInstance as unknown as { marcar(a: AppNotification): void }).marcar(aviso());

    const leitura = mock.expectOne(`${BASE}/notifications/not-1/read`);
    expect(leitura.request.method).toBe('POST');
    leitura.flush(aviso({ status: 'LIDA', readAt: '2026-02-10T13:00:00.000Z' }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Marcar como lido');
    mock.verify();
  });
});

describe('preferências de alerta (UI-066)', () => {
  it('mostra uma linha por família e aponta o que ninguém configurou', () => {
    const { mock } = prepararSessao(['automation-rules:READ']);
    const fixture = TestBed.createComponent(AlertPreferencesPage);
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/automation-rules`)
      .flush({ ...VAZIO, data: [regra()], total: 1 });
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Título vencendo');
    expect(texto).toContain('Avisando');
    expect(texto).toContain('Não configurado');
    expect(texto).toContain('Somente leitura');
    expect(texto).not.toContain('Desligar avisos');
    mock.verify();
  });

  it('desligar desativa a regra — não apaga', () => {
    const { mock } = prepararSessao(['automation-rules:READ', 'automation-rules:UPDATE']);
    const fixture = TestBed.createComponent(AlertPreferencesPage);
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/automation-rules`)
      .flush({ ...VAZIO, data: [regra()], total: 1 });
    fixture.detectChanges();

    (fixture.componentInstance as unknown as { alternar(r: AutomationRule): void }).alternar(
      regra(),
    );

    const requisicao = mock.expectOne(`${BASE}/automation-rules/reg-1`);
    expect(requisicao.request.method).toBe('PATCH');
    expect(requisicao.request.body).toEqual({ isActive: false });
    requisicao.flush(regra({ isActive: false }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('os avisos deste fato param');
    mock.verify();
  });

  it('o canal salvo vai em todas as ações da regra, nunca em metade', () => {
    const { mock } = prepararSessao(['automation-rules:READ', 'automation-rules:UPDATE']);
    const fixture = TestBed.createComponent(AlertPreferencesPage);
    fixture.detectChanges();

    const duasAcoes = regra({
      actions: [
        { type: 'NOTIFICAR', channel: 'INTERNO', permission: 'financial-entries:READ', priority: 2 },
        { type: 'NOTIFICAR', channel: 'INTERNO', permission: 'payments:APPROVE', priority: 1 },
      ],
    });
    mock
      .expectOne((r) => r.url === `${BASE}/automation-rules`)
      .flush({ ...VAZIO, data: [duasAcoes], total: 1 });
    fixture.detectChanges();

    const pagina = fixture.componentInstance as unknown as {
      mudarCanal(r: AutomationRule, canal: string): void;
      salvar(r: AutomationRule): void;
    };
    pagina.mudarCanal(duasAcoes, 'EMAIL');
    pagina.salvar(duasAcoes);

    const requisicao = mock.expectOne(`${BASE}/automation-rules/reg-1`);
    const corpo = requisicao.request.body as { actions: { channel: string }[] };
    expect(corpo.actions.map((acao) => acao.channel)).toEqual(['EMAIL', 'EMAIL']);
    requisicao.flush(duasAcoes);
    mock.verify();
  });
});

describe('editor de regras (UI-067)', () => {
  it('abre o histórico de execuções da regra', () => {
    const { mock } = prepararSessao(['automation-rules:READ']);
    const fixture = TestBed.createComponent(AutomationRulesPage);
    fixture.detectChanges();

    mock
      .expectOne((r) => r.url === `${BASE}/automation-rules`)
      .flush({ ...VAZIO, data: [regra()], total: 1 });
    fixture.detectChanges();

    (
      fixture.componentInstance as unknown as { abrirHistorico(r: AutomationRule): void }
    ).abrirHistorico(regra());

    const execucoes = mock.expectOne(`${BASE}/automation-rules/reg-1/runs`);
    execucoes.flush([
      {
        id: 'run-1',
        status: 'CONCLUIDO',
        result: { notified: 3 },
        error: null,
        executedAt: '2026-02-10T12:00:00.000Z',
      },
    ]);
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('Concluída');
    expect(texto).toContain('notified: 3');
    // Sem permissão de escrita, nada de editar nem desativar.
    expect(texto).not.toContain('Nova regra');
    expect(texto).not.toContain('Desativar');
    mock.verify();
  });
});

describe('rotas da Automação (UI-065 a UI-067)', () => {
  it('abre as notificações dentro da moldura, com as abas que o perfil alcança', async () => {
    const { mock } = prepararSessao(['notifications:READ'], true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/automacao');

    mock.match((r) => r.url === `${BASE}/notifications`).forEach((r) => r.flush(VAZIO));
    harness.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/automacao/notificacoes');
    const texto = harness.routeNativeElement?.textContent ?? '';
    expect(texto).toContain('Notificações');
    // Sem `automation-rules:READ`: nem preferências, nem regras.
    expect(texto).not.toContain('Preferências de alerta');
  });

  it('manda para "sem permissão" as regras sem `automation-rules:READ`', async () => {
    prepararSessao(['notifications:READ'], true);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/automacao/regras');
    expect(TestBed.inject(Router).url).toContain('/sem-permissao');
  });
});
