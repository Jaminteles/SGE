import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { forkJoin, map } from 'rxjs';

import {
  FiscalDocumentsApiService,
  type FiscalDocumentQuery,
} from '../core/api/fiscal-documents-api.service';
import type { FiscalDocument } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatDateTime } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type ValoresFiltro } from '../ui/filter-bar';
import { descreverResumo, reprocessarEmSerie } from './reprocessamento';
import {
  FILTRO_PENDENCIA,
  FILTRO_STATUS_NOTA,
  ROTULO_STATUS_NOTA,
  consultaNota,
  emitente,
  numeroNota,
  reprocessavel,
  severidadeNota,
} from './rotulos';

const ORIGEM_COLETA = 'COLETA_AUTOMATICA';

interface Indicadores {
  total: number;
  comErro: number;
  duplicados: number;
  pendentes: number;
}

/** A barra desta tela não tem origem: ela é sempre a coleta automática. */
function consultaColeta(filtros: ValoresFiltro) {
  return { ...consultaNota(filtros), origin: ORIGEM_COLETA };
}

/**
 * Acompanhamento da coleta automática e reprocessamento (RF-049/RF-050 — UI-041).
 *
 * O coletor entrega lotes pela API (`POST /fiscal-documents/collect`); o que
 * chega fica aqui, com a referência na origem e o instante da coleta. Os
 * indicadores vêm do `total` de consultas de uma linha — a contagem é do
 * servidor, nunca do que cabe numa página.
 */
@Component({
  selector: 'sge-fiscal-collection-page',
  imports: [RouterLink, ButtonModule, TagModule, Alert, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Fiscal / Coleta automática</p>

    <div class="pagehead">
      <div>
        <h1>Coleta automática</h1>
        <p>Documentos entregues pela integração, a situação de cada um e o reprocessamento (RF-049/RF-050).</p>
      </div>
      @if (podeReprocessar()) {
        <div class="pagehead__actions">
          <p-button
            [label]="'Reprocessar com erro nesta página (' + reprocessaveisNaPagina().length + ')'"
            icon="pi pi-refresh"
            [loading]="reprocessando()"
            [disabled]="reprocessando() || reprocessaveisNaPagina().length === 0"
            (onClick)="reprocessarPagina()"
          />
        </div>
      }
    </div>

    <div class="kpis">
      <div class="kpi">
        <p class="kpi__label">Coletados</p>
        <p class="kpi__value">{{ indicadores()?.total ?? '—' }}</p>
      </div>
      <div class="kpi">
        <p class="kpi__label">Com erro</p>
        <p class="kpi__value">{{ indicadores()?.comErro ?? '—' }}</p>
      </div>
      <div class="kpi">
        <p class="kpi__label">Duplicados</p>
        <p class="kpi__value">{{ indicadores()?.duplicados ?? '—' }}</p>
      </div>
      <div class="kpi">
        <p class="kpi__label">Exigem ação</p>
        <p class="kpi__value">{{ indicadores()?.pendentes ?? '—' }}</p>
      </div>
    </div>

    <div class="espaco">
      <sge-filter-bar
        placeholderBusca="Número, chave de acesso ou emitente"
        [valores]="lista.filtros()"
        [filtros]="filtros"
        [periodo]="true"
        (mudou)="lista.aplicarFiltros($event)"
      />
    </div>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }
    @if (falhas().length > 0) {
      <div class="espaco">
        <sge-alert tom="aviso" titulo="Documentos não reprocessados" [detalhes]="falhas()" />
      </div>
    }
    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    <section class="card table-card espaco">
      <sge-data-table
        [colunas]="colunas"
        [linhas]="lista.linhas()"
        [total]="lista.total()"
        [pagina]="lista.pagina()"
        [tamanhoPagina]="lista.tamanhoPagina()"
        [carregando]="lista.carregando()"
        [mensagemVazia]="
          lista.temFiltro()
            ? 'Nenhum documento coletado atende aos filtros.'
            : 'A integração ainda não entregou documentos.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-nota>
          <tr>
            <td>{{ dataHora(nota.collectedAt ?? nota.createdAt) }}</td>
            <td>{{ nota.originReference ?? '—' }}</td>
            <td>{{ numero(nota) }}</td>
            <td>{{ nomeEmitente(nota) }}</td>
            <td>
              <p-tag [value]="situacao(nota)" [severity]="severidade(nota)" [rounded]="true" />
            </td>
            <td class="numero">{{ nota.attempts }}</td>
            <td class="erro" [title]="nota.processingError ?? ''">
              {{ nota.processingError ?? '—' }}
            </td>
            <td class="acoes">
              <p-button
                label="Abrir"
                severity="secondary"
                [text]="true"
                size="small"
                [routerLink]="['/fiscal/documentos', nota.id]"
              />
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>
  `,
  styles: `
    .numero {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .erro {
      max-width: 20rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--p-text-muted-color);
    }
  `,
})
export class FiscalCollectionPage {
  private readonly api = inject(FiscalDocumentsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas: Coluna[] = [
    { campo: 'collectedAt', cabecalho: 'Coletado em', largura: '10rem' },
    { campo: 'originReference', cabecalho: 'Referência na origem', largura: '12rem' },
    { campo: 'number', cabecalho: 'Número', largura: '8rem' },
    { campo: 'issuerName', cabecalho: 'Emitente' },
    { campo: 'status', cabecalho: 'Situação', largura: '9rem' },
    { campo: 'attempts', cabecalho: 'Tentativas', largura: '6rem' },
    { campo: 'processingError', cabecalho: 'Último erro' },
    { campo: 'acoes', cabecalho: '', largura: '6rem' },
  ];

  protected readonly filtros = [FILTRO_STATUS_NOTA, FILTRO_PENDENCIA];

  protected readonly lista = new ListState<FiscalDocument>(
    (consulta) => this.api.list(consulta),
    consultaColeta,
  );

  protected readonly indicadores = signal<Indicadores | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly falhas = signal<string[]>([]);
  protected readonly reprocessando = signal(false);

  protected readonly podeReprocessar = () => this.permissoes.pode('fiscal-documents:UPDATE');

  protected readonly reprocessaveisNaPagina = computed(() =>
    this.lista.linhas().filter((nota) => reprocessavel(nota)),
  );

  constructor() {
    this.lista.carregar();
    this.carregarIndicadores();
  }

  protected reprocessarPagina(): void {
    const alvo = this.reprocessaveisNaPagina();
    if (this.reprocessando() || alvo.length === 0) return;
    this.reprocessando.set(true);
    this.aviso.set(null);
    this.falhas.set([]);
    reprocessarEmSerie(this.api, alvo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((resumo) => {
        this.reprocessando.set(false);
        this.falhas.set(resumo.falhas);
        this.aviso.set(descreverResumo(resumo));
        this.lista.carregar();
        this.carregarIndicadores();
      });
  }

  private carregarIndicadores(): void {
    const contar = (filtro: FiscalDocumentQuery) =>
      this.api
        .list({ ...filtro, origin: ORIGEM_COLETA, page: 1, pageSize: 1 })
        .pipe(map((r) => r.total));

    forkJoin({
      total: contar({}),
      comErro: contar({ status: 'ERRO' }),
      duplicados: contar({ status: 'DUPLICADO' }),
      pendentes: contar({ pendingOnly: true }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (valores) => this.indicadores.set(valores),
        error: () => this.indicadores.set(null),
      });
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }

  protected numero(nota: FiscalDocument): string {
    return numeroNota(nota);
  }

  protected nomeEmitente(nota: FiscalDocument): string {
    return emitente(nota);
  }

  protected situacao(nota: FiscalDocument): string {
    return ROTULO_STATUS_NOTA[nota.status];
  }

  protected severidade(nota: FiscalDocument) {
    return severidadeNota(nota.status);
  }
}
