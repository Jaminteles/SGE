import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import {
  CashFlowApiService,
  type CashFlowProjectionQuery,
} from '../core/api/cash-flow-api.service';
import type {
  CashAlertEvaluationSummary,
  CashFlowGranularity,
  CashFlowProjection,
  CashFlowSummary,
  CashSituation,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { adicionarDias, dataValida, ehNegativo, hoje } from './dinheiro';
import { OPCOES_GRANULARIDADE, ROTULO_SITUACAO_CAIXA } from './rotulos';

interface Filtros {
  from: string;
  to: string;
  granularity: CashFlowGranularity;
  scenarioId: string;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/**
 * Fluxo de caixa: consolidado, projeção e alertas (RF-101 a RF-105 — UI-029).
 *
 * O consolidado separa realizado, vencido e previsto (RF-103); a projeção
 * acumula o saldo período a período (RF-102) e pode ser lida sob um cenário
 * (RF-104) — nesse caso a janela e o caixa de partida são os do cenário. O
 * alerta de insuficiência (RF-105) é avaliado na hora: um "alerta disparado"
 * gravado ontem pode ser falso hoje.
 */
@Component({
  selector: 'sge-cash-flow-page',
  imports: [FormsModule, ButtonModule, TagModule, Alert, ErrorAlert, SelectField, TextField],
  template: `
    <p class="crumb">Financeiro / Fluxo de caixa</p>

    <div class="pagehead">
      <div>
        <h1>Fluxo de caixa</h1>
        <p>Previsto, realizado e vencido, com projeção por período e cenários (RF-101 a RF-105).</p>
      </div>
    </div>

    <section class="card secao">
      <form class="grade-campos filtros" (ngSubmit)="consultar()">
        <sge-text-field
          rotulo="De"
          name="from"
          tipo="date"
          [disabled]="filtros().scenarioId !== ''"
          [ngModel]="filtros().from"
          (ngModelChange)="mudar('from', $event)"
        />
        <sge-text-field
          rotulo="Até"
          name="to"
          tipo="date"
          [disabled]="filtros().scenarioId !== ''"
          [ngModel]="filtros().to"
          (ngModelChange)="mudar('to', $event)"
        />
        <sge-select-field
          rotulo="Agrupar por"
          name="granularity"
          [opcoes]="opcoesGranularidade"
          [ngModel]="filtros().granularity"
          (ngModelChange)="mudar('granularity', $event ?? 'MES')"
        />
        @if (podeVerCenarios()) {
          <sge-select-field
            rotulo="Cenário"
            name="scenarioId"
            placeholder="Sem cenário (carteira real)"
            dica="Com cenário, valem a janela e o caixa inicial dele"
            [opcoes]="opcoesCenario()"
            [ngModel]="filtros().scenarioId || null"
            (ngModelChange)="mudar('scenarioId', $event ?? '')"
          />
        }
      </form>
      <div class="rodape">
        <p-button
          label="Atualizar"
          icon="pi pi-refresh"
          [loading]="carregando()"
          (onClick)="consultar()"
        />
      </div>
    </section>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (alertas(); as avaliacao) {
      @if (avaliacao.breached > 0) {
        <div class="espaco">
          <sge-alert
            tom="erro"
            [titulo]="avaliacao.breached + ' alerta(s) de insuficiência de caixa'"
            [detalhes]="rupturas()"
          />
        </div>
      }
    }

    <div class="kpis espaco">
      <div class="kpi">
        <p class="kpi__label">Saldo de caixa hoje</p>
        <p class="kpi__value">{{ saldoAtual() === null ? '—' : moeda(saldoAtual()!) }}</p>
        <p class="kpi__detail">contas bancárias ativas</p>
      </div>
      @for (linha of resumo()?.bySituation ?? []; track linha.situation) {
        <div class="kpi">
          <p class="kpi__label">{{ rotuloSituacao(linha.situation) }}</p>
          <p class="kpi__value" [class.negativo]="negativo(linha.net)">{{ moeda(linha.net) }}</p>
          <p class="kpi__detail">
            entradas {{ moeda(linha.inflow) }} · saídas {{ moeda(linha.outflow) }}
          </p>
        </div>
      }
    </div>

    @if (projecao(); as serie) {
      <section class="card table-card espaco">
        <div class="table-card__head">
          <h2 class="secao__titulo">
            Projeção {{ data(serie.period.from) }} a {{ data(serie.period.to) }}
            @if (serie.scenario) {
              · cenário {{ serie.scenario.name }}
            }
          </h2>
          <span class="table-card__count">
            caixa inicial {{ moeda(serie.openingBalance) }} · final
            <strong [class.negativo]="negativo(serie.closingBalance)">{{
              moeda(serie.closingBalance)
            }}</strong>
          </span>
        </div>
        @if (serie.periods.length === 0) {
          <p class="nota">Nenhum movimento no período.</p>
        } @else {
          <div class="rolagem">
            <table class="grade">
              <thead>
                <tr>
                  <th scope="col" rowspan="2">Período</th>
                  <th scope="colgroup" colspan="4" class="grupo">Entradas</th>
                  <th scope="colgroup" colspan="4" class="grupo">Saídas</th>
                  <th scope="col" rowspan="2" class="numero">Líquido</th>
                  <th scope="col" rowspan="2" class="numero">Saldo acumulado</th>
                </tr>
                <tr>
                  <th scope="col" class="numero">Realizado</th>
                  <th scope="col" class="numero">Previsto</th>
                  <th scope="col" class="numero">Vencido</th>
                  <th scope="col" class="numero">Total</th>
                  <th scope="col" class="numero">Realizado</th>
                  <th scope="col" class="numero">Previsto</th>
                  <th scope="col" class="numero">Vencido</th>
                  <th scope="col" class="numero">Total</th>
                </tr>
              </thead>
              <tbody>
                @for (periodo of serie.periods; track periodo.periodStart) {
                  <tr>
                    <td>{{ rotuloPeriodo(periodo.periodStart, serie.granularity) }}</td>
                    <td class="numero">{{ moeda(periodo.inflow.realized) }}</td>
                    <td class="numero">{{ moeda(periodo.inflow.expected) }}</td>
                    <td class="numero">{{ moeda(periodo.inflow.overdue) }}</td>
                    <td class="numero forte">{{ moeda(periodo.inflow.total) }}</td>
                    <td class="numero">{{ moeda(periodo.outflow.realized) }}</td>
                    <td class="numero">{{ moeda(periodo.outflow.expected) }}</td>
                    <td class="numero">{{ moeda(periodo.outflow.overdue) }}</td>
                    <td class="numero forte">{{ moeda(periodo.outflow.total) }}</td>
                    <td class="numero" [class.negativo]="negativo(periodo.net)">
                      {{ moeda(periodo.net) }}
                    </td>
                    <td class="numero forte" [class.negativo]="negativo(periodo.closingBalance)">
                      {{ moeda(periodo.closingBalance) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="nota">
            Vencido é o previsto que passou da data sem baixa; premissas de cenário ajustam só o que
            ainda não foi realizado (RF-103/RF-104).
          </p>
        }
      </section>
    }

    @if (resumo(); as consolidado) {
      @if (consolidado.byCategory.length > 0) {
        <section class="card table-card espaco">
          <div class="table-card__head">
            <h2 class="secao__titulo">Por categoria (RF-101)</h2>
          </div>
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">Categoria</th>
                <th scope="col" class="numero">Entradas</th>
                <th scope="col" class="numero">Saídas</th>
                <th scope="col" class="numero">Líquido</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of consolidado.byCategory; track $index) {
                <tr>
                  <td>
                    {{
                      linha.category
                        ? linha.category.code + ' — ' + linha.category.name
                        : 'Sem categoria'
                    }}
                  </td>
                  <td class="numero">{{ moeda(linha.inflow) }}</td>
                  <td class="numero">{{ moeda(linha.outflow) }}</td>
                  <td class="numero" [class.negativo]="negativo(linha.net)">
                    {{ moeda(linha.net) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>
      }
    }

    @if (alertas(); as avaliacao) {
      <section class="card table-card espaco">
        <div class="table-card__head">
          <h2 class="secao__titulo">Alertas de insuficiência (RF-105)</h2>
          <span class="table-card__count">avaliados em {{ data(avaliacao.evaluatedAt) }}</span>
        </div>
        @if (avaliacao.alerts.length === 0) {
          <p class="nota">Nenhum alerta ativo configurado.</p>
        } @else {
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">Alerta</th>
                <th scope="col" class="numero">Saldo mínimo</th>
                <th scope="col">Horizonte</th>
                <th scope="col" class="numero">Menor saldo</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              @for (item of avaliacao.alerts; track item.alert.id) {
                <tr>
                  <td>{{ item.alert.name }}</td>
                  <td class="numero">{{ moeda(item.alert.minimumBalance) }}</td>
                  <td>{{ item.alert.daysAhead }} dia(s)</td>
                  <td class="numero" [class.negativo]="negativo(item.lowestBalance)">
                    {{ moeda(item.lowestBalance) }}
                    @if (item.lowestBalanceDate) {
                      <span class="secundario">em {{ data(item.lowestBalanceDate) }}</span>
                    }
                  </td>
                  <td>
                    <p-tag
                      [value]="item.breached ? 'Ruptura em ' + data(item.breachDate) : 'Coberto'"
                      [severity]="item.breached ? 'danger' : 'success'"
                      [rounded]="true"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }
  `,
  styles: `
    .filtros {
      align-items: end;
    }
    .rodape {
      display: flex;
      justify-content: flex-end;
      margin-top: 0.75rem;
    }
    .rolagem {
      overflow-x: auto;
    }
    .grade {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .grade th,
    .grade td {
      padding: 0.45rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .grade th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .grade .grupo {
      text-align: center;
    }
    .grade .numero {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .forte {
      font-weight: 600;
    }
    .negativo {
      color: var(--p-red-500, #dc2626);
    }
    .secundario {
      display: block;
      font-size: 0.7rem;
      color: var(--p-text-muted-color);
    }
  `,
})
export class CashFlowPage {
  private readonly api = inject(CashFlowApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly opcoesGranularidade = OPCOES_GRANULARIDADE;

  protected readonly filtros = signal<Filtros>({
    from: hoje(),
    to: adicionarDias(hoje(), 90),
    granularity: 'MES',
    scenarioId: this.rota.snapshot.queryParamMap.get('cenario') ?? '',
  });

  protected readonly resumo = signal<CashFlowSummary | null>(null);
  protected readonly projecao = signal<CashFlowProjection | null>(null);
  protected readonly saldoAtual = signal<string | null>(null);
  protected readonly alertas = signal<CashAlertEvaluationSummary | null>(null);
  protected readonly opcoesCenario = signal<OpcaoFiltro[]>([]);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);

  protected readonly podeVerCenarios = () => this.permissoes.pode('cash-flow-scenarios:READ');

  protected readonly rupturas = computed(() =>
    (this.alertas()?.alerts ?? [])
      .filter((a) => a.breached)
      .map(
        (a) =>
          `${a.alert.name}: saldo abaixo de ${this.moeda(a.alert.minimumBalance)} em ${this.data(a.breachDate)} (menor saldo ${this.moeda(a.lowestBalance)}).`,
      ),
  );

  constructor() {
    this.consultar();
    this.carregarApoio();
  }

  protected mudar<K extends keyof Filtros>(campo: K, valor: Filtros[K]): void {
    this.filtros.update((atual) => ({ ...atual, [campo]: valor }));
    if (campo === 'scenarioId' || campo === 'granularity') this.consultar();
  }

  protected consultar(): void {
    const filtros = this.filtros();
    const periodo =
      filtros.scenarioId === '' && dataValida(filtros.from) && dataValida(filtros.to)
        ? { from: filtros.from, to: filtros.to }
        : {};

    this.carregando.set(true);
    this.erro.set(null);

    this.api
      .summary(periodo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dados) => this.resumo.set(dados),
        error: (falha: unknown) => {
          this.resumo.set(null);
          this.erro.set(falha);
        },
      });

    const consulta: CashFlowProjectionQuery = {
      ...periodo,
      granularity: filtros.granularity,
      scenarioId: filtros.scenarioId || undefined,
    };
    this.api
      .projection(consulta)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dados) => {
          this.projecao.set(dados);
          this.carregando.set(false);
        },
        error: (falha: unknown) => {
          this.projecao.set(null);
          this.erro.set(falha);
          this.carregando.set(false);
        },
      });
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected data(valor: string | null): string {
    return formatDate(valor);
  }

  protected negativo(valor: string): boolean {
    return ehNegativo(valor);
  }

  protected rotuloSituacao(situacao: CashSituation): string {
    return ROTULO_SITUACAO_CAIXA[situacao] ?? situacao;
  }

  protected rotuloPeriodo(inicio: string, grao: CashFlowGranularity): string {
    if (grao === 'MES') {
      const [ano, mes] = inicio.split('-');
      return `${MESES[Number.parseInt(mes, 10) - 1] ?? mes}/${ano}`;
    }
    return grao === 'SEMANA' ? `semana de ${formatDate(inicio)}` : formatDate(inicio);
  }

  private carregarApoio(): void {
    this.api
      .balance()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => this.saldoAtual.set(r.balance),
        error: () => this.saldoAtual.set(null),
      });

    if (this.podeVerCenarios()) {
      this.api
        .listScenarios({ pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesCenario.set(
              r.data.map((c) => ({
                value: c.id,
                label: c.isBaseline ? `${c.name} (base)` : c.name,
              })),
            ),
          error: () => this.opcoesCenario.set([]),
        });
    }

    if (this.permissoes.pode('cash-alerts:READ')) {
      this.api
        .evaluateAlerts()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) => this.alertas.set(r),
          error: () => this.alertas.set(null),
        });
    }
  }
}
