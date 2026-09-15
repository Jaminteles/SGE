import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { FiscalApiService } from '../core/api/fiscal-api.service';
import { IntegrationsApiService } from '../core/api/integrations-api.service';
import type { FiscalEvent, IntegrationHealth } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { ListState } from '../core/lib/list-state';
import { formatDateTime } from '../core/lib/format';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro, type ValoresFiltro } from '../ui/filter-bar';
import {
  OPCOES_STATUS_EVENTO,
  OPCOES_TIPO_EVENTO,
  ROTULO_STATUS_EVENTO,
  ROTULO_TIPO_EVENTO,
  severidadeEvento,
  transmissivel,
} from './tributos';

const COLUNAS: Coluna[] = [
  { campo: 'occurredAt', cabecalho: 'Ocorrido em', largura: '12rem' },
  { campo: 'type', cabecalho: 'Evento', largura: '14rem' },
  { campo: 'status', cabecalho: 'Situação', largura: '9rem' },
  { campo: 'protocol', cabecalho: 'Protocolo', largura: '12rem' },
  { campo: 'justification', cabecalho: 'Justificativa' },
  { campo: 'acoes', cabecalho: '', largura: '11rem' },
];

const FILTROS: DefinicaoFiltro[] = [
  {
    name: 'status',
    label: 'Situação',
    options: OPCOES_STATUS_EVENTO,
    placeholder: 'Todas as situações',
  },
  { name: 'type', label: 'Evento', options: OPCOES_TIPO_EVENTO, placeholder: 'Todos os eventos' },
];

/**
 * Acompanhamento das integrações fiscais (RF-094 — UI-064).
 *
 * O que interessa aqui é o que **não chegou ao fisco**: evento registrado que
 * ninguém transmitiu e evento transmitido sem resposta. Autorizado e rejeitado
 * são terminais — resposta do fisco não se revisa por retentativa nossa, e por
 * isso não há botão neles.
 *
 * A fila é a mesma do resto do sistema: o painel de saúde aparece para quem
 * pode consultá-la, porque transmissão parada quase sempre é fila parada.
 */
@Component({
  selector: 'sge-fiscal-monitor-page',
  imports: [RouterLink, ButtonModule, TagModule, Alert, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Fiscal / Transmissões</p>

    <div class="pagehead">
      <div>
        <h1>Transmissões fiscais</h1>
        <p>Eventos enviados ao fisco e o que ainda não obteve resposta (RF-094).</p>
      </div>
    </div>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }
    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (pendentes() > 0) {
      <div class="espaco">
        <sge-alert
          tom="aviso"
          [titulo]="pendentes() + ' evento(s) sem resposta do fisco nesta página'"
          mensagem="Registrado é o que ninguém transmitiu; transmitido sem protocolo é o que o provedor ainda não devolveu."
        />
      </div>
    }

    @if (saude(); as painel) {
      <div class="kpis espaco">
        <div class="kpi">
          <span class="kpi__label">Fila de trabalho</span>
          <span class="kpi__value">{{ painel.queue.failed }}</span>
          <span class="kpi__detail kpi__detail--neutral">
            job(s) em falha · {{ painel.queue.pending }} pendente(s)
          </span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Integrações</span>
          <span class="kpi__value">{{ painel.totals.active }}</span>
          <span class="kpi__detail kpi__detail--neutral">
            ativa(s) · {{ painel.totals.suspended }} suspensa(s) ·
            {{ painel.totals.errors24h }} erro(s) em 24h
          </span>
        </div>
      </div>
    }

    <div class="espaco">
      <sge-filter-bar
        [valores]="lista.filtros()"
        [filtros]="filtros"
        [busca]="false"
        (mudou)="aplicar($event)"
      />
    </div>

    <div class="card espaco">
      <sge-data-table
        [colunas]="colunas"
        [linhas]="lista.linhas()"
        [total]="lista.total()"
        [pagina]="lista.pagina()"
        [tamanhoPagina]="lista.tamanhoPagina()"
        [carregando]="lista.carregando()"
        [mensagemVazia]="
          lista.temFiltro()
            ? 'Nenhum evento para este filtro.'
            : 'Nenhum evento fiscal registrado nesta empresa.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-evento>
          <tr>
            <td>{{ dataHora(evento.occurredAt) }}</td>
            <td>{{ rotuloTipo(evento) }} #{{ evento.sequence }}</td>
            <td>
              <p-tag
                [value]="rotuloStatus(evento)"
                [severity]="severidade(evento)"
                [rounded]="true"
              />
            </td>
            <td class="codigo">{{ evento.protocol ?? '—' }}</td>
            <td>{{ evento.justification ?? '—' }}</td>
            <td class="coluna-acoes">
              @if (evento.documentId) {
                <a class="link" [routerLink]="['/fiscal/documentos', evento.documentId]">
                  Ver documento
                </a>
              }
              @if (podeTransmitir() && pendente(evento)) {
                <p-button
                  label="Transmitir"
                  size="small"
                  [text]="true"
                  [disabled]="!!agindo()"
                  [loading]="agindo() === evento.id"
                  (onClick)="transmitir(evento)"
                />
              }
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </div>
  `,
  styles: [
    ESTILO_TABELA,
    `
      .coluna-acoes {
        white-space: nowrap;
        text-align: right;
      }
      .codigo {
        font-variant-numeric: tabular-nums;
      }
      .link {
        margin-right: 0.5rem;
        font-size: 0.8rem;
        color: var(--p-primary-color);
      }
    `,
  ],
})
export class FiscalMonitorPage {
  private readonly api = inject(FiscalApiService);
  private readonly integracoes = inject(IntegrationsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas = COLUNAS;
  protected readonly filtros = FILTROS;
  protected readonly dataHora = formatDateTime;

  protected readonly lista = new ListState<FiscalEvent>(
    (consulta) => this.api.listEvents(consulta),
    (filtros) => ({
      status: filtros['status'] || undefined,
      type: filtros['type'] || undefined,
    }),
  );

  protected readonly aviso = signal<string | null>(null);
  protected readonly agindo = signal<string | null>(null);
  protected readonly saude = signal<IntegrationHealth | null>(null);

  protected readonly pendentes = computed(
    () => this.lista.linhas().filter((evento) => transmissivel(evento.status)).length,
  );

  protected readonly podeTransmitir = () => this.permissoes.pode('fiscal-events:APPROVE');

  constructor() {
    this.lista.carregar();
    if (this.permissoes.pode('integrations:READ')) {
      this.integracoes
        .health()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (painel) => this.saude.set(painel),
          error: () => this.saude.set(null),
        });
    }
  }

  protected rotuloTipo(evento: FiscalEvent): string {
    return ROTULO_TIPO_EVENTO[evento.type];
  }

  protected rotuloStatus(evento: FiscalEvent): string {
    return ROTULO_STATUS_EVENTO[evento.status];
  }

  protected severidade(evento: FiscalEvent) {
    return severidadeEvento(evento.status);
  }

  protected pendente(evento: FiscalEvent): boolean {
    return transmissivel(evento.status);
  }

  protected aplicar(valores: ValoresFiltro): void {
    this.lista.aplicarFiltros(valores);
  }

  protected transmitir(evento: FiscalEvent): void {
    if (this.agindo()) return;
    this.agindo.set(evento.id);
    this.api
      .transmitEvent(evento.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.agindo.set(null);
          this.aviso.set('Transmissão enfileirada. A resposta do fisco aparece nesta lista.');
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.agindo.set(null);
          this.lista.erro.set(falha);
        },
      });
  }
}
