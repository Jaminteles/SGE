import { Component, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { TooltipModule } from 'primeng/tooltip';

import { ajudaPara } from '../core/help/help-content';

/**
 * Ajuda contextual do módulo aberto (UI-092).
 *
 * Fica na barra superior, ao lado das preferências, e mostra a ajuda de onde o
 * usuário está — não um índice que ele precisa navegar. Abre numa gaveta
 * lateral, e não numa rota: sair da tela para ler como usá-la perderia o que
 * estava preenchido.
 *
 * O botão desaparece nas rotas que não são módulo (preferências, design
 * system). Um botão de ajuda que abre vazio ensina o usuário a não clicar nele.
 */
@Component({
  selector: 'sge-help-panel',
  imports: [ButtonModule, DrawerModule, TooltipModule],
  template: `
    @if (ajuda(); as conteudo) {
      <p-button
        [text]="true"
        severity="secondary"
        icon="pi pi-question-circle"
        [ariaLabel]="'Ajuda de ' + conteudo.titulo"
        pTooltip="Ajuda desta tela"
        tooltipPosition="bottom"
        (onClick)="aberta.set(true)"
      />

      <p-drawer
        [visible]="aberta()"
        (visibleChange)="aberta.set($event)"
        position="right"
        styleClass="ajuda"
        [header]="'Ajuda · ' + conteudo.titulo"
      >
        <p class="ajuda__resumo">{{ conteudo.resumo }}</p>

        <h3 class="ajuda__titulo">Como se faz</h3>
        <ol class="ajuda__passos">
          @for (passo of conteudo.passos; track passo) {
            <li>{{ passo }}</li>
          }
        </ol>

        <h3 class="ajuda__titulo">Dúvidas frequentes</h3>
        <dl class="ajuda__duvidas">
          @for (duvida of conteudo.duvidas; track duvida.pergunta) {
            <dt>{{ duvida.pergunta }}</dt>
            <dd>{{ duvida.resposta }}</dd>
          }
        </dl>

        <p class="ajuda__rodape">
          O manual completo fica em <code>docs/manual-do-usuario.md</code>.
        </p>
      </p-drawer>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    .ajuda__resumo {
      margin-top: 0;
      font-size: 0.9rem;
    }
    .ajuda__titulo {
      margin: 1.25rem 0 0.5rem;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--p-text-muted-color);
    }
    .ajuda__passos {
      margin: 0;
      padding-left: 1.1rem;
      font-size: 0.85rem;
    }
    .ajuda__passos li + li {
      margin-top: 0.4rem;
    }
    .ajuda__duvidas {
      margin: 0;
      font-size: 0.85rem;
    }
    .ajuda__duvidas dt {
      font-weight: 600;
    }
    .ajuda__duvidas dd {
      margin: 0.25rem 0 0.8rem;
      color: var(--p-text-muted-color);
    }
    .ajuda__rodape {
      margin-top: 1.5rem;
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
    }
  `,
})
export class HelpPanel {
  private readonly router = inject(Router);

  protected readonly aberta = signal(false);

  /** A URL corrente como sinal — a ajuda acompanha a navegação. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((evento): evento is NavigationEnd => evento instanceof NavigationEnd),
      map((evento) => evento.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly ajuda = computed(() => ajudaPara(this.url()));

  constructor() {
    // Trocar de módulo com a gaveta aberta mostraria a ajuda do módulo anterior.
    effect(() => {
      this.url();
      this.aberta.set(false);
    });
  }
}
