import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ReportingApiService } from '../core/api/reporting-api.service';
import type { CashFlowDashboard } from '../core/api/types';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { subtrair } from '../financeiro/dinheiro';
import { ErrorAlert } from '../ui/error-alert';
import { ReportFilterStore, competenciaLegivel, rotuloSituacaoCaixa } from './filtros';
import { ReportFilterBar } from './report-filter-bar';

/**
 * Fluxo de caixa realizado e resultado do período (RF-108 — UI-069).
 *
 * Caixa e resultado respondem perguntas diferentes e por isso ficam em blocos
 * separados: o **caixa** é quando o dinheiro entrou e saiu; o **resultado** é a
 * competência a que a receita e a despesa pertencem. Um mês pode fechar com
 * caixa positivo e resultado negativo — e é essa diferença que a tela precisa
 * deixar visível, em vez de escondê-la num total único.
 */
@Component({
  selector: 'sge-cash-flow-report-page',
  imports: [ErrorAlert, ReportFilterBar],
  template: `
    <p class="crumb">Relatórios / Caixa e resultado</p>

    <div class="pagehead">
      <div>
        <h1>Fluxo de caixa e resultado</h1>
        <p>Movimento diário de caixa e o resultado por competência (RF-108).</p>
      </div>
    </div>

    <sge-report-filter-bar />

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (dados(); as painel) {
      <div class="kpis espaco">
        @for (total of totaisCaixa(); track total.situacao) {
          <div class="kpi">
            <span class="kpi__label">Caixa — {{ total.rotulo }}</span>
            <span class="kpi__value">{{ moeda(total.liquido) }}</span>
            <span class="kpi__detail kpi__detail--neutral">
              entradas {{ moeda(total.entradas) }} · saídas {{ moeda(total.saidas) }}
            </span>
          </div>
        }
        <div class="kpi">
          <span class="kpi__label">Receita do período</span>
          <span class="kpi__value">{{ moeda(painel.result.revenue) }}</span>
          <span class="kpi__detail kpi__detail--neutral">por competência</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Despesa do período</span>
          <span class="kpi__value">{{ moeda(painel.result.expense) }}</span>
          <span class="kpi__detail kpi__detail--neutral">por competência</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Resultado</span>
          <span class="kpi__value">{{ moeda(painel.result.net) }}</span>
          <span class="kpi__detail kpi__detail--neutral">receita menos despesa</span>
        </div>
      </div>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>Movimento diário de caixa</h2>
          <span class="table-card__count">{{ painel.cash.days.length }} dia(s)</span>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Situação</th>
                <th class="numero">Entradas</th>
                <th class="numero">Saídas</th>
                <th class="numero">Líquido</th>
                <th class="numero">Movimentos</th>
              </tr>
            </thead>
            <tbody>
              @for (dia of painel.cash.days; track dia.date + dia.status) {
                <tr>
                  <td>{{ data(dia.date) }}</td>
                  <td>{{ situacao(dia.status) }}</td>
                  <td class="numero">{{ moeda(dia.inflow) }}</td>
                  <td class="numero saida">{{ moeda(dia.outflow) }}</td>
                  <td class="numero">{{ moeda(liquido(dia.inflow, dia.outflow)) }}</td>
                  <td class="numero">{{ dia.movements }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="vazio">Nenhum movimento de caixa no período.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>Resultado por conta</h2>
          <span class="table-card__count">{{ painel.result.lines.length }} linha(s)</span>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th>Competência</th>
                <th>Conta</th>
                <th>Natureza</th>
                <th class="numero">Valor</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of painel.result.lines; track $index) {
                <tr>
                  <td>{{ competencia(linha.competence) }}</td>
                  <td>
                    <span class="codigo">{{ linha.accountCode }}</span> {{ linha.accountName }}
                  </td>
                  <td>{{ linha.type }}</td>
                  <td class="numero">{{ moeda(linha.amount) }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4" class="vazio">
                    Nenhum lançamento de resultado no período. Sem contabilização, o resultado só
                    aparece depois que as operações forem classificadas.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else if (carregando()) {
      <p class="secundario espaco">Carregando o fluxo de caixa…</p>
    }
  `,
  styles: [
    ESTILO_TABELA,
    `
      .codigo {
        color: var(--p-text-muted-color);
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class CashFlowReportPage {
  private readonly api = inject(ReportingApiService);
  private readonly store = inject(ReportFilterStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly moeda = formatCurrency;
  protected readonly data = formatDate;
  protected readonly competencia = competenciaLegivel;
  protected readonly situacao = rotuloSituacaoCaixa;

  protected readonly dados = signal<CashFlowDashboard | null>(null);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);

  /** Um cartão por situação: realizado e previsto não se somam num número só. */
  protected readonly totaisCaixa = computed(() => {
    const totais = this.dados()?.cash.totals ?? {};
    return Object.entries(totais).map(([situacao, valores]) => ({
      situacao,
      rotulo: rotuloSituacaoCaixa(situacao),
      entradas: valores.inflow,
      saidas: valores.outflow,
      liquido: subtrair(valores.inflow, valores.outflow),
    }));
  });

  constructor() {
    effect(() => {
      this.store.filtro();
      untracked(() => this.carregar());
    });
  }

  protected liquido(entradas: string, saidas: string): string {
    return subtrair(entradas, saidas);
  }

  private carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.api
      .cashFlow(this.store.consulta())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (painel) => {
          this.dados.set(painel);
          this.carregando.set(false);
        },
        error: (falha: unknown) => {
          this.dados.set(null);
          this.erro.set(falha);
          this.carregando.set(false);
        },
      });
  }
}
