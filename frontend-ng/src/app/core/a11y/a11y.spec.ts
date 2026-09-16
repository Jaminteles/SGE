import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DescribedByDirective } from './described-by.directive';
import { ID_CONTEUDO, RouteAnnouncer } from './route-announcer';

describe('DescribedByDirective (UI-082)', () => {
  @Component({
    imports: [DescribedByDirective],
    template: `
      <div
        class="envoltorio"
        [sgeDescribedBy]="[temDica() ? 'dica' : null, erro() ? 'erro' : null]"
        [sgeInvalido]="!!erro()"
      >
        <!-- Imita o que o PrimeNG gera: o controle real fica dentro. -->
        <div role="combobox"></div>
      </div>
      <span id="dica">Conta do plano de contas</span>
      @if (erro()) {
        <span id="erro">Informe a conta.</span>
      }
    `,
  })
  class Hospedeiro {
    readonly temDica = signal(true);
    readonly erro = signal('');
  }

  it('escreve aria-describedby e aria-invalid no controle interno, não no invólucro', async () => {
    await TestBed.configureTestingModule({ imports: [Hospedeiro] }).compileComponents();
    const fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();

    const envoltorio = fixture.nativeElement.querySelector('.envoltorio') as HTMLElement;
    const combobox = fixture.nativeElement.querySelector('[role="combobox"]') as HTMLElement;

    expect(combobox.getAttribute('aria-describedby')).toBe('dica');
    expect(envoltorio.hasAttribute('aria-describedby')).toBe(false);
    expect(combobox.hasAttribute('aria-invalid')).toBe(false);

    fixture.componentInstance.erro.set('Informe a conta.');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(combobox.getAttribute('aria-describedby')).toBe('dica erro');
    expect(combobox.getAttribute('aria-invalid')).toBe('true');

    // O erro sumiu: o campo não pode continuar anunciado como inválido.
    fixture.componentInstance.erro.set('');
    fixture.componentInstance.temDica.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(combobox.hasAttribute('aria-describedby')).toBe(false);
    expect(combobox.hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('RouteAnnouncer (UI-082)', () => {
  @Component({ template: '<p>tela</p>' })
  class Tela {}

  let conteudo: HTMLElement;

  beforeEach(async () => {
    // O `<main>` da moldura: é ele que recebe o foco na troca de rota.
    conteudo = document.createElement('main');
    conteudo.id = ID_CONTEUDO;
    conteudo.tabIndex = -1;
    document.body.appendChild(conteudo);

    await TestBed.configureTestingModule({
      imports: [RouteAnnouncer],
      providers: [
        provideRouter([
          { path: 'financeiro', component: Tela, title: 'Financeiro · SGE' },
          { path: 'bancos', component: Tela, title: 'Bancos · SGE' },
        ]),
      ],
    }).compileComponents();
  });

  afterEach(() => conteudo.remove());

  it('anuncia a rota e leva o foco ao conteúdo a partir da segunda navegação', async () => {
    const fixture = TestBed.createComponent(RouteAnnouncer);
    fixture.detectChanges();
    const router = TestBed.inject(Router);

    await router.navigate(['/financeiro']);
    fixture.detectChanges();

    const regiao = fixture.nativeElement.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(regiao.getAttribute('role')).toBe('status');
    expect(regiao.textContent?.trim()).toBe('Financeiro. Página carregada.');
    // Primeira navegação: o foco fica onde o navegador colocou.
    expect(document.activeElement).not.toBe(conteudo);

    await router.navigate(['/bancos']);
    fixture.detectChanges();

    expect(regiao.textContent?.trim()).toBe('Bancos. Página carregada.');
    expect(document.activeElement).toBe(conteudo);
  });
});
