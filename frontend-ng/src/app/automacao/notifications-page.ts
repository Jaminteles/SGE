import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { NotificationsApiService } from '../core/api/notifications-api.service';
import type { AppNotification } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { ListState } from '../core/lib/list-state';
import { formatDateTime } from '../core/lib/format';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro, type ValoresFiltro } from '../ui/filter-bar';
import {
  OPCOES_STATUS_AVISO,
  OPCOES_TIPO_AVISO,
  ROTULO_STATUS_AVISO,
  ROTULO_TIPO_AVISO,
  destinoInterno,
  naoLida,
  rotuloPrioridade,
  severidadePrioridade,
} from './rotulos';

const FILTROS: DefinicaoFiltro[] = [
  { name: 'type', label: 'Tipo', options: OPCOES_TIPO_AVISO, placeholder: 'Todos os tipos' },
  {
    name: 'status',
    label: 'Situação',
    options: OPCOES_STATUS_AVISO,
    placeholder: 'Todas as situações',
  },
];

/**
 * Central de notificações do usuário (RF-119 — UI-065).
 *
 * A caixa é sempre a **de quem está logado**: o backend cruza a empresa ativa
 * com o usuário do token, e nenhum filtro desta tela alcança a caixa de um
 * colega — trocar o id na URL devolve 403 mesmo com `notifications:READ`.
 *
 * Não existe apagar: o que a tela chama de "limpar" é marcar como lido (bd/16
 * §8). Um aviso que some sem ninguém ter lido é exatamente o que o módulo
 * existe para evitar.
 */
@Component({
  selector: 'sge-notifications-page',
  imports: [ButtonModule, TagModule, Alert, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Automação / Notificações</p>

    <div class="pagehead">
      <div>
        <h1>Notificações</h1>
        <p>Avisos endereçados a você nesta empresa (RF-119).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeMarcar() && naoLidas() > 0) {
          <p-button
            label="Marcar todas como lidas"
            icon="pi pi-check-circle"
            severity="secondary"
            [outlined]="true"
            [loading]="marcandoTodas()"
            [disabled]="marcandoTodas()"
            (onClick)="marcarTodas()"
          />
        }
      </div>
    </div>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }
    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    <div class="espaco filtros">
      <sge-filter-bar
        [valores]="lista.filtros()"
        [filtros]="filtros"
        [busca]="false"
        (mudou)="aplicar($event)"
      />
      <label class="marcador">
        <input
          type="checkbox"
          [checked]="somenteNaoLidas()"
          (change)="alternarNaoLidas($any($event.target).checked)"
        />
        Somente não lidos
      </label>
    </div>

    <section class="card espaco">
      @for (item of lista.linhas(); track item.id) {
        <article class="aviso" [class.aviso--nova]="pendente(item)">
          <div class="aviso__cabecalho">
            <p-tag
              [value]="prioridade(item)"
              [severity]="severidade(item)"
              [rounded]="true"
              [title]="'Prioridade ' + item.priority"
            />
            <span class="aviso__tipo">{{ tipo(item) }}</span>
            <span class="aviso__data">{{ dataHora(item.createdAt) }}</span>
            <span class="aviso__situacao">{{ situacao(item) }}</span>
          </div>

          <h2 class="aviso__titulo">{{ item.title }}</h2>
          <p class="aviso__mensagem">{{ item.message }}</p>

          <div class="aviso__acoes">
            @if (destino(item); as caminho) {
              <p-button
                label="Abrir o registro"
                icon="pi pi-arrow-up-right"
                size="small"
                [text]="true"
                (onClick)="abrir(item, caminho)"
              />
            }
            @if (podeMarcar() && pendente(item)) {
              <p-button
                label="Marcar como lido"
                size="small"
                severity="secondary"
                [text]="true"
                [disabled]="!!marcando()"
                [loading]="marcando() === item.id"
                (onClick)="marcar(item)"
              />
            }
          </div>
        </article>
      } @empty {
        <p class="vazio">
          @if (lista.carregando()) {
            Carregando…
          } @else if (lista.temFiltro() || somenteNaoLidas()) {
            Nenhum aviso para este filtro.
          } @else {
            Nenhum aviso para você nesta empresa.
          }
        </p>
      }

      @if (lista.total() > lista.tamanhoPagina()) {
        <div class="paginacao">
          <p-button
            label="Anteriores"
            icon="pi pi-chevron-left"
            severity="secondary"
            [text]="true"
            [disabled]="lista.carregando() || lista.pagina() === 1"
            (onClick)="irPara(lista.pagina() - 1)"
          />
          <span class="paginacao__posicao">
            Página {{ lista.pagina() }} de {{ ultimaPagina() }}
          </span>
          <p-button
            label="Mais antigos"
            icon="pi pi-chevron-right"
            iconPos="right"
            severity="secondary"
            [text]="true"
            [disabled]="lista.carregando() || !temMais()"
            (onClick)="irPara(lista.pagina() + 1)"
          />
        </div>
      }
    </section>
  `,
  styles: [
    ESTILO_TABELA,
    `
      .filtros {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem;
      }
      .filtros sge-filter-bar {
        flex: 1;
      }
      .marcador {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.85rem;
      }
      .aviso {
        padding: 0.875rem;
        border-bottom: 1px solid var(--p-content-border-color);
      }
      .aviso:last-of-type {
        border-bottom: none;
      }
      .aviso--nova {
        border-left: 3px solid var(--p-primary-color);
      }
      .aviso__cabecalho {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.6rem;
        font-size: 0.75rem;
        color: var(--p-text-muted-color);
      }
      .aviso__tipo {
        font-weight: 500;
        color: var(--p-text-color);
      }
      .aviso__titulo {
        margin: 0.35rem 0 0.15rem;
        font-size: 0.92rem;
        font-weight: 600;
      }
      .aviso__mensagem {
        margin: 0;
        font-size: 0.82rem;
        line-height: 1.5;
        color: var(--p-text-muted-color);
      }
      .aviso__acoes {
        display: flex;
        gap: 0.4rem;
        margin-top: 0.4rem;
      }
      .paginacao {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        padding: 0.875rem;
      }
      .paginacao__posicao {
        font-size: 0.78rem;
        color: var(--p-text-muted-color);
      }
    `,
  ],
})
export class NotificationsPage {
  private readonly api = inject(NotificationsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly filtros = FILTROS;
  protected readonly dataHora = formatDateTime;

  protected readonly somenteNaoLidas = signal(false);

  protected readonly lista = new ListState<AppNotification>(
    (consulta) => this.api.list(consulta),
    (filtros) => ({
      type: filtros['type'] || undefined,
      status: filtros['status'] || undefined,
      unreadOnly: this.somenteNaoLidas() || undefined,
    }),
  );

  protected readonly aviso = signal<string | null>(null);
  protected readonly marcando = signal<string | null>(null);
  protected readonly marcandoTodas = signal(false);

  protected readonly naoLidas = computed(() => this.lista.linhas().filter(naoLida).length);
  protected readonly temMais = computed(
    () => this.lista.pagina() * this.lista.tamanhoPagina() < this.lista.total(),
  );
  protected readonly ultimaPagina = computed(() =>
    Math.max(1, Math.ceil(this.lista.total() / this.lista.tamanhoPagina())),
  );

  protected readonly podeMarcar = () => this.permissoes.pode('notifications:UPDATE');

  constructor() {
    this.lista.carregar();
  }

  protected tipo(item: AppNotification): string {
    return ROTULO_TIPO_AVISO[item.type] ?? item.type;
  }

  protected situacao(item: AppNotification): string {
    return ROTULO_STATUS_AVISO[item.status];
  }

  protected prioridade(item: AppNotification): string {
    return rotuloPrioridade(item.priority);
  }

  protected severidade(item: AppNotification) {
    return severidadePrioridade(item.priority);
  }

  protected pendente(item: AppNotification): boolean {
    return naoLida(item);
  }

  protected destino(item: AppNotification): string | null {
    return destinoInterno(item);
  }

  protected aplicar(valores: ValoresFiltro): void {
    this.lista.aplicarFiltros(valores);
  }

  protected alternarNaoLidas(valor: boolean): void {
    this.somenteNaoLidas.set(valor);
    this.lista.aplicarFiltros(this.lista.filtros());
  }

  protected irPara(pagina: number): void {
    this.lista.irParaPagina(pagina, this.lista.tamanhoPagina());
  }

  /** Abrir o registro é ler o aviso: marcar depois exigiria um segundo clique. */
  protected abrir(item: AppNotification, caminho: string): void {
    if (this.podeMarcar() && naoLida(item)) this.marcar(item);
    void this.router.navigateByUrl(caminho);
  }

  protected marcar(item: AppNotification): void {
    if (this.marcando()) return;
    this.marcando.set(item.id);
    this.api
      .markRead(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (atualizado) => {
          this.marcando.set(null);
          this.lista.linhas.update((linhas) =>
            linhas.map((linha) => (linha.id === atualizado.id ? atualizado : linha)),
          );
        },
        error: (falha: unknown) => {
          this.marcando.set(null);
          this.lista.erro.set(falha);
        },
      });
  }

  protected marcarTodas(): void {
    if (this.marcandoTodas()) return;
    this.marcandoTodas.set(true);
    this.api
      .markAllRead()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ updated }) => {
          this.marcandoTodas.set(false);
          this.aviso.set(`${updated} aviso(s) marcados como lidos.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.marcandoTodas.set(false);
          this.lista.erro.set(falha);
        },
      });
  }
}
