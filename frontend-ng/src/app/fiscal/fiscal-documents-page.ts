import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { FiscalDocumentsApiService } from '../core/api/fiscal-documents-api.service';
import type { FiscalDocument } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar } from '../ui/filter-bar';
import { descreverResumo, reprocessarEmSerie } from './reprocessamento';
import {
  FILTRO_ORIGEM,
  FILTRO_PENDENCIA,
  FILTRO_STATUS_NOTA,
  ROTULO_MODELO,
  ROTULO_ORIGEM,
  ROTULO_STATUS_NOTA,
  consultaNota,
  emitente,
  numeroNota,
  reprocessavel,
  severidadeNota,
} from './rotulos';

/**
 * Documentos fiscais e a situação de cada um (RF-045/RF-046/RF-049 — UI-036,
 * UI-038, UI-041).
 *
 * É a fila de trabalho do fiscal: o filtro de pendência reúne o que ainda pede
 * ação (erro, sem fornecedor, sem entrada, sem título), e o de situação isola
 * as duplicatas que esperam decisão.
 */
@Component({
  selector: 'sge-fiscal-documents-page',
  imports: [RouterLink, ButtonModule, TagModule, Alert, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Fiscal / Documentos</p>

    <div class="pagehead">
      <div>
        <h1>Documentos fiscais</h1>
        <p>Notas recebidas, a situação do processamento e o que falta em cada uma (RF-043 a RF-050).</p>
      </div>
      @if (podeImportar()) {
        <div class="pagehead__actions">
          <p-button label="Importar XML" icon="pi pi-upload" routerLink="/fiscal/importar" />
        </div>
      }
    </div>

    <sge-filter-bar
      placeholderBusca="Número, chave de acesso ou emitente"
      [valores]="lista.filtros()"
      [filtros]="filtros"
      [periodo]="true"
      (mudou)="lista.aplicarFiltros($event)"
    />

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }
    @if (falhas().length > 0) {
      <div class="espaco">
        <sge-alert tom="aviso" titulo="Documento não reprocessado" [detalhes]="falhas()" />
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
            ? 'Nenhum documento atende aos filtros.'
            : 'Nenhum documento fiscal recebido.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-nota>
          <tr>
            <td>{{ data(nota.issuedAt) }}</td>
            <td>
              {{ numero(nota) }}
              <span class="secundario">{{ modelo(nota) }}</span>
            </td>
            <td>{{ nomeEmitente(nota) }}</td>
            <td class="numero">{{ moeda(nota.totalAmount) }}</td>
            <td>{{ origem(nota) }}</td>
            <td>
              <p-tag
                [value]="situacao(nota)"
                [severity]="severidade(nota)"
                [rounded]="true"
              />
              @if (nota.status === 'DUPLICADO' && nota.duplicateOf) {
                <span class="secundario">de {{ nota.duplicateOf.number }}</span>
              }
              @if (nota.status === 'ERRO' && nota.processingError) {
                <span class="secundario erro" [title]="nota.processingError">{{
                  nota.processingError
                }}</span>
              }
            </td>
            <td>
              <span class="marcas">
                <p-tag
                  [value]="nota.generatedStock ? 'Estoque' : 'Sem estoque'"
                  [severity]="nota.generatedStock ? 'info' : 'secondary'"
                />
                <p-tag
                  [value]="nota.generatedPayable ? 'Título' : 'Sem título'"
                  [severity]="nota.generatedPayable ? 'info' : 'secondary'"
                />
              </span>
            </td>
            <td class="acoes">
              @if (podeReprocessar() && reprocessavel(nota)) {
                <p-button
                  label="Reprocessar"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  [loading]="reprocessando() === nota.id"
                  [disabled]="reprocessando() !== null"
                  (onClick)="reprocessar(nota)"
                />
              }
              <p-button
                label="Abrir"
                severity="secondary"
                [text]="true"
                size="small"
                [routerLink]="[nota.id]"
              />
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>
  `,
  styles: `
    .marcas {
      display: inline-flex;
      gap: 0.3rem;
    }
    .numero {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .secundario {
      display: block;
      font-size: 0.7rem;
      color: var(--p-text-muted-color);
    }
    .erro {
      max-width: 16rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class FiscalDocumentsPage {
  private readonly api = inject(FiscalDocumentsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas: Coluna[] = [
    { campo: 'issuedAt', cabecalho: 'Emissão', largura: '7rem' },
    { campo: 'number', cabecalho: 'Número', largura: '8rem' },
    { campo: 'issuerName', cabecalho: 'Emitente' },
    { campo: 'totalAmount', cabecalho: 'Valor', largura: '9rem' },
    { campo: 'origin', cabecalho: 'Origem', largura: '9rem' },
    { campo: 'status', cabecalho: 'Situação', largura: '12rem' },
    { campo: 'efeitos', cabecalho: 'Gerou', largura: '11rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly filtros = [FILTRO_STATUS_NOTA, FILTRO_ORIGEM, FILTRO_PENDENCIA];

  protected readonly lista = new ListState<FiscalDocument>(
    (consulta) => this.api.list(consulta),
    consultaNota,
  );

  protected readonly aviso = signal<string | null>(null);
  protected readonly falhas = signal<string[]>([]);
  /** Id do documento em reprocessamento — um por vez. */
  protected readonly reprocessando = signal<string | null>(null);

  protected readonly podeImportar = () => this.permissoes.pode('fiscal-documents:CREATE');
  protected readonly podeReprocessar = () => this.permissoes.pode('fiscal-documents:UPDATE');
  protected readonly reprocessavel = reprocessavel;

  constructor() {
    this.lista.carregar();
  }

  protected reprocessar(nota: FiscalDocument): void {
    if (this.reprocessando()) return;
    this.reprocessando.set(nota.id);
    this.aviso.set(null);
    this.falhas.set([]);
    reprocessarEmSerie(this.api, [nota])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((resumo) => {
        this.reprocessando.set(null);
        this.falhas.set(resumo.falhas);
        if (resumo.falhas.length === 0) this.aviso.set(descreverResumo(resumo));
        this.lista.carregar();
      });
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected numero(nota: FiscalDocument): string {
    return numeroNota(nota);
  }

  protected modelo(nota: FiscalDocument): string {
    return ROTULO_MODELO[nota.model] ?? nota.model;
  }

  protected nomeEmitente(nota: FiscalDocument): string {
    return emitente(nota);
  }

  protected origem(nota: FiscalDocument): string {
    return ROTULO_ORIGEM[nota.origin] ?? nota.origin;
  }

  protected situacao(nota: FiscalDocument): string {
    return ROTULO_STATUS_NOTA[nota.status];
  }

  protected severidade(nota: FiscalDocument) {
    return severidadeNota(nota.status);
  }
}
