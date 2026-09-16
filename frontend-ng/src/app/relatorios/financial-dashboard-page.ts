import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ReportingApiService } from '../core/api/reporting-api.service';
import type { FinancialDashboard } from '../core/api/types';
import { formatCurrency } from '../core/lib/decimal';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { ErrorAlert } from '../ui/error-alert';
import { ReportFilterStore, competenciaLegivel } from './filtros';
import { ReportFilterBar } from './report-filter-bar';

/**
 * Dashboard financeiro (RF-106 — UI-068).
 *
 * Dois números que não se somam e por isso ficam separados: **carteira aberta**
 * é o que existe a receber e a pagar agora, independente do período filtrado; o
 * **realizado** é o que efetivamente entrou e saiu dentro do recorte. Juntá-los
 * num "total" produziria um número que não responde pergunta nenhuma.
 *
 * O comparativo por competência é o mesmo realizado, mês a mês — é onde se vê a
 * tendência que o total do período esconde.
 */
@Component({
  selector: 'sge-financial-dashboard-page',
  imports: [ErrorAlert, ReportFilterBar],
  template: `
    <p class="crumb">Relatórios / Financeiro</p>

    <div class="pagehead">
      <div>
        <h1>Dashboard financeiro</h1>
        <p>Carteira aberta, realizado do período e comparativo por competência (RF-106).</p>
      </div>
    </div>

    <sge-report-filter-bar />

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (dados(); as painel) {
      <div class="kpis espaco">
        <div class="kpi">
          <span class="kpi__label">A receber em aberto</span>
          <span class="kpi__value">{{ moeda(painel.openPortfolio.receivable) }}</span>
          <span class="kpi__detail" [class.kpi__detail--bad]="temAtraso(painel, 'receber')">
            {{ moeda(painel.openPortfolio.overdueReceivable) }} vencido
          </span>
        </div>
        <div class="kpi">
          <span class="kpi__label">A pagar em aberto</span>
          <span class="kpi__value">{{ moeda(painel.openPortfolio.payable) }}</span>
          <span class="kpi__detail" [class.kpi__detail--bad]="temAtraso(painel, 'pagar')">
            {{ moeda(painel.openPortfolio.overduePayable) }} vencido
          </span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Recebido no período</span>
          <span class="kpi__value">{{ moeda(painel.realized.inflow) }}</span>
          <span class="kpi__detail kpi__detail--neutral">
            {{ painel.realized.settlements }} baixa(s)
          </span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Pago no período</span>
          <span class="kpi__value">{{ moeda(painel.realized.outflow) }}</span>
          <span class="kpi__detail kpi__detail--neutral">
            juros e multa {{ moeda(painel.realized.interest) }} · desconto
            {{ moeda(painel.realized.discount) }}
          </span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Resultado de caixa</span>
          <span class="kpi__value">{{ moeda(painel.realized.net) }}</span>
          <span class="kpi__detail" [class]="classeResultado(painel.realized.net)">
            entradas menos saídas realizadas
          </span>
        </div>
      </div>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>Realizado por competência</h2>
          <span class="table-card__count">{{ painel.byMonth.length }} competência(s)</span>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th>Competência</th>
                <th class="numero">Entradas</th>
                <th class="numero">Saídas</th>
                <th class="numero">Resultado</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of painel.byMonth; track linha.competence) {
                <tr>
                  <td>{{ competencia(linha.competence) }}</td>
                  <td class="numero">{{ moeda(linha.inflow) }}</td>
                  <td class="numero saida">{{ moeda(linha.outflow) }}</td>
                  <td class="numero">{{ moeda(linha.net) }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4" class="vazio">
                    Nenhuma baixa no período. A carteira acima continua valendo: ela é posição, não
                    recorte.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else if (carregando()) {
      <p class="secundario espaco">Carregando indicadores…</p>
    }
  `,
  styles: [ESTILO_TABELA],
})
export class FinancialDashboardPage {
  private readonly api = inject(ReportingApiService);
  private readonly store = inject(ReportFilterStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly moeda = formatCurrency;
  protected readonly competencia = competenciaLegivel;

  protected readonly dados = signal<FinancialDashboard | null>(null);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);

  constructor() {
    effect(() => {
      this.store.filtro();
      untracked(() => this.carregar());
    });
  }

  protected temAtraso(painel: FinancialDashboard, lado: 'receber' | 'pagar'): boolean {
    const valor =
      lado === 'receber'
        ? painel.openPortfolio.overdueReceivable
        : painel.openPortfolio.overduePayable;
    return Number.parseFloat(valor) > 0;
  }

  /** Só classe de cor — a comparação não entra em conta nenhuma. */
  protected classeResultado(valor: string): string {
    const numero = Number.parseFloat(valor);
    if (numero > 0) return 'kpi__detail kpi__detail--good';
    if (numero < 0) return 'kpi__detail kpi__detail--bad';
    return 'kpi__detail kpi__detail--neutral';
  }

  private carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.api
      .financial(this.store.consulta())
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
