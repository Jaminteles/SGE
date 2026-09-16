import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TagModule } from 'primeng/tag';

import { ReportingApiService } from '../core/api/reporting-api.service';
import type { PurchasingDashboard, SupplierIndicator } from '../core/api/types';
import { formatCurrency, formatDecimal } from '../core/lib/decimal';
import { CASAS_UNITARIAS } from '../compras/calculo';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { ReportFilterStore, competenciaLegivel } from './filtros';
import { ReportFilterBar } from './report-filter-bar';

/**
 * Compras, fornecedores e estoque (RF-109 — UI-070).
 *
 * O estoque é **posição**, não período: é o saldo de agora, e por isso não
 * acompanha o recorte de datas como as compras acompanham. Misturar as duas
 * leituras na mesma tabela faria o usuário ler "estoque de março", que não
 * existe neste indicador.
 *
 * O desempenho do fornecedor é o que sobra da pergunta "com quem vale continuar
 * comprando": prazo médio, pior atraso e recebimentos divergentes.
 */
@Component({
  selector: 'sge-purchasing-page',
  imports: [TagModule, Alert, ErrorAlert, ReportFilterBar],
  template: `
    <p class="crumb">Relatórios / Compras e estoque</p>

    <div class="pagehead">
      <div>
        <h1>Compras, estoque e fornecedores</h1>
        <p>Pedidos do período, desempenho de fornecedor e posição de estoque (RF-109).</p>
      </div>
    </div>

    <sge-report-filter-bar />

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (dados(); as painel) {
      <div class="kpis espaco">
        <div class="kpi">
          <span class="kpi__label">Comprado no período</span>
          <span class="kpi__value">{{ moeda(painel.totals.purchased) }}</span>
          <span class="kpi__detail kpi__detail--neutral">
            {{ painel.orders.length }} competência(s) com pedido
          </span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Estoque (posição)</span>
          <span class="kpi__value">{{ moeda(painel.totals.stockValue) }}</span>
          <span class="kpi__detail kpi__detail--neutral">saldo de agora, fora do recorte</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Itens abaixo do mínimo</span>
          <span class="kpi__value">{{ painel.totals.itemsBelowMinimum }}</span>
          <span
            class="kpi__detail"
            [class.kpi__detail--bad]="painel.totals.itemsBelowMinimum > 0"
            [class.kpi__detail--good]="painel.totals.itemsBelowMinimum === 0"
          >
            {{ painel.totals.itemsBelowMinimum > 0 ? 'reposição pendente' : 'nada a repor' }}
          </span>
        </div>
      </div>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>Pedidos por competência</h2>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Competência</th>
                <th scope="col">Situação</th>
                <th class="numero" scope="col">Pedidos</th>
                <th class="numero" scope="col">Produtos</th>
                <th class="numero" scope="col">Frete</th>
                <th class="numero" scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of painel.orders; track linha.competence + linha.status) {
                <tr>
                  <td>{{ competencia(linha.competence) }}</td>
                  <td>{{ linha.status }}</td>
                  <td class="numero">{{ linha.orders }}</td>
                  <td class="numero">{{ moeda(linha.productsAmount) }}</td>
                  <td class="numero">{{ moeda(linha.freightAmount) }}</td>
                  <td class="numero">{{ moeda(linha.totalAmount) }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="vazio">Nenhum pedido de compra no período.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>Fornecedores</h2>
          <span class="table-card__count">{{ painel.suppliers.length }} fornecedor(es)</span>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Fornecedor</th>
                <th class="numero" scope="col">Pedidos</th>
                <th class="numero" scope="col">Total</th>
                <th class="numero" scope="col">Recebimentos</th>
                <th class="numero" scope="col">Divergentes</th>
                <th class="numero" scope="col">Prazo médio</th>
                <th class="numero" scope="col">Pior atraso</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of painel.suppliers; track linha.partnerId) {
                <tr>
                  <td>{{ linha.partnerName }}</td>
                  <td class="numero">{{ linha.orders }}</td>
                  <td class="numero">{{ moeda(linha.totalAmount) }}</td>
                  <td class="numero">{{ linha.receipts }}</td>
                  <td class="numero">
                    @if (linha.divergentReceipts > 0) {
                      <p-tag
                        [value]="linha.divergentReceipts.toString()"
                        severity="warn"
                        [rounded]="true"
                      />
                    } @else {
                      0
                    }
                  </td>
                  <td class="numero">{{ dias(linha.averageLeadTimeDays) }}</td>
                  <td class="numero">{{ atraso(linha) }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" class="vazio">Nenhuma compra de fornecedor no período.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>Estoque por local</h2>
        </div>
        <div class="espaco-interno">
          <sge-alert
            tom="info"
            titulo="Posição de agora"
            mensagem="O saldo de estoque não respeita o período filtrado: ele é o que existe hoje no local."
          />
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Local</th>
                <th class="numero" scope="col">Itens</th>
                <th class="numero" scope="col">Quantidade</th>
                <th class="numero" scope="col">Valor</th>
                <th class="numero" scope="col">Abaixo do mínimo</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of painel.stock; track $index) {
                <tr>
                  <td>{{ linha.locationName }}</td>
                  <td class="numero">{{ linha.items }}</td>
                  <td class="numero">{{ quantidade(linha.quantity) }}</td>
                  <td class="numero">{{ moeda(linha.totalAmount) }}</td>
                  <td class="numero">{{ linha.itemsBelowMinimum }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="vazio">Nenhum saldo de estoque nos locais da empresa.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else if (carregando()) {
      <p class="secundario espaco">Carregando indicadores de compras…</p>
    }
  `,
  styles: [
    ESTILO_TABELA,
    `
      .espaco-interno {
        padding: 0 0.875rem 0.5rem;
      }
    `,
  ],
})
export class PurchasingPage {
  private readonly api = inject(ReportingApiService);
  private readonly store = inject(ReportFilterStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly moeda = formatCurrency;
  protected readonly competencia = competenciaLegivel;

  protected readonly dados = signal<PurchasingDashboard | null>(null);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);

  constructor() {
    effect(() => {
      this.store.filtro();
      untracked(() => this.carregar());
    });
  }

  protected quantidade(valor: string): string {
    return formatDecimal(valor, CASAS_UNITARIAS);
  }

  /** Média de dias vem como decimal do banco; sem compra, vem nula. */
  protected dias(valor: string | null): string {
    return valor === null ? '—' : `${formatDecimal(valor, 1)} d`;
  }

  protected atraso(linha: SupplierIndicator): string {
    return linha.worstDeliveryDelayDays === null ? '—' : `${linha.worstDeliveryDelayDays} d`;
  }

  private carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.api
      .purchasing(this.store.consulta())
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
