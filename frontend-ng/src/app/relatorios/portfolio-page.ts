import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ReportingApiService } from '../core/api/reporting-api.service';
import type { PortfolioDashboard } from '../core/api/types';
import { formatCurrency } from '../core/lib/decimal';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { somar } from '../financeiro/dinheiro';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { ReportFilterStore, competenciaLegivel, rotuloFaixa } from './filtros';
import { ReportFilterBar } from './report-filter-bar';

/**
 * Contas a pagar e a receber (RF-107 — UI-069).
 *
 * O recorte é por **vencimento**: "o que vence em março" é a pergunta que a
 * tela faz. O aging vem junto e sobre a **carteira inteira**, não só sobre a
 * janela — atraso de 120 dias não deixa de existir porque o filtro é do mês que
 * vem, e é exatamente o número que precisa aparecer.
 */
@Component({
  selector: 'sge-portfolio-page',
  imports: [Alert, ErrorAlert, ReportFilterBar],
  template: `
    <p class="crumb">Relatórios / Carteira</p>

    <div class="pagehead">
      <div>
        <h1>Contas a pagar e a receber</h1>
        <p>Vencimentos do período e o atraso da carteira inteira (RF-107).</p>
      </div>
    </div>

    <sge-report-filter-bar />

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (dados(); as painel) {
      <div class="kpis espaco">
        <div class="kpi">
          <span class="kpi__label">A receber no período</span>
          <span class="kpi__value">{{ moeda(painel.totals.receivable) }}</span>
          <span class="kpi__detail kpi__detail--neutral">valor atualizado com encargos</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">A pagar no período</span>
          <span class="kpi__value">{{ moeda(painel.totals.payable) }}</span>
          <span class="kpi__detail kpi__detail--neutral">valor atualizado com encargos</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Vencido a receber</span>
          <span class="kpi__value">{{ moeda(vencido().receivable) }}</span>
          <span class="kpi__detail kpi__detail--bad">carteira inteira, fora do recorte</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Vencido a pagar</span>
          <span class="kpi__value">{{ moeda(vencido().payable) }}</span>
          <span class="kpi__detail kpi__detail--bad">carteira inteira, fora do recorte</span>
        </div>
      </div>

      <div class="espaco">
        <sge-alert
          tom="info"
          titulo="O aging é da carteira inteira"
          mensagem="As faixas de atraso abaixo não respeitam o período: atraso antigo não some porque o filtro é de outro mês."
        />
      </div>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>Faixas de atraso</h2>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Faixa</th>
                <th class="numero" scope="col">Parcelas</th>
                <th class="numero" scope="col">A receber</th>
                <th class="numero" scope="col">A pagar</th>
              </tr>
            </thead>
            <tbody>
              @for (faixa of painel.aging; track faixa.band) {
                <tr>
                  <td>{{ faixaLegivel(faixa.band) }}</td>
                  <td class="numero">{{ faixa.installments }}</td>
                  <td class="numero">{{ moeda(faixa.receivable) }}</td>
                  <td class="numero saida">{{ moeda(faixa.payable) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>Vencimentos no período</h2>
          <span class="table-card__count">{{ painel.dueInPeriod.length }} linha(s)</span>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Competência</th>
                <th scope="col">Tipo</th>
                <th scope="col">Situação</th>
                <th class="numero" scope="col">Parcelas</th>
                <th class="numero" scope="col">Saldo</th>
                <th class="numero" scope="col">Encargos</th>
                <th class="numero" scope="col">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of painel.dueInPeriod; track $index) {
                <tr>
                  <td>{{ competencia(linha.competence) }}</td>
                  <td>{{ linha.type === 'RECEBER' ? 'A receber' : 'A pagar' }}</td>
                  <td>{{ faixaLegivel(linha.agingBand) }}</td>
                  <td class="numero">{{ linha.installments }}</td>
                  <td class="numero">{{ moeda(linha.balance) }}</td>
                  <td class="numero">{{ moeda(linha.charges) }}</td>
                  <td class="numero">{{ moeda(linha.updatedAmount) }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" class="vazio">Nenhum vencimento no período filtrado.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else if (carregando()) {
      <p class="secundario espaco">Carregando a carteira…</p>
    }
  `,
  styles: [ESTILO_TABELA],
})
export class PortfolioPage {
  private readonly api = inject(ReportingApiService);
  private readonly store = inject(ReportFilterStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly moeda = formatCurrency;
  protected readonly competencia = competenciaLegivel;
  protected readonly faixaLegivel = rotuloFaixa;

  protected readonly dados = signal<PortfolioDashboard | null>(null);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);

  /** Soma das faixas em atraso — "a vencer" fica de fora, que é o ponto. */
  protected readonly vencido = computed(() => {
    const aging = this.dados()?.aging ?? [];
    return aging
      .filter((faixa) => faixa.band !== 'A_VENCER')
      .reduce(
        (total, faixa) => ({
          receivable: somar(total.receivable, faixa.receivable),
          payable: somar(total.payable, faixa.payable),
        }),
        { receivable: '0.00', payable: '0.00' },
      );
  });

  constructor() {
    effect(() => {
      this.store.filtro();
      untracked(() => this.carregar());
    });
  }

  private carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.api
      .portfolio(this.store.consulta())
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

