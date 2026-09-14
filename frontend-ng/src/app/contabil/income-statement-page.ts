import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { forkJoin, of } from 'rxjs';

import { AccountingApiService } from '../core/api/accounting-api.service';
import type { IncomeStatement } from '../core/api/types';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { hoje } from '../financeiro/dinheiro';
import { ErrorAlert } from '../ui/error-alert';
import { TextField } from '../ui/text-field';
import {
  anoAnterior,
  linhasComparativas,
  problemaRecorte,
  resumoDre,
  saldoInvertido,
  type GrupoDre,
  type LinhaComparativa,
  type TotalComparativo,
} from './rotulos';

interface SecaoDre {
  grupo: GrupoDre;
  titulo: string;
  sinal: string;
  linhas: LinhaComparativa[];
  total: TotalComparativo;
}

/**
 * DRE por período com comparativo entre exercícios (RF-085 — UI-058).
 *
 * O comparativo é a mesma janela deslocada um ano para trás — duas consultas
 * ao mesmo endpoint, e a variação calculada em centavos `bigint`. Custo e
 * despesa já chegam positivos na natureza da conta; o sinal de subtração é só
 * apresentação.
 */
@Component({
  selector: 'sge-income-statement-page',
  imports: [FormsModule, ButtonModule, CheckboxModule, ErrorAlert, TextField],
  template: `
    <p class="crumb">Contábil / DRE</p>

    <div class="pagehead">
      <div>
        <h1>Demonstração do resultado</h1>
        <p>Receitas, custos e despesas do período, com comparativo ao exercício anterior (RF-085).</p>
      </div>
    </div>

    <section class="card secao">
      <div class="grade-campos">
        <sge-text-field rotulo="De" tipo="date" [obrigatorio]="true" [ngModel]="de()" (ngModelChange)="de.set($event ?? '')" />
        <sge-text-field rotulo="Até" tipo="date" [obrigatorio]="true" [ngModel]="ate()" (ngModelChange)="ate.set($event ?? '')" />
      </div>
      <label class="marcador">
        <p-checkbox [binary]="true" [ngModel]="comparar()" (ngModelChange)="comparar.set($event)" />
        Comparar com o mesmo período do exercício anterior
        @if (comparar() && !problema()) {
          <span class="secundario">({{ data(anterior().de) }} a {{ data(anterior().ate) }})</span>
        }
      </label>
      @if (problema(); as texto) {
        <p class="campo__erro">{{ texto }}</p>
      }
      <div class="acoes">
        <p-button label="Consultar" icon="pi pi-search" [loading]="carregando()" [disabled]="carregando() || !!problema()" (onClick)="consultar()" />
      </div>
    </section>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (atual(); as dre) {
      <section class="card espaco">
        <div class="tabela-rolagem">
          <table class="tabela dre">
            <thead>
              <tr>
                <th>Conta</th>
                <th class="numero">{{ data(dre.range.from) }} a {{ data(dre.range.to) }}</th>
                @if (comparativo(); as c) {
                  <th class="numero">{{ data(c.range.from) }} a {{ data(c.range.to) }}</th>
                  <th class="numero">Variação</th>
                  <th class="numero">%</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (secao of secoes(); track secao.grupo) {
                <tr class="grupo">
                  <td>{{ secao.sinal }} {{ secao.titulo }}</td>
                  <td class="numero">{{ moeda(secao.total.atual) }}</td>
                  @if (comparativo()) {
                    <td class="numero">{{ moeda(secao.total.anterior) }}</td>
                    <td class="numero">{{ moeda(secao.total.variacao) }}</td>
                    <td class="numero">{{ secao.total.percentual }}</td>
                  }
                </tr>
                @for (linha of secao.linhas; track linha.accountId) {
                  <tr>
                    <td class="recuo"><span class="codigo">{{ linha.code }}</span> {{ linha.name }}</td>
                    <td class="numero">{{ moeda(linha.atual) }}</td>
                    @if (comparativo()) {
                      <td class="numero">{{ moeda(linha.anterior) }}</td>
                      <td class="numero">{{ moeda(linha.variacao) }}</td>
                      <td class="numero">{{ linha.percentual }}</td>
                    }
                  </tr>
                } @empty {
                  <tr><td class="recuo secundario" [attr.colspan]="colunas()">Sem movimento.</td></tr>
                }
                @if (secao.grupo === 'cost') {
                  <tr class="resultado">
                    <td>= Resultado bruto</td>
                    <td class="numero" [class.saida]="negativo(resumo().grossResult.atual)">{{ moeda(resumo().grossResult.atual) }}</td>
                    @if (comparativo()) {
                      <td class="numero" [class.saida]="negativo(resumo().grossResult.anterior)">{{ moeda(resumo().grossResult.anterior) }}</td>
                      <td class="numero">{{ moeda(resumo().grossResult.variacao) }}</td>
                      <td class="numero">{{ resumo().grossResult.percentual }}</td>
                    }
                  </tr>
                }
              }
            </tbody>
            <tfoot>
              <tr class="resultado resultado--final">
                <td>= {{ negativo(resumo().netResult.atual) ? 'Prejuízo' : 'Lucro' }} líquido</td>
                <td class="numero" [class.saida]="negativo(resumo().netResult.atual)">{{ moeda(resumo().netResult.atual) }}</td>
                @if (comparativo()) {
                  <td class="numero" [class.saida]="negativo(resumo().netResult.anterior)">{{ moeda(resumo().netResult.anterior) }}</td>
                  <td class="numero">{{ moeda(resumo().netResult.variacao) }}</td>
                  <td class="numero">{{ resumo().netResult.percentual }}</td>
                }
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    }
  `,
  styles: [
    ESTILO_TABELA,
    `
      .marcador {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
        margin: 0.5rem 0;
        font-size: 0.85rem;
      }
      .grupo td {
        font-weight: 600;
        background: var(--p-content-hover-background, transparent);
      }
      .recuo {
        padding-left: 1.5rem !important;
      }
      .codigo {
        color: var(--p-text-muted-color);
        font-variant-numeric: tabular-nums;
      }
      .resultado td {
        font-weight: 600;
        border-top: 2px solid var(--p-content-border-color);
      }
      .resultado--final td {
        font-size: 0.9rem;
      }
    `,
  ],
})
export class IncomeStatementPage {
  private readonly api = inject(AccountingApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly de = signal(`${hoje().slice(0, 4)}-01-01`);
  protected readonly ate = signal(hoje());
  protected readonly comparar = signal(true);
  protected readonly atual = signal<IncomeStatement | null>(null);
  protected readonly comparativo = signal<IncomeStatement | null>(null);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);

  protected readonly problema = computed(() => problemaRecorte(this.de(), this.ate()));
  protected readonly anterior = computed(() => ({ de: anoAnterior(this.de()), ate: anoAnterior(this.ate()) }));
  protected readonly colunas = computed(() => (this.comparativo() ? 5 : 2));

  protected readonly resumo = computed(() => {
    const atual = this.atual();
    return atual ? resumoDre(atual, this.comparativo()) : resumoDre(vazia(), null);
  });

  protected readonly secoes = computed<SecaoDre[]>(() => {
    const atual = this.atual();
    if (!atual) return [];
    const anterior = this.comparativo();
    const resumo = this.resumo();
    return [
      {
        grupo: 'revenue',
        titulo: 'Receitas',
        sinal: '',
        linhas: linhasComparativas(atual.revenue.lines, anterior?.revenue.lines ?? null),
        total: resumo.revenue,
      },
      {
        grupo: 'cost',
        titulo: 'Custos',
        sinal: '(−)',
        linhas: linhasComparativas(atual.cost.lines, anterior?.cost.lines ?? null),
        total: resumo.cost,
      },
      {
        grupo: 'expense',
        titulo: 'Despesas',
        sinal: '(−)',
        linhas: linhasComparativas(atual.expense.lines, anterior?.expense.lines ?? null),
        total: resumo.expense,
      },
    ];
  });

  protected consultar(): void {
    if (this.problema()) return;
    const recorte = { from: this.de(), to: this.ate() };
    const anterior = this.anterior();

    this.carregando.set(true);
    this.erro.set(null);
    forkJoin({
      atual: this.api.incomeStatement(recorte),
      anterior: this.comparar() ? this.api.incomeStatement({ from: anterior.de, to: anterior.ate }) : of(null),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ atual, anterior: comparativo }) => {
          this.atual.set(atual);
          this.comparativo.set(comparativo);
          this.carregando.set(false);
        },
        error: (falha: unknown) => {
          this.atual.set(null);
          this.comparativo.set(null);
          this.erro.set(falha);
          this.carregando.set(false);
        },
      });
  }

  protected negativo(valor: string | null): boolean {
    return valor !== null && saldoInvertido(valor);
  }

  protected moeda(valor: string | null): string {
    return valor === null ? '—' : formatCurrency(valor);
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }
}

function vazia(): IncomeStatement {
  const grupo = { total: '0.00', lines: [] };
  return { range: { from: '', to: '' }, revenue: grupo, cost: grupo, expense: grupo, grossResult: '0.00', netResult: '0.00' };
}
