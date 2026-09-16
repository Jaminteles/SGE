import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { SGE_INTERCEPTORS } from '../core/api/interceptors';
import type { UserProfile } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { ViewportService } from '../core/layout/viewport.service';
import { CompanyService } from '../core/company/company.service';
import { activeCompanyStore } from '../core/company/active-company-store';
import { makeUser } from '../core/test/factories';
import { AppLayout } from './app-layout';

const BASE = '/api/v1';

/**
 * `ViewportService` lê `matchMedia`, que o jsdom não liga a largura nenhuma.
 * O dublê expõe o mesmo sinal para o teste poder "girar o aparelho".
 */
class ViewportFalso {
  private readonly estado = signal(false);
  readonly compacto = this.estado.asReadonly();
  definir(compacto: boolean): void {
    this.estado.set(compacto);
  }
}

@Component({ template: '<p>início</p>' })
class TelaInicial {}

describe('AppLayout — acessibilidade e responsividade (UI-082 / UI-083)', () => {
  let fixture: ComponentFixture<AppLayout>;
  let mock: HttpTestingController;
  let viewport: ViewportFalso;

  async function montar(usuario: UserProfile = makeUser()): Promise<void> {
    localStorage.clear();
    activeCompanyStore.set(null);
    viewport = new ViewportFalso();

    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: TelaInicial }]),
        provideHttpClient(withInterceptors(SGE_INTERCEPTORS)),
        provideHttpClientTesting(),
        { provide: ViewportService, useValue: viewport },
      ],
    });
    mock = TestBed.inject(HttpTestingController);

    const auth = TestBed.inject(AuthService);
    TestBed.inject(CompanyService);
    const entrando = auth.login('jamile@empresa.com.br', 'senha');
    mock
      .expectOne(`${BASE}/auth/login`)
      .flush({ accessToken: 'tok', refreshToken: 'ref', tokenType: 'Bearer', user: usuario });
    await entrando;

    fixture = TestBed.createComponent(AppLayout);
    fixture.detectChanges();
    // Sem navegação não há rota ativa, e `routerLinkActive` nunca marcaria nada.
    await TestBed.inject(Router).navigate(['/']);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await montar();
  });

  function elemento<T extends HTMLElement>(seletor: string): T {
    const achado = fixture.nativeElement.querySelector(seletor) as T | null;
    expect(achado, `elemento ausente: ${seletor}`).toBeTruthy();
    return achado!;
  }

  it('abre com o link de pular e com os marcos da página', () => {
    const pular = elemento<HTMLAnchorElement>('.pular-conteudo');
    const main = elemento<HTMLElement>('main');

    // O link de pular precisa ser o primeiro focável do documento; um elemento
    // focável antes dele tornaria o atalho inútil.
    expect(fixture.nativeElement.firstElementChild).toBe(pular);
    expect(pular.getAttribute('href')).toBe(`#${main.id}`);
    expect(main.getAttribute('tabindex')).toBe('-1');
    expect(elemento('nav').getAttribute('aria-label')).toBe('Módulos');
    expect(elemento('[aria-live="polite"]')).toBeTruthy();
  });

  it('leva o foco ao conteúdo pelo link de pular, sem sujar a URL', () => {
    const pular = elemento<HTMLAnchorElement>('.pular-conteudo');
    const main = elemento<HTMLElement>('main');
    document.body.appendChild(fixture.nativeElement);

    const evento = new MouseEvent('click', { bubbles: true, cancelable: true });
    pular.dispatchEvent(evento);

    expect(evento.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(main);
    expect(location.hash).toBe('');
  });

  it('marca o módulo aberto com aria-current e descreve o bloqueado em texto', async () => {
    // O usuário padrão tem `company:READ` e `partners:READ`: alguns módulos
    // ficam liberados e o resto, bloqueado.
    const bloqueado = elemento<HTMLElement>('.navitem--bloqueado');
    expect(bloqueado.getAttribute('aria-disabled')).toBe('true');
    expect(bloqueado.querySelector('.sr-only')?.textContent).toBe('Sem permissão no perfil');
    // Item inerte não pode entrar na ordem de tabulação.
    expect(bloqueado.tagName).toBe('SPAN');

    const ativo = fixture.nativeElement.querySelector('[aria-current="page"]');
    expect(ativo?.textContent?.trim()).toBe('Início');
  });

  it('mantém o menu fora da ordem de foco enquanto a gaveta está fechada', async () => {
    const menu = elemento<HTMLElement>('.sidebar');
    const botao = elemento<HTMLButtonElement>('.menu-toggle');

    // Layout largo: o menu está à vista e nunca é inerte.
    expect(menu.hasAttribute('inert')).toBe(false);
    expect(botao.getAttribute('aria-controls')).toBe(menu.id);
    expect(botao.getAttribute('aria-expanded')).toBe('false');

    viewport.definir(true);
    fixture.detectChanges();
    expect(menu.hasAttribute('inert')).toBe(true);

    botao.click();
    fixture.detectChanges();
    expect(menu.hasAttribute('inert')).toBe(false);
    expect(botao.getAttribute('aria-expanded')).toBe('true');
    expect(menu.classList.contains('sidebar--aberta')).toBe(true);
    // O véu só existe com a gaveta aberta.
    expect(fixture.nativeElement.querySelector('.veu')).toBeTruthy();
  });

  it('devolve o foco ao botão ao fechar a gaveta e volta ao layout fixo ao alargar', () => {
    document.body.appendChild(fixture.nativeElement);
    const botao = elemento<HTMLButtonElement>('.menu-toggle');

    viewport.definir(true);
    fixture.detectChanges();
    botao.click();
    fixture.detectChanges();

    botao.click();
    fixture.detectChanges();
    expect(document.activeElement).toBe(botao);
    expect(botao.getAttribute('aria-expanded')).toBe('false');

    // Gaveta aberta + janela alargada: o véu não pode continuar sobre a tela.
    botao.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.veu')).toBeTruthy();

    viewport.definir(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.veu')).toBeNull();
    expect(elemento<HTMLElement>('.sidebar').hasAttribute('inert')).toBe(false);
  });
});
