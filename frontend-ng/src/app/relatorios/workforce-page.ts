import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ReportingApiService } from '../core/api/reporting-api.service';
import type { WorkforceDashboard } from '../core/api/types';
import { formatCurrency } from '../core/lib/decimal';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { subtrair } from '../financeiro/dinheiro';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { ReportFilterStore, competenciaLegivel } from './filtros';
import { ReportFilterBar } from './report-filter-bar';

/**
 * Funcionários e centros de custo (RF-110 — UI-071).
 *
 * O quadro é **posição**: quem está na empresa hoje, não quem esteve no período
 * filtrado. Admissões e desligamentos, esses sim, são do recorte — é a leitura
 * que responde "o quadro cresceu ou encolheu no período".
 *
 * Provisionado e realizado por centro de custo ficam lado a lado com a
 * diferença explícita: é o número que se olha antes de aprovar o próximo gasto.
 */
@Component({
  selector: 'sge-workforce-page',
  imports: [Alert, ErrorAlert, ReportFilterBar],
  template: `
    <p class="crumb">Relatórios / Pessoal</p>

    <div class="pagehead">
      <div>
        <h1>Funcionários e centros de custo</h1>
        <p>Quadro atual, movimentação do período e custo por centro (RF-110).</p>
      </div>
    </div>

    <sge-report-filter-bar />

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (dados(); as painel) {
      <div class="kpis espaco">
        <div class="kpi">
          <span class="kpi__label">Funcionários ativos</span>
          <span class="kpi__value">{{ painel.totals.activeEmployees }}</span>
          <span class="kpi__detail kpi__detail--neutral">posição de hoje</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Salário base ativo</span>
          <span class="kpi__value">{{ moeda(painel.totals.activeBaseSalary) }}</span>
          <span class="kpi__detail kpi__detail--neutral">soma dos salários do quadro</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Admissões no período</span>
          <span class="kpi__value">{{ painel.totals.hires }}</span>
          <span class="kpi__detail kpi__detail--good">entradas no recorte</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Desligamentos no período</span>
          <span class="kpi__value">{{ painel.totals.terminations }}</span>
          <span class="kpi__detail kpi__detail--warn">saídas no recorte</span>
        </div>
      </div>

      <div class="espaco">
        <sge-alert
          tom="info"
          titulo="O quadro é posição de hoje"
          mensagem="Admissões e desligamentos respeitam o período; a contagem de ativos, não — ela é o quadro atual."
        />
      </div>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>Quadro por departamento</h2>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Departamento</th>
                <th scope="col">Situação</th>
                <th class="numero" scope="col">Funcionários</th>
                <th class="numero" scope="col">Com salário</th>
                <th class="numero" scope="col">Salário base</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of painel.headcount; track $index) {
                <tr>
                  <td>{{ linha.departmentName ?? 'Sem departamento' }}</td>
                  <td>{{ linha.status }}</td>
                  <td class="numero">{{ linha.employees }}</td>
                  <td class="numero">{{ linha.employeesWithSalary }}</td>
                  <td class="numero">{{ moeda(linha.baseSalaryTotal) }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="vazio">Nenhum funcionário cadastrado nesta empresa.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>Movimentação</h2>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Competência</th>
                <th class="numero" scope="col">Admissões</th>
                <th class="numero" scope="col">Desligamentos</th>
                <th class="numero" scope="col">Saldo</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of painel.movement; track $index) {
                <tr>
                  <td>{{ competencia(linha.competence) }}</td>
                  <td class="numero">{{ linha.hires }}</td>
                  <td class="numero">{{ linha.terminations }}</td>
                  <td class="numero">{{ linha.hires - linha.terminations }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4" class="vazio">Nenhuma movimentação no período.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>Centros de custo</h2>
          <span class="table-card__count">{{ painel.costCenters.length }} linha(s)</span>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Competência</th>
                <th scope="col">Centro de custo</th>
                <th scope="col">Tipo</th>
                <th class="numero" scope="col">Provisionado</th>
                <th class="numero" scope="col">Realizado</th>
                <th class="numero" scope="col">Diferença</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of painel.costCenters; track $index) {
                <tr>
                  <td>{{ competencia(linha.competence) }}</td>
                  <td>{{ linha.costCenterName }}</td>
                  <td>{{ linha.type }}</td>
                  <td class="numero">{{ moeda(linha.budgetedAmount) }}</td>
                  <td class="numero">{{ moeda(linha.realizedAmount) }}</td>
                  <td class="numero">
                    {{ moeda(diferenca(linha.budgetedAmount, linha.realizedAmount)) }}
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="vazio">Nenhum custo apropriado no período.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else if (carregando()) {
      <p class="secundario espaco">Carregando indicadores de pessoal…</p>
    }
  `,
  styles: [ESTILO_TABELA],
})
export class WorkforcePage {
  private readonly api = inject(ReportingApiService);
  private readonly store = inject(ReportFilterStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly moeda = formatCurrency;
  protected readonly competencia = competenciaLegivel;

  protected readonly dados = signal<WorkforceDashboard | null>(null);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);

  constructor() {
    effect(() => {
      this.store.filtro();
      untracked(() => this.carregar());
    });
  }

  /** Provisionado menos realizado: positivo é folga, negativo é estouro. */
  protected diferenca(provisionado: string, realizado: string): string {
    return subtrair(provisionado, realizado);
  }

  private carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.api
      .workforce(this.store.consulta())
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
