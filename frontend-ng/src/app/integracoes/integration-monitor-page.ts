import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { IntegrationsApiService } from '../core/api/integrations-api.service';
import type {
  FailedJob,
  FailedWebhook,
  IntegrationEvent,
  IntegrationHealth,
  IntegrationStatus,
  ReprocessTarget,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { ListState } from '../core/lib/list-state';
import { formatDateTime } from '../core/lib/format';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro, type ValoresFiltro } from '../ui/filter-bar';
import {
  OPCOES_SEVERIDADE,
  ROTULO_SEVERIDADE,
  rotuloStatusJob,
  severidadeEvento,
  severidadeStatus,
  ROTULO_STATUS_INTEGRACAO,
} from './rotulos';

const COLUNAS_EVENTO: Coluna[] = [
  { campo: 'occurredAt', cabecalho: 'Quando', largura: '12rem' },
  { campo: 'integration', cabecalho: 'Integração', largura: '12rem' },
  { campo: 'severity', cabecalho: 'Severidade', largura: '8rem' },
  { campo: 'type', cabecalho: 'Tipo', largura: '9rem' },
  { campo: 'message', cabecalho: 'Mensagem' },
  { campo: 'httpStatus', cabecalho: 'HTTP', numerica: true, largura: '5rem' },
  { campo: 'durationMs', cabecalho: 'Duração', numerica: true, largura: '7rem' },
];

const FILTROS_EVENTO: DefinicaoFiltro[] = [
  {
    name: 'severity',
    label: 'Severidade',
    options: OPCOES_SEVERIDADE,
    placeholder: 'Todas as severidades',
  },
];

/**
 * Monitoramento, diário e reprocessamento (RF-128 a RF-130 — UI-075).
 *
 * A integração **degradada** é a que ainda responde mas já acumulou falha: é a
 * que se olha antes de ela se suspender sozinha ao bater o limite, e é para isso
 * que o painel existe.
 *
 * Reprocessar repete a **tentativa**, não o **efeito**: o backend só aceita job
 * em falha ou cancelado e webhook em falha, e a chave `reprocesso:<alvo>:<id>`
 * segura o duplo clique. Nada aqui refaz pagamento nem reemite documento por
 * conta própria.
 */
@Component({
  selector: 'sge-integration-monitor-page',
  imports: [ButtonModule, TagModule, Alert, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Integrações / Monitoramento</p>

    <div class="pagehead">
      <div>
        <h1>Monitoramento das integrações</h1>
        <p>Saúde, diário de eventos e o que parou em falha (RF-128 a RF-130).</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Atualizar"
          icon="pi pi-refresh"
          severity="secondary"
          [outlined]="true"
          [loading]="carregandoSaude()"
          (onClick)="atualizar()"
        />
      </div>
    </div>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }
    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (saude(); as painel) {
      <div class="kpis espaco">
        <div class="kpi">
          <span class="kpi__label">Integrações ativas</span>
          <span class="kpi__value">{{ painel.totals.active }}</span>
          <span class="kpi__detail kpi__detail--neutral">
            de {{ painel.totals.total }} cadastrada(s)
          </span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Degradadas</span>
          <span class="kpi__value">{{ painel.totals.degraded }}</span>
          <span
            class="kpi__detail"
            [class.kpi__detail--warn]="painel.totals.degraded > 0"
            [class.kpi__detail--good]="painel.totals.degraded === 0"
          >
            respondem, mas já acumulam falha
          </span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Suspensas</span>
          <span class="kpi__value">{{ painel.totals.suspended }}</span>
          <span class="kpi__detail" [class.kpi__detail--bad]="painel.totals.suspended > 0">
            nada é enviado por elas
          </span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Erros em 24h</span>
          <span class="kpi__value">{{ painel.totals.errors24h }}</span>
          <span class="kpi__detail kpi__detail--neutral">somando todas as integrações</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Fila de trabalho</span>
          <span class="kpi__value">{{ painel.queue.failed }}</span>
          <span class="kpi__detail kpi__detail--neutral">
            job(s) em falha · {{ painel.queue.pending }} pendente(s)
          </span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Webhooks</span>
          <span class="kpi__value">{{ painel.webhooks.failed }}</span>
          <span class="kpi__detail kpi__detail--neutral">
            em falha · {{ painel.webhooks.pending }} pendente(s)
          </span>
        </div>
      </div>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>Saúde por integração</h2>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Integração</th>
                <th scope="col">Situação</th>
                <th class="numero" scope="col">Falhas seguidas</th>
                <th scope="col">Último sucesso</th>
                <th scope="col">Último erro</th>
                <th class="numero" scope="col">Erros 24h</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of painel.integrations; track linha.id) {
                <tr [class.linha--degradada]="linha.degraded">
                  <td>
                    <span class="codigo">{{ linha.code }}</span> {{ linha.name }}
                  </td>
                  <td>
                    <p-tag
                      [value]="situacao(linha.status)"
                      [severity]="corSituacao(linha.status)"
                      [rounded]="true"
                    />
                    @if (linha.degraded) {
                      <p-tag value="Degradada" severity="warn" [rounded]="true" />
                    }
                  </td>
                  <td class="numero">{{ linha.failureStreak }}/{{ linha.failureThreshold }}</td>
                  <td>{{ linha.lastSuccessAt ? dataHora(linha.lastSuccessAt) : '—' }}</td>
                  <td>{{ linha.lastError ?? '—' }}</td>
                  <td class="numero">{{ linha.errors24h }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="vazio">Nenhuma integração cadastrada nesta empresa.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    @if (podeLerEventos()) {
      <div class="espaco">
        <sge-filter-bar
          [valores]="eventos.filtros()"
          [filtros]="filtrosEvento"
          placeholderBusca="Buscar na mensagem"
          (mudou)="aplicarEventos($event)"
        />
      </div>

      <div class="card espaco">
        <div class="table-card__head">
          <h2>Diário de eventos</h2>
        </div>
        <sge-data-table
          [colunas]="colunasEvento"
          [linhas]="eventos.linhas()"
          [total]="eventos.total()"
          [pagina]="eventos.pagina()"
          [tamanhoPagina]="eventos.tamanhoPagina()"
          [carregando]="eventos.carregando()"
          mensagemVazia="Nenhum evento registrado para este filtro."
          (paginaMudou)="eventos.irParaPagina($event.page, $event.pageSize)"
        >
          <ng-template #linha let-evento>
            <tr>
              <td>{{ dataHora(evento.occurredAt) }}</td>
              <td>{{ evento.integration?.code ?? '—' }}</td>
              <td>
                <p-tag
                  [value]="rotuloSeveridade(evento)"
                  [severity]="corSeveridade(evento)"
                  [rounded]="true"
                />
              </td>
              <td>{{ evento.type }}</td>
              <td>{{ evento.message }}</td>
              <td class="coluna--numerica">{{ evento.httpStatus ?? '—' }}</td>
              <td class="coluna--numerica">
                {{ evento.durationMs === null ? '—' : evento.durationMs + ' ms' }}
              </td>
            </tr>
          </ng-template>
        </sge-data-table>
      </div>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>Trabalho parado em falha</h2>
          <span class="table-card__count">
            {{ jobs().length }} job(s) · {{ webhooks().length }} webhook(s)
          </span>
        </div>

        @if (!podeReprocessar() && (jobs().length > 0 || webhooks().length > 0)) {
          <div class="espaco-interno">
            <sge-alert
              tom="info"
              titulo="Somente leitura"
              mensagem="Reenfileirar o que falhou exige a permissão de aprovar eventos de integração."
            />
          </div>
        }

        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Alvo</th>
                <th scope="col">Identificação</th>
                <th scope="col">Situação</th>
                <th class="numero" scope="col">Tentativas</th>
                <th scope="col">Erro</th>
                <th class="coluna-acoes" scope="col">Ações</th>
              </tr>
            </thead>
            <tbody>
              @for (job of jobs(); track job.id) {
                <tr>
                  <td>Job</td>
                  <td>
                    {{ job.name }}
                    <span class="secundario">{{ job.queue }}</span>
                  </td>
                  <td>{{ statusJob(job.status) }}</td>
                  <td class="numero">{{ job.attempts }}/{{ job.maxAttempts }}</td>
                  <td>{{ job.error ?? '—' }}</td>
                  <td class="coluna-acoes">
                    @if (podeReprocessar()) {
                      <p-button
                        label="Reprocessar"
                        size="small"
                        [text]="true"
                        [disabled]="!!reprocessando()"
                        [loading]="reprocessando() === job.id"
                        (onClick)="reprocessar('JOB', job.id)"
                      />
                    }
                  </td>
                </tr>
              }
              @for (webhook of webhooks(); track webhook.id) {
                <tr>
                  <td>Webhook</td>
                  <td>
                    {{ webhook.eventType }}
                    <span class="secundario">
                      recebido em {{ dataHora(webhook.receivedAt) }}
                      @if (webhook.signatureValid === false) {
                        · assinatura inválida
                      }
                    </span>
                  </td>
                  <td>{{ statusJob(webhook.status) }}</td>
                  <td class="numero">{{ webhook.attempts }}</td>
                  <td>{{ webhook.error ?? '—' }}</td>
                  <td class="coluna-acoes">
                    @if (podeReprocessar()) {
                      <p-button
                        label="Reprocessar"
                        size="small"
                        [text]="true"
                        [disabled]="!!reprocessando()"
                        [loading]="reprocessando() === webhook.id"
                        (onClick)="reprocessar('WEBHOOK', webhook.id)"
                      />
                    }
                  </td>
                </tr>
              }
              @if (jobs().length === 0 && webhooks().length === 0) {
                <tr>
                  <td colspan="6" class="vazio">
                    Nada parado em falha — a fila está em dia.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else {
      <div class="espaco">
        <sge-alert
          tom="info"
          titulo="Sem acesso ao diário"
          mensagem="Consultar eventos e o que parou em falha exige a permissão de eventos de integração."
        />
      </div>
    }
  `,
  styles: [
    ESTILO_TABELA,
    `
      .coluna-acoes {
        white-space: nowrap;
        text-align: right;
      }
      .codigo {
        color: var(--p-text-muted-color);
        font-variant-numeric: tabular-nums;
      }
      .secundario {
        display: block;
        font-size: 0.72rem;
        color: var(--p-text-muted-color);
      }
      .linha--degradada {
        background: var(--p-highlight-background, transparent);
      }
      .espaco-interno {
        padding: 0 0.875rem 0.5rem;
      }
      p-tag + p-tag {
        margin-left: 0.35rem;
      }
    `,
  ],
})
export class IntegrationMonitorPage {
  private readonly api = inject(IntegrationsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunasEvento = COLUNAS_EVENTO;
  protected readonly filtrosEvento = FILTROS_EVENTO;
  protected readonly dataHora = formatDateTime;
  protected readonly statusJob = rotuloStatusJob;

  protected readonly saude = signal<IntegrationHealth | null>(null);
  protected readonly carregandoSaude = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly reprocessando = signal<string | null>(null);

  protected readonly jobs = signal<FailedJob[]>([]);
  protected readonly webhooks = signal<FailedWebhook[]>([]);

  protected readonly eventos = new ListState<IntegrationEvent>(
    (consulta) => this.api.events(consulta),
    (filtros) => ({ q: filtros.q, severity: filtros['severity'] || undefined }),
  );

  protected readonly podeLerEventos = () => this.permissoes.pode('integration-events:READ');
  protected readonly podeReprocessar = () => this.permissoes.pode('integration-events:APPROVE');

  constructor() {
    this.atualizar();
  }

  protected situacao(status: IntegrationStatus): string {
    return ROTULO_STATUS_INTEGRACAO[status] ?? status;
  }

  protected corSituacao(status: IntegrationStatus) {
    return severidadeStatus(status);
  }

  protected rotuloSeveridade(evento: IntegrationEvent): string {
    return ROTULO_SEVERIDADE[evento.severity] ?? evento.severity;
  }

  protected corSeveridade(evento: IntegrationEvent) {
    return severidadeEvento(evento.severity);
  }

  protected aplicarEventos(valores: ValoresFiltro): void {
    this.eventos.aplicarFiltros(valores);
  }

  protected atualizar(): void {
    this.carregarSaude();
    if (this.podeLerEventos()) {
      this.eventos.carregar();
      this.carregarFalhas();
    }
  }

  /** Reenfileira a tentativa; o efeito já registrado não é refeito. */
  protected reprocessar(alvo: ReprocessTarget, id: string): void {
    if (this.reprocessando()) return;
    this.reprocessando.set(id);
    this.erro.set(null);
    this.api
      .reprocess(alvo, id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => {
          this.reprocessando.set(null);
          this.aviso.set(
            resultado.jobId
              ? `Reenfileirado na fila ${resultado.queue}.`
              : 'Já havia um reprocessamento pendente para este item — nada foi duplicado.',
          );
          this.carregarFalhas();
        },
        error: (falha: unknown) => {
          this.reprocessando.set(null);
          this.erro.set(falha);
        },
      });
  }

  private carregarSaude(): void {
    this.carregandoSaude.set(true);
    this.erro.set(null);
    this.api
      .health()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (painel) => {
          this.saude.set(painel);
          this.carregandoSaude.set(false);
        },
        error: (falha: unknown) => {
          this.saude.set(null);
          this.erro.set(falha);
          this.carregandoSaude.set(false);
        },
      });
  }

  private carregarFalhas(): void {
    this.api
      .failedJobs({ pageSize: 20 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pagina) => this.jobs.set(pagina.data),
        error: () => this.jobs.set([]),
      });

    this.api
      .failedWebhooks({ pageSize: 20 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pagina) => this.webhooks.set(pagina.data),
        error: () => this.webhooks.set([]),
      });
  }
}
