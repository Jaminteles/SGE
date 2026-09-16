import { Component, DestroyRef, Injector, afterNextRender, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, TitleStrategy } from '@angular/router';
import { filter } from 'rxjs/operators';

/** Id do `<main>` da moldura — alvo do link de pular e do foco de navegação. */
export const ID_CONTEUDO = 'conteudo-principal';

/**
 * Anúncio e foco a cada troca de rota (WCAG 2.1 AA — UI-082).
 *
 * Numa aplicação de página única o navegador não recarrega nada: para quem usa
 * leitor de tela, clicar em "Financeiro" não produz som nenhum e o foco fica
 * parado no item do menu — a pessoa não tem como saber que a tela mudou nem
 * onde ela começa. Dois problemas, duas correções:
 *
 * 1. A região `aria-live="polite"` anuncia o título da rota que acabou de
 *    entrar. É `polite` de propósito: interromper a leitura em curso a cada
 *    navegação seria pior que o silêncio.
 * 2. O foco vai para o `<main>` (que carrega `tabindex="-1"` justamente para
 *    poder recebê-lo). A partir dali, Tab percorre o conteúdo novo, e não o
 *    resto do menu lateral. Critério 2.4.3 (ordem de foco).
 *
 * A primeira navegação não mexe no foco: na carga inicial ele já está onde o
 * navegador colocou, e roubá-lo atrapalharia quem chegou por link direto.
 */
@Component({
  selector: 'sge-route-announcer',
  template: `
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ anuncio() }}</p>
  `,
})
export class RouteAnnouncer {
  protected readonly anuncio = signal('');

  private readonly router = inject(Router);
  private readonly titulos = inject(TitleStrategy);
  private readonly injector = inject(Injector);
  private primeira = true;

  constructor() {
    this.router.events
      .pipe(
        filter((evento) => evento instanceof NavigationEnd),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(() => {
        // O título sai do próprio snapshot da rota, e não do `document.title`:
        // a ordem em que o `TitleStrategy` e este componente reagem ao mesmo
        // evento não é garantida, e ler o título do documento cedo demais
        // anunciaria o da tela anterior.
        const rotulo = this.titulos.buildTitle(this.router.routerState.snapshot) ?? '';
        const titulo = rotulo.split('·')[0].trim();
        this.anuncio.set(titulo ? `${titulo}. Página carregada.` : 'Página carregada.');

        if (this.primeira) {
          this.primeira = false;
          return;
        }

        // Depois do render, não durante o evento de navegação: neste ponto o
        // `<router-outlet>` ainda tem a tela anterior, e mover o foco agora o
        // colocaria num conteúdo prestes a ser destruído.
        afterNextRender(
          () => document.getElementById(ID_CONTEUDO)?.focus({ preventScroll: true }),
          { injector: this.injector },
        );
      });
  }
}
