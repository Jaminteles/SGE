import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { FinanceApiService } from '../core/api/finance-api.service';
import type { DelinquencySummary, PortfolioInstallment } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ListState, type Consulta } from '../core/lib/list-state';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type ValoresFiltro } from '../ui/filter-bar';
import { paraCentavos } from './dinheiro';
import { FILTRO_TIPO, ROTULO_FAIXA, ROTULO_TIPO } from './rotulos';

/** Filtros compartilhados entre o aging e a lista de parcelas vencidas. */
function consultaCarteira(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    type: filtros['type'] || undefined,
    dueFrom: filtros['from'] || undefined,
    dueTo: filtros['to'] || undefined,
  };
}

/**
 * Painel de inadimplência e aging da carteira (RF-058 — UI-028).
 *
 * Tudo aqui é leitura do servidor no instante da consulta: "quanto está
 * vencido" muda a cada dia sem que nada seja lançado, e dias de atraso e
 * encargos são regra do modelo (bd/09). A tela só distribui os números.
 * O histórico de cada título (baixas e estornos) está no detalhe dele.
 */
@Component({
  selector: 'sge-delinquency-page',
  imports: [RouterLink, ButtonModule, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Financeiro / Inadimplência</p>

    <div class="pagehead">
      <div>
        <h1>Inadimplência e aging</h1>
        <p>
          Parcelas vencidas por faixa de atraso e por parceiro, com encargos atualizados (RF-058).
        </p>
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar"
      [valores]="lista.filtros()"
      [filtros]="[filtroTipo]"
      [periodo]="true"
      (mudou)="aplicar($event)"
    />

    @if (erroResumo(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (resumo(); as dados) {
      <div class="kpis">
        <div class="kpi">
          <p class="kpi__label">Total vencido</p>
          <p class="kpi__value">{{ moeda(dados.totals.updatedBalance) }}</p>
          <p class="kpi__detail">
            saldo {{ moeda(dados.totals.balance) }} · {{ dados.totals.installments }} parcela(s)
          </p>
        </div>
        @for (faixa of dados.aging; track faixa.bucket) {
          <div class="kpi">
            <p class="kpi__label">{{ rotuloFaixa(faixa.bucket) }}</p>
            <p class="kpi__value">{{ moeda(faixa.updatedBalance) }}</p>
            <p class="kpi__detail" [class.kpi__detail--bad]="faixa.installments > 0">
              {{ faixa.installments }} parcela(s) · {{ participacao(faixa.updatedBalance) }}
            </p>
          </div>
        }
      </div>

      <section class="card secao espaco">
        <h2 class="secao__titulo">Distribuição por faixa de atraso</h2>
        <div class="barra" role="img" [attr.aria-label]="descricaoBarra()">
          @for (faixa of dados.aging; track faixa.bucket) {
            @if (larguraFaixa(faixa.updatedBalance) > 0) {
              <span
                class="barra__segmento"
                [class]="'barra__segmento barra__segmento--' + faixa.bucket"
                [style.width.%]="larguraFaixa(faixa.updatedBalance)"
                [title]="rotuloFaixa(faixa.bucket) + ': ' + moeda(faixa.updatedBalance)"
              ></span>
            }
          }
        </div>
        <ul class="legenda">
          @for (faixa of dados.aging; track faixa.bucket) {
            <li>
              <span [class]="'ponto barra__segmento--' + faixa.bucket"></span>
              {{ rotuloFaixa(faixa.bucket) }}
            </li>
          }
        </ul>
      </section>

      <section class="card table-card espaco">
        <div class="table-card__head">
          <h2 class="secao__titulo">Por parceiro (50 maiores)</h2>
        </div>
        @if (dados.partners.length === 0) {
          <p class="nota">Nenhuma parcela vencida no recorte.</p>
        } @else {
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">Parceiro</th>
                <th scope="col" class="numero">Parcelas</th>
                <th scope="col" class="numero">Saldo</th>
                <th scope="col" class="numero">Atualizado</th>
                <th scope="col" class="numero">Maior atraso</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of dados.partners; track $index) {
                <tr>
                  <td>{{ linha.partner?.legalName ?? 'Sem parceiro' }}</td>
                  <td class="numero">{{ linha.installments }}</td>
                  <td class="numero">{{ moeda(linha.balance) }}</td>
                  <td class="numero">{{ moeda(linha.updatedBalance) }}</td>
                  <td class="numero">{{ linha.maxDaysOverdue }} dia(s)</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }

    <section class="card table-card espaco">
      <div class="table-card__head">
        <h2 class="secao__titulo">Parcelas vencidas</h2>
      </div>
      @if (lista.erro(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <sge-data-table
        [colunas]="colunas"
        [linhas]="lista.linhas()"
        [total]="lista.total()"
        [pagina]="lista.pagina()"
        [tamanhoPagina]="lista.tamanhoPagina()"
        [carregando]="lista.carregando()"
        mensagemVazia="Nenhuma parcela vencida."
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-parcela>
          <tr>
            <td>
              {{ parcela.number }} · {{ parcela.installmentNumber }}/{{ parcela.totalInstallments }}
            </td>
            <td>{{ tipo(parcela) }}</td>
            <td>{{ parcela.partner?.legalName ?? '—' }}</td>
            <td>{{ data(parcela.dueDate) }}</td>
            <td class="numero atraso">{{ parcela.daysOverdue }}</td>
            <td class="numero">{{ moeda(parcela.balance) }}</td>
            <td class="numero">{{ moeda(parcela.lateCharges) }}</td>
            <td class="numero">{{ moeda(parcela.updatedBalance) }}</td>
            <td>{{ rotuloFaixa(parcela.agingBucket) }}</td>
            <td class="acoes">
              @if (podeVerTitulo()) {
                <p-button
                  label="Título"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  [routerLink]="['/financeiro/titulos', parcela.entryId]"
                />
              }
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>
  `,
  styles: `
    .grade {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .grade th,
    .grade td {
      padding: 0.5rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .grade th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .numero {
      text-align: right !important;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .atraso {
      color: var(--p-red-500, #dc2626);
      font-weight: 600;
    }
    .barra {
      display: flex;
      height: 1.25rem;
      border-radius: 0.375rem;
      overflow: hidden;
      background: var(--p-content-border-color);
    }
    .barra__segmento {
      display: block;
      height: 100%;
    }
    .barra__segmento--ATE_30 {
      background: #facc15;
    }
    .barra__segmento--DE_31_A_60 {
      background: #fb923c;
    }
    .barra__segmento--DE_61_A_90 {
      background: #ef4444;
    }
    .barra__segmento--ACIMA_DE_90 {
      background: #991b1b;
    }
    .legenda {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      list-style: none;
      padding: 0;
      margin: 0.5rem 0 0;
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
    }
    .ponto {
      display: inline-block;
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
      margin-right: 0.25rem;
    }
  `,
})
export class DelinquencyPage {
  private readonly api = inject(FinanceApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly filtroTipo = FILTRO_TIPO;

  protected readonly colunas: Coluna[] = [
    { campo: 'number', cabecalho: 'Título · parcela', largura: '11rem' },
    { campo: 'type', cabecalho: 'Carteira', largura: '7rem' },
    { campo: 'partner', cabecalho: 'Parceiro' },
    { campo: 'dueDate', cabecalho: 'Vencimento', largura: '8rem' },
    { campo: 'daysOverdue', cabecalho: 'Dias', largura: '5rem' },
    { campo: 'balance', cabecalho: 'Saldo', largura: '8rem' },
    { campo: 'lateCharges', cabecalho: 'Encargos', largura: '8rem' },
    { campo: 'updatedBalance', cabecalho: 'Atualizado', largura: '8rem' },
    { campo: 'agingBucket', cabecalho: 'Faixa', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '6rem' },
  ];

  protected readonly lista = new ListState<PortfolioInstallment>(
    (consulta) => this.api.portfolio({ ...consulta, overdueOnly: true }),
    consultaCarteira,
  );

  protected readonly resumo = signal<DelinquencySummary | null>(null);
  protected readonly erroResumo = signal<unknown>(null);

  protected readonly podeVerTitulo = () => this.permissoes.pode('financial-entries:READ');

  private readonly totalCentavos = computed(() =>
    paraCentavos(this.resumo()?.totals.updatedBalance),
  );

  protected readonly descricaoBarra = computed(() =>
    (this.resumo()?.aging ?? [])
      .map((f) => `${this.rotuloFaixa(f.bucket)} ${this.participacao(f.updatedBalance)}`)
      .join(', '),
  );

  constructor() {
    this.carregarResumo();
    // A lista de parcelas usa `financial-entries:READ` (rota `installments`).
    if (this.podeVerTitulo()) this.lista.carregar();
  }

  protected aplicar(filtros: ValoresFiltro): void {
    if (this.podeVerTitulo()) this.lista.aplicarFiltros(filtros);
    else this.lista.filtros.set(filtros);
    this.carregarResumo();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected tipo(parcela: PortfolioInstallment): string {
    return ROTULO_TIPO[parcela.type] ?? parcela.type;
  }

  protected rotuloFaixa(faixa: string): string {
    return ROTULO_FAIXA[faixa] ?? faixa;
  }

  /**
   * Largura do segmento em % — é só geometria do gráfico, por isso pode virar
   * `number`; a razão é tirada em `bigint` (décimos de ponto percentual).
   */
  protected larguraFaixa(valor: string): number {
    const total = this.totalCentavos();
    if (total <= 0n) return 0;
    return Number((paraCentavos(valor) * 1000n) / total) / 10;
  }

  protected participacao(valor: string): string {
    return `${this.larguraFaixa(valor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  }

  private carregarResumo(): void {
    this.erroResumo.set(null);
    const consulta = consultaCarteira(this.lista.filtros());
    delete consulta['q'];
    this.api
      .delinquency(consulta)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dados) => this.resumo.set(dados),
        error: (falha: unknown) => {
          this.resumo.set(null);
          this.erroResumo.set(falha);
        },
      });
  }
}
