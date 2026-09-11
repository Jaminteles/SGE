import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { BankingApiService } from '../core/api/banking-api.service';
import { IntegrationsApiService } from '../core/api/integrations-api.service';
import type {
  FailedJob,
  FailedWebhook,
  IntegrationHealth,
  JobStatus,
  PaymentTransaction,
  ReprocessTarget,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDateTime } from '../core/lib/format';
import { ROTULO_METODO } from '../financeiro/rotulos';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { TextField } from '../ui/text-field';
import { ROTULO_FILA, ROTULO_JOB, ROTULO_STATUS_JOB, favorecido } from './rotulos';

/** Prefixo dos jobs de pagamento (`PAYMENT_JOBS`) — o recorte padrão do painel. */
export const PREFIXO_JOB_PAGAMENTO = 'payment.';

interface AlvoReprocesso {
  target: ReprocessTarget;
  id: string;
  descricao: string;
}

/**
 * Painel de operações assíncronas (RF-069/RF-070 — UI-047).
 *
 * Três leituras, cada uma com a permissão que o backend exige:
 *  - a fila dos últimos 7 dias (`integrations:READ`);
 *  - as ordens que falharam ou voltaram para a fila (`payments:READ`);
 *  - os jobs e webhooks parados em falha, com o reprocessamento
 *    (`integration-events:READ` / `:APPROVE`).
 *
 * Reprocessar repete a tentativa, não o efeito: o backend só aceita o que
 * falhou, e a chave `reprocesso:<alvo>:<id>` faz do duplo clique um
 * reprocessamento só. Webhook de assinatura inválida não se reprocessa.
 */
@Component({
  selector: 'sge-operations-page',
  imports: [FormsModule, RouterLink, ButtonModule, DialogModule, TagModule, Alert, ErrorAlert, TextField],
  template: `
    <p class="crumb">Bancos / Operações assíncronas</p>

    <div class="pagehead">
      <div>
        <h1>Operações assíncronas</h1>
        <p>Fila de envio, tentativas e reprocessamento do que falhou (RF-069/RF-070).</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Atualizar"
          icon="pi pi-refresh"
          severity="secondary"
          [outlined]="true"
          (onClick)="carregar()"
        />
      </div>
    </div>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    @if (podeVerFila()) {
      @if (erroSaude(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }
      @if (saude(); as painel) {
        <div class="kpis espaco">
          <div class="kpi">
            <p class="kpi__label">Jobs pendentes (7 dias)</p>
            <p class="kpi__value">{{ painel.queue.pending }}</p>
          </div>
          <div class="kpi">
            <p class="kpi__label">Jobs em falha (7 dias)</p>
            <p class="kpi__value">{{ painel.queue.failed }}</p>
          </div>
          <div class="kpi">
            <p class="kpi__label">Webhooks pendentes</p>
            <p class="kpi__value">{{ painel.webhooks.pending }}</p>
          </div>
          <div class="kpi">
            <p class="kpi__label">Webhooks em falha</p>
            <p class="kpi__value">{{ painel.webhooks.failed }}</p>
          </div>
        </div>
        @if (situacoesFila().length > 0) {
          <p class="situacoes">
            @for (item of situacoesFila(); track item.status) {
              <span>{{ item.rotulo }}: {{ item.total }}</span>
            }
          </p>
        }
      }
    }

    @if (podeVerOrdens()) {
      <section class="card secao espaco">
        <div class="secao__cabeca">
          <h2 class="secao__titulo">Ordens que falharam</h2>
          <p-button
            label="Ver todas"
            severity="secondary"
            [text]="true"
            size="small"
            routerLink="/bancos/ordens"
            [queryParams]="{ status: 'FALHA' }"
          />
        </div>
        @if (erroOrdens(); as falha) {
          <sge-error-alert [erro]="falha" />
        }
        @if (ordensFalhas().length === 0) {
          <p class="vazio">Nenhuma ordem em falha.</p>
        } @else {
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Ordem</th>
                <th scope="col" class="numero">Valor</th>
                <th scope="col">Tentativas</th>
                <th scope="col">Erro do provedor</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              @for (ordem of ordensFalhas(); track ordem.id) {
                <tr>
                  <td>
                    {{ metodo(ordem) }} · {{ nomeFavorecido(ordem) }}
                    <span class="secundario">{{ dataHora(ordem.updatedAt) }}</span>
                  </td>
                  <td class="numero">{{ moeda(ordem.amount) }}</td>
                  <td>{{ ordem.attempts }} de {{ ordem.maxAttempts }}</td>
                  <td>{{ ordem.errorMessage ?? ordem.errorCode ?? '—' }}</td>
                  <td class="acoes">
                    <p-button
                      label="Abrir"
                      severity="secondary"
                      [text]="true"
                      size="small"
                      [routerLink]="['/bancos/ordens', ordem.id]"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <section class="card secao espaco">
        <h2 class="secao__titulo">Ordens aguardando envio</h2>
        @if (ordensNaFila().length === 0) {
          <p class="vazio">Nenhuma ordem na fila.</p>
        } @else {
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Ordem</th>
                <th scope="col" class="numero">Valor</th>
                <th scope="col">Tentativas</th>
                <th scope="col">Última falha</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              @for (ordem of ordensNaFila(); track ordem.id) {
                <tr>
                  <td>
                    {{ metodo(ordem) }} · {{ nomeFavorecido(ordem) }}
                    <span class="secundario">Criada em {{ dataHora(ordem.createdAt) }}</span>
                  </td>
                  <td class="numero">{{ moeda(ordem.amount) }}</td>
                  <td>
                    {{ ordem.attempts }} de {{ ordem.maxAttempts }}
                    @if (ordem.attempts > 0) {
                      <p-tag value="Em nova tentativa" severity="warn" [rounded]="true" />
                    }
                  </td>
                  <td>{{ ordem.errorMessage ?? '—' }}</td>
                  <td class="acoes">
                    <p-button
                      label="Abrir"
                      severity="secondary"
                      [text]="true"
                      size="small"
                      [routerLink]="['/bancos/ordens', ordem.id]"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }

    @if (podeVerFalhas()) {
      <section class="card secao espaco">
        <div class="secao__cabeca">
          <h2 class="secao__titulo">Jobs parados em falha</h2>
          <label class="marcador">
            <input
              type="checkbox"
              [ngModel]="somentePagamentos()"
              (ngModelChange)="alternarRecorte($event)"
            />
            Somente jobs de pagamento
          </label>
        </div>
        @if (erroJobs(); as falha) {
          <sge-error-alert [erro]="falha" />
        }
        @if (jobs().length === 0) {
          <p class="vazio">Nenhum job em falha.</p>
        } @else {
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Fila</th>
                <th scope="col">Situação</th>
                <th scope="col">Tentativas</th>
                <th scope="col">Erro</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              @for (job of jobs(); track job.id) {
                <tr>
                  <td>
                    {{ nomeJob(job.name) }}
                    <span class="secundario">{{ job.lastErrorAt ? dataHora(job.lastErrorAt) : dataHora(job.createdAt) }}</span>
                  </td>
                  <td>{{ fila(job.queue) }}</td>
                  <td>
                    <p-tag [value]="statusJob(job.status)" severity="danger" [rounded]="true" />
                  </td>
                  <td>{{ job.attempts }} de {{ job.maxAttempts }}</td>
                  <td>{{ job.error ?? '—' }}</td>
                  <td class="acoes">
                    @if (podeReprocessar()) {
                      <p-button
                        label="Reprocessar"
                        severity="secondary"
                        [text]="true"
                        size="small"
                        (onClick)="abrirReprocesso('JOB', job.id, nomeJob(job.name))"
                      />
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <section class="card secao espaco">
        <h2 class="secao__titulo">Webhooks parados em falha</h2>
        @if (erroWebhooks(); as falha) {
          <sge-error-alert [erro]="falha" />
        }
        @if (webhooks().length === 0) {
          <p class="vazio">Nenhum webhook em falha.</p>
        } @else {
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Evento</th>
                <th scope="col">Recebido em</th>
                <th scope="col">Tentativas</th>
                <th scope="col">Erro</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              @for (evento of webhooks(); track evento.id) {
                <tr>
                  <td>
                    {{ evento.eventType }}
                    @if (evento.externalId) {
                      <span class="secundario">{{ evento.externalId }}</span>
                    }
                  </td>
                  <td>{{ dataHora(evento.receivedAt) }}</td>
                  <td>{{ evento.attempts }}</td>
                  <td>{{ evento.error ?? '—' }}</td>
                  <td class="acoes">
                    @if (evento.signatureValid === false) {
                      <p-tag value="Assinatura inválida" severity="danger" [rounded]="true" />
                    } @else if (podeReprocessar()) {
                      <p-button
                        label="Reprocessar"
                        severity="secondary"
                        [text]="true"
                        size="small"
                        (onClick)="abrirReprocesso('WEBHOOK', evento.id, evento.eventType)"
                      />
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }

    <p-dialog
      [visible]="!!alvo()"
      (visibleChange)="!$event && alvo.set(null)"
      [modal]="true"
      [style]="{ width: '30rem' }"
      header="Reprocessar"
    >
      @if (erroReprocesso(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <p class="secundario">
        {{ alvo()?.descricao }} volta para a fila como uma nova tentativa. O registro original,
        com as tentativas e o erro, é preservado.
      </p>
      <sge-text-field
        rotulo="Motivo"
        dica="Opcional — vai para o diário da integração e para a auditoria"
        [ngModel]="motivo()"
        (ngModelChange)="motivo.set($event)"
      />
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          [disabled]="reprocessando()"
          (onClick)="alvo.set(null)"
        />
        <p-button
          label="Reprocessar"
          icon="pi pi-replay"
          [loading]="reprocessando()"
          [disabled]="reprocessando()"
          (onClick)="reprocessar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .secao__cabeca {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .situacoes {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem 1rem;
      margin: 0.5rem 0 0;
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
    }
    .tabela {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .tabela th,
    .tabela td {
      padding: 0.5rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
      vertical-align: top;
    }
    .tabela th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .tabela .numero {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .vazio {
      margin: 0;
      font-size: 0.85rem;
      color: var(--p-text-muted-color);
    }
    .marcador {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
    }
  `,
})
export class OperationsPage {
  private readonly banking = inject(BankingApiService);
  private readonly integracoes = inject(IntegrationsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly podeVerFila = () => this.permissoes.pode('integrations:READ');
  protected readonly podeVerOrdens = () => this.permissoes.pode('payments:READ');
  protected readonly podeVerFalhas = () => this.permissoes.pode('integration-events:READ');
  protected readonly podeReprocessar = () => this.permissoes.pode('integration-events:APPROVE');

  protected readonly saude = signal<IntegrationHealth | null>(null);
  protected readonly erroSaude = signal<unknown>(null);
  protected readonly ordensFalhas = signal<PaymentTransaction[]>([]);
  protected readonly ordensNaFila = signal<PaymentTransaction[]>([]);
  protected readonly erroOrdens = signal<unknown>(null);
  protected readonly jobs = signal<FailedJob[]>([]);
  protected readonly erroJobs = signal<unknown>(null);
  protected readonly webhooks = signal<FailedWebhook[]>([]);
  protected readonly erroWebhooks = signal<unknown>(null);
  protected readonly somentePagamentos = signal(true);

  protected readonly alvo = signal<AlvoReprocesso | null>(null);
  protected readonly motivo = signal('');
  protected readonly reprocessando = signal(false);
  protected readonly erroReprocesso = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly situacoesFila = computed(() => {
    const porSituacao = this.saude()?.queue.byStatus ?? {};
    return Object.entries(porSituacao).map(([status, total]) => ({
      status,
      total,
      rotulo: ROTULO_STATUS_JOB[status as JobStatus] ?? status,
    }));
  });

  constructor() {
    this.carregar();
  }

  protected carregar(): void {
    if (this.podeVerFila()) {
      this.integracoes
        .health()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (painel) => {
            this.saude.set(painel);
            this.erroSaude.set(null);
          },
          error: (falha: unknown) => this.erroSaude.set(falha),
        });
    }
    if (this.podeVerOrdens()) {
      this.carregarOrdens();
    }
    if (this.podeVerFalhas()) {
      this.carregarJobs();
      this.carregarWebhooks();
    }
  }

  protected alternarRecorte(valor: boolean): void {
    this.somentePagamentos.set(valor);
    this.carregarJobs();
  }

  protected abrirReprocesso(target: ReprocessTarget, id: string, descricao: string): void {
    this.motivo.set('');
    this.erroReprocesso.set(null);
    this.alvo.set({ target, id, descricao });
  }

  protected reprocessar(): void {
    const alvo = this.alvo();
    if (!alvo || this.reprocessando()) return;
    this.reprocessando.set(true);
    this.erroReprocesso.set(null);
    this.aviso.set(null);

    this.integracoes
      .reprocess(alvo.target, alvo.id, this.motivo().trim() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => {
          this.reprocessando.set(false);
          this.alvo.set(null);
          this.aviso.set(
            resultado.jobId
              ? `${alvo.descricao} reenfileirado como uma nova tentativa.`
              : `${alvo.descricao} já tinha um reprocessamento pendente — nada foi duplicado.`,
          );
          this.carregar();
        },
        error: (falha: unknown) => {
          this.reprocessando.set(false);
          this.erroReprocesso.set(falha);
        },
      });
  }

  protected metodo(ordem: PaymentTransaction): string {
    return ROTULO_METODO[ordem.method] ?? ordem.method;
  }

  protected nomeFavorecido(ordem: PaymentTransaction): string {
    return favorecido(ordem);
  }

  protected nomeJob(nome: string): string {
    return ROTULO_JOB[nome] ?? nome;
  }

  protected fila(nome: string): string {
    return ROTULO_FILA[nome] ?? nome;
  }

  protected statusJob(status: JobStatus): string {
    return ROTULO_STATUS_JOB[status] ?? status;
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }

  private carregarOrdens(): void {
    this.erroOrdens.set(null);
    this.banking
      .listPayments({ status: 'FALHA', pageSize: 20 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => this.ordensFalhas.set(resultado.data),
        error: (falha: unknown) => this.erroOrdens.set(falha),
      });
    this.banking
      .listPayments({ status: 'ENFILEIRADA', pageSize: 20 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => this.ordensNaFila.set(resultado.data),
        error: (falha: unknown) => this.erroOrdens.set(falha),
      });
  }

  private carregarJobs(): void {
    this.erroJobs.set(null);
    this.integracoes
      .failedJobs({ pageSize: 50, q: this.somentePagamentos() ? PREFIXO_JOB_PAGAMENTO : undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => this.jobs.set(resultado.data),
        error: (falha: unknown) => this.erroJobs.set(falha),
      });
  }

  private carregarWebhooks(): void {
    this.erroWebhooks.set(null);
    this.integracoes
      .failedWebhooks({ pageSize: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => this.webhooks.set(resultado.data),
        error: (falha: unknown) => this.erroWebhooks.set(falha),
      });
  }
}
