import { Component, computed, inject, signal, viewChild, type ElementRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';

import { GlobalSearchService, type ResultadoBusca } from '../core/search/global-search.service';
import { LoadingBlock } from '../ui/loading-block';

/**
 * Busca global (UI-077).
 *
 * Atalho `Ctrl`/`Cmd` + `K` de qualquer tela, setas para percorrer, `Enter`
 * para abrir o registro e `Esc` para sair — quem opera o dia inteiro não tira a
 * mão do teclado para procurar uma nota ou um título.
 *
 * A caixa da barra superior é um botão, não um campo: digitar ali dentro e
 * dentro do diálogo seriam dois campos com o mesmo texto, e o primeiro
 * caractere se perderia na troca.
 */
@Component({
  selector: 'sge-global-search',
  imports: [DialogModule, InputTextModule, LoadingBlock],
  host: { '(document:keydown)': 'atalho($event)' },
  template: `
    <button type="button" class="gatilho" (click)="abrir()" aria-label="Busca global">
      <i class="pi pi-search gatilho__icone" aria-hidden="true"></i>
      <span class="gatilho__texto">Buscar…</span>
      <kbd class="gatilho__kbd">Ctrl K</kbd>
    </button>

    @if (aberta()) {
      <p-dialog
        [visible]="true"
        [modal]="true"
        [draggable]="false"
        [resizable]="false"
        [showHeader]="false"
        [style]="{ width: '38rem' }"
        styleClass="busca"
        (visibleChange)="fechar()"
      >
        <div class="busca__campo">
          <i class="pi pi-search" aria-hidden="true"></i>
          <input
            #campo
            pInputText
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="busca-resultados"
            [attr.aria-activedescendant]="idAtivo()"
            placeholder="Buscar parceiro, produto, título, pedido, funcionário ou nota"
            aria-label="Busca global"
            [value]="termo()"
            (input)="digitar($event)"
            (keydown)="navegar($event)"
          />
        </div>

        <div class="busca__corpo" id="busca-resultados" role="listbox" aria-label="Resultados">
          @if (carregando()) {
            <sge-loading-block [quantidade]="3" rotulo="Buscando…" />
          } @else if (termo().trim().length < 2) {
            <p class="busca__dica">
              Digite ao menos dois caracteres. A busca percorre só os módulos que o seu perfil
              libera.
            </p>
          } @else if (resultados().length === 0) {
            <p class="busca__dica">Nenhum registro encontrado para “{{ termo() }}”.</p>
          } @else {
            @for (grupo of grupos(); track grupo.nome) {
              <p class="busca__grupo">{{ grupo.nome }}</p>
              @for (item of grupo.itens; track item.id) {
                <button
                  type="button"
                  role="option"
                  tabindex="-1"
                  [id]="'busca-' + item.indice"
                  [attr.aria-selected]="item.indice === ativo()"
                  class="busca__item"
                  [class.busca__item--ativo]="item.indice === ativo()"
                  (click)="abrirResultado(item.resultado)"
                  (mouseenter)="ativo.set(item.indice)"
                >
                  <span class="busca__titulo">{{ item.resultado.titulo }}</span>
                  @if (item.resultado.subtitulo) {
                    <span class="busca__subtitulo">{{ item.resultado.subtitulo }}</span>
                  }
                </button>
              }
            }
          }
        </div>
      </p-dialog>
    }
  `,
  styles: `
    .gatilho {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 20rem;
      padding: 0.45rem 0.6rem;
      background: var(--p-content-background);
      border: 1px solid var(--p-content-border-color);
      border-radius: var(--p-content-border-radius);
      color: var(--p-text-muted-color);
      font: inherit;
      font-size: 0.8rem;
      text-align: left;
      cursor: pointer;
    }
    .gatilho:hover {
      border-color: var(--p-primary-color);
    }
    .gatilho__icone {
      font-size: 0.8rem;
    }
    .gatilho__texto {
      flex: 1;
    }
    .gatilho__kbd {
      padding: 0.15rem 0.4rem;
      border: 1px solid var(--p-content-border-color);
      border-radius: 5px;
      font-family: inherit;
      font-size: 0.68rem;
    }
    /* No celular a barra superior não tem 20rem sobrando, e o atalho de teclado
       não significa nada num aparelho sem teclado: sobra a lupa, com o rótulo
       acessível que o botão já carrega (UI-083). */
    @media (max-width: 900px) {
      .gatilho {
        width: auto;
        padding: 0.45rem 0.7rem;
      }
      .gatilho__texto,
      .gatilho__kbd {
        display: none;
      }
    }
    .busca__campo {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.25rem 0 0.85rem;
    }
    .busca__campo input {
      width: 100%;
    }
    .busca__corpo {
      max-height: 22rem;
      overflow-y: auto;
      border-top: 1px solid var(--p-content-border-color);
    }
    .busca__dica {
      margin: 0;
      padding: 1.5rem 0.5rem;
      text-align: center;
      font-size: 0.8rem;
      color: var(--p-text-muted-color);
    }
    .busca__grupo {
      margin: 0;
      padding: 0.7rem 0.5rem 0.3rem;
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--p-text-muted-color);
    }
    .busca__item {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      width: 100%;
      padding: 0.5rem 0.6rem;
      background: none;
      border: none;
      border-radius: 8px;
      font: inherit;
      text-align: left;
      cursor: pointer;
      color: var(--p-text-color);
    }
    .busca__item--ativo {
      background: var(--p-content-hover-background);
    }
    .busca__titulo {
      font-size: 0.85rem;
      font-weight: 500;
    }
    .busca__subtitulo {
      font-size: 0.72rem;
      color: var(--p-text-muted-color);
    }
  `,
})
export class GlobalSearch {
  private readonly busca = inject(GlobalSearchService);
  private readonly router = inject(Router);

  protected readonly aberta = signal(false);
  protected readonly termo = signal('');
  protected readonly carregando = signal(false);
  protected readonly resultados = signal<ResultadoBusca[]>([]);
  /** Índice destacado, na lista já achatada — é o que o `Enter` abre. */
  protected readonly ativo = signal(0);

  private readonly campo = viewChild<ElementRef<HTMLInputElement>>('campo');
  private readonly digitado = new Subject<string>();

  /** Agrupado para a tela, mas guardando o índice global de cada linha. */
  protected readonly grupos = computed(() => {
    const grupos: {
      nome: string;
      itens: { id: string; indice: number; resultado: ResultadoBusca }[];
    }[] = [];
    this.resultados().forEach((resultado, indice) => {
      const grupo = grupos.find((g) => g.nome === resultado.grupo);
      const item = { id: resultado.grupo + ':' + resultado.id, indice, resultado };
      if (grupo) grupo.itens.push(item);
      else grupos.push({ nome: resultado.grupo, itens: [item] });
    });
    return grupos;
  });

  protected readonly idAtivo = computed(() =>
    this.resultados().length ? `busca-${this.ativo()}` : null,
  );

  constructor() {
    this.digitado
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        // `switchMap` descarta a resposta de um termo que o usuário já trocou:
        // sem isso a busca antiga, mais lenta, sobrescreveria a atual.
        switchMap((termo) =>
          this.busca.buscar(termo).pipe(catchError(() => of([] as ResultadoBusca[]))),
        ),
        tap(() => this.carregando.set(false)),
        takeUntilDestroyed(),
      )
      .subscribe((resultados) => {
        this.resultados.set(resultados);
        this.ativo.set(0);
      });
  }

  /** `Ctrl`/`Cmd` + `K` abre de qualquer tela. */
  protected atalho(evento: KeyboardEvent): void {
    if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k') {
      evento.preventDefault();
      this.abrir();
    }
  }

  protected abrir(): void {
    this.aberta.set(true);
    // O diálogo só existe depois do próximo ciclo; o foco espera por ele.
    setTimeout(() => this.campo()?.nativeElement.focus());
  }

  protected fechar(): void {
    this.aberta.set(false);
    this.termo.set('');
    this.resultados.set([]);
    this.carregando.set(false);
  }

  protected digitar(evento: Event): void {
    const termo = (evento.target as HTMLInputElement).value;
    this.termo.set(termo);
    this.carregando.set(termo.trim().length >= 2);
    this.digitado.next(termo);
  }

  protected navegar(evento: KeyboardEvent): void {
    const total = this.resultados().length;
    switch (evento.key) {
      case 'ArrowDown':
        evento.preventDefault();
        if (total) this.ativo.update((i) => (i + 1) % total);
        break;
      case 'ArrowUp':
        evento.preventDefault();
        if (total) this.ativo.update((i) => (i - 1 + total) % total);
        break;
      case 'Enter': {
        const escolhido = this.resultados()[this.ativo()];
        if (escolhido) {
          evento.preventDefault();
          this.abrirResultado(escolhido);
        }
        break;
      }
      case 'Escape':
        evento.preventDefault();
        this.fechar();
        break;
    }
  }

  protected abrirResultado(resultado: ResultadoBusca): void {
    this.fechar();
    void this.router.navigate(resultado.rota);
  }
}
