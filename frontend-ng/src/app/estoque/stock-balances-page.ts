import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { StockApiService } from '../core/api/stock-api.service';
import type { StockAlert, StockBalance, StockValuation } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency, formatDecimal } from '../core/lib/decimal';
import { ListState } from '../core/lib/list-state';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type OpcaoFiltro, type ValoresFiltro } from '../ui/filter-bar';
import type { Consulta } from '../core/lib/list-state';

/** Traduz busca e local para `QueryStockBalanceDto`. */
function consultaSaldo(filtros: ValoresFiltro): Consulta {
  return {
    q: filtros.q,
    locationId: filtros['locationId'] || undefined,
    // "Somente com saldo" é o recorte útil da tela: item zerado em todos os
    // locais não é posição de estoque, é cadastro.
    onlyWithBalance: filtros['comSaldo'] === '' ? undefined : filtros['comSaldo'] === 'true',
  };
}

const FILTRO_COM_SALDO = {
  name: 'comSaldo',
  label: 'Saldo',
  placeholder: 'Saldo',
  options: [
    { value: 'true', label: 'Somente com saldo' },
    { value: 'false', label: 'Incluir zerados' },
  ],
};

/**
 * Saldos por local (RF-031 — UI-021).
 *
 * O saldo e o custo médio são projetados pelo banco a partir do razão de
 * movimentos: esta tela é leitura. Corrigir um saldo é lançar um ajuste em
 * Movimentações (RF-032) ou fechar um inventário (RF-033) — nunca editar o
 * número aqui.
 *
 * A faixa de indicadores usa `stock/valuation` e `stock/alerts`, dois recursos
 * que já existem. A valorização exige `stock-valuation:READ`, permissão à parte
 * do saldo: é o valor do patrimônio em estoque.
 */
@Component({
  selector: 'sge-stock-balances-page',
  imports: [ButtonModule, TagModule, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Estoque / Saldos</p>

    <div class="pagehead">
      <div>
        <h1>Saldos por local</h1>
        <p>Locais de estoque por filial, saldo e custo médio ponderado (RF-031).</p>
      </div>
    </div>

    <div class="kpis">
      @if (valorizacao(); as total) {
        <div class="kpi">
          <p class="kpi__label">Valor total em estoque</p>
          <p class="kpi__value">{{ moeda(total.totalValue) }}</p>
          <p class="kpi__detail">{{ total.locations.length }} local(is)</p>
        </div>
      }
      <div class="kpi">
        <p class="kpi__label">Itens no ou abaixo do mínimo</p>
        <p class="kpi__value">{{ alertas().length }}</p>
        <p class="kpi__detail" [class.kpi__detail--warn]="alertas().length > 0">
          {{ alertas().length > 0 ? 'repor' : 'nenhum' }}
        </p>
      </div>
      <div class="kpi">
        <p class="kpi__label">Itens com saldo</p>
        <p class="kpi__value">{{ lista.total() }}</p>
        <p class="kpi__detail">na consulta atual</p>
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar item por código ou descrição"
      [valores]="lista.filtros()"
      [filtros]="[filtroLocal(), FILTRO_COM_SALDO]"
      (mudou)="lista.aplicarFiltros($event)"
    />

    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    <section class="card table-card espaco">
      <sge-data-table
        [colunas]="colunas"
        [linhas]="lista.linhas()"
        [total]="lista.total()"
        [pagina]="lista.pagina()"
        [tamanhoPagina]="lista.tamanhoPagina()"
        [carregando]="lista.carregando()"
        mensagemVazia="Nenhum item com saldo nesses filtros."
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-saldo>
          <tr>
            <td>{{ saldo.product?.code ?? '—' }}</td>
            <td>{{ saldo.product?.description ?? '—' }}</td>
            <td>{{ saldo.location?.name ?? '—' }}</td>
            <td class="coluna--numerica">{{ quantidade(saldo.quantity) }}</td>
            <td class="coluna--numerica">{{ moeda(saldo.averageCost) }}</td>
            <td class="coluna--numerica">{{ moeda(saldo.totalValue) }}</td>
            <td class="coluna--numerica">{{ quantidade(saldo.product?.minStock ?? '0') }}</td>
            <td>
              @if (abaixoDoMinimo(saldo)) {
                <p-tag value="Repor" severity="warn" [rounded]="true" />
              } @else {
                <p-tag value="Normal" severity="success" [rounded]="true" />
              }
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>
  `,
})
export class StockBalancesPage {
  private readonly api = inject(StockApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_COM_SALDO = FILTRO_COM_SALDO;

  protected readonly colunas: Coluna[] = [
    { campo: 'code', cabecalho: 'Código', largura: '9rem' },
    { campo: 'description', cabecalho: 'Descrição' },
    { campo: 'location', cabecalho: 'Local', largura: '12rem' },
    { campo: 'quantity', cabecalho: 'Saldo', numerica: true, largura: '9rem' },
    { campo: 'averageCost', cabecalho: 'Custo médio', numerica: true, largura: '10rem' },
    { campo: 'totalValue', cabecalho: 'Valor total', numerica: true, largura: '11rem' },
    { campo: 'minStock', cabecalho: 'Mínimo', numerica: true, largura: '8rem' },
    { campo: 'situacao', cabecalho: '', largura: '7rem' },
  ];

  protected readonly lista = new ListState<StockBalance>(
    (consulta) => this.api.listBalances(consulta),
    consultaSaldo,
  );

  protected readonly valorizacao = signal<StockValuation | null>(null);
  protected readonly alertas = signal<StockAlert[]>([]);
  protected readonly opcoesLocal = signal<OpcaoFiltro[]>([]);

  /** Itens do alerta, por `produto:local` — evita varrer a lista por linha. */
  private readonly chavesEmAlerta = computed(
    () => new Set(this.alertas().map((a) => `${a.productId}:${a.locationId}`)),
  );

  constructor() {
    this.lista.carregar();
    this.carregarAlertas();
    this.carregarValorizacao();
    this.carregarLocais();
  }

  protected filtroLocal() {
    return {
      name: 'locationId',
      label: 'Local',
      placeholder: 'Local',
      options: this.opcoesLocal(),
    };
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  /** Quantidade tem até 6 casas no banco; truncar em 2 esconderia fração real. */
  protected quantidade(valor: string): string {
    return formatDecimal(valor, 6);
  }

  protected abaixoDoMinimo(saldo: StockBalance): boolean {
    return this.chavesEmAlerta().has(`${saldo.productId}:${saldo.locationId}`);
  }

  private carregarAlertas(): void {
    this.api
      .alerts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (linhas) => this.alertas.set(linhas),
        error: () => this.alertas.set([]),
      });
  }

  /** Valorização é permissão à parte: sem ela, a faixa some em vez de dar 403. */
  private carregarValorizacao(): void {
    if (!this.permissoes.pode('stock-valuation:READ')) return;
    this.api
      .valuation()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (total) => this.valorizacao.set(total),
        error: () => this.valorizacao.set(null),
      });
  }

  private carregarLocais(): void {
    if (!this.permissoes.pode('stock-locations:READ')) return;
    this.api
      .listLocations({ pageSize: 100, isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) =>
          this.opcoesLocal.set(
            r.data.map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` })),
          ),
        error: () => this.opcoesLocal.set([]),
      });
  }
}
