import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TagModule } from 'primeng/tag';
import { type Observable, map, tap } from 'rxjs';

import { CatalogApiService } from '../core/api/catalog-api.service';
import { PartnersApiService } from '../core/api/partners-api.service';
import { PurchasingApiService } from '../core/api/purchasing-api.service';
import type { PurchaseHistoryLine, PurchaseHistorySummary } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency, formatDecimal } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type OpcaoFiltro } from '../ui/filter-bar';
import { LIMITE_BUSCA, SearchSelect } from '../ui/search-select';
import { CASAS_UNITARIAS, variacaoPercentual } from './calculo';
import { ROTULO_STATUS_PEDIDO, consultaHistorico } from './rotulos';

interface Evolucao {
  texto: string;
  severidade: 'success' | 'danger' | 'secondary';
}

/**
 * Histórico de compras e evolução de preços por item e fornecedor (RF-042 —
 * UI-035).
 *
 * O resumo (preço médio ponderado, menor, maior, último pedido) é agregação do
 * servidor sobre **todo** o recorte, não só a página. A evolução de cada linha
 * compara com a compra anterior do mesmo item dentro da página exibida —
 * filtrando por item e fornecedor, é a série de preços negociados com ele.
 *
 * Recurso de permissão próprio (`purchase-history:READ`): a margem negociada
 * com cada fornecedor é a informação mais sensível do módulo.
 */
@Component({
  selector: 'sge-purchase-history-page',
  imports: [FormsModule, RouterLink, TagModule, DataTable, ErrorAlert, FilterBar, SearchSelect],
  template: `
    <p class="crumb">Compras / Histórico de preços</p>

    <div class="pagehead">
      <div>
        <h1>Histórico de compras</h1>
        <p>Quanto se comprou, de quem e por quanto — e como o preço evoluiu (RF-042).</p>
      </div>
    </div>

    @if (podeBuscarProduto() || podeBuscarFornecedor()) {
      <section class="card secao">
        <div class="grade-campos">
          @if (podeBuscarProduto()) {
            <sge-search-select
              rotulo="Item"
              name="productId"
              [buscar]="buscarProduto"
              [ngModel]="lista.filtros()['productId'] || null"
              (ngModelChange)="filtrar('productId', $event)"
            />
          }
          @if (podeBuscarFornecedor()) {
            <sge-search-select
              rotulo="Fornecedor"
              name="partnerId"
              [buscar]="buscarFornecedor"
              [ngModel]="lista.filtros()['partnerId'] || null"
              (ngModelChange)="filtrar('partnerId', $event)"
            />
          }
        </div>
      </section>
    }

    <div class="espaco">
      <sge-filter-bar
        placeholderBusca="Buscar pela descrição do item"
        [valores]="lista.filtros()"
        [periodo]="true"
        (mudou)="lista.aplicarFiltros($event)"
      />
    </div>

    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (resumo(); as total) {
      <div class="kpis espaco">
        <div class="kpi">
          <p class="kpi__label">Linhas compradas</p>
          <p class="kpi__value">{{ total.lines }}</p>
          <p class="kpi__detail">
            último pedido {{ total.lastOrderDate ? data(total.lastOrderDate) : '—' }}
          </p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Valor comprado</p>
          <p class="kpi__value">{{ moeda(total.amount) }}</p>
          <p class="kpi__detail">{{ quantidade(total.quantity) }} unidade(s)</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Preço médio ponderado</p>
          <p class="kpi__value">{{ unitario(total.averagePrice) }}</p>
          <p class="kpi__detail">pela quantidade de cada compra</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Menor / maior preço</p>
          <p class="kpi__value kpi__value--texto">
            {{ unitario(total.minPrice) }} / {{ unitario(total.maxPrice) }}
          </p>
          @if (amplitude(); as faixa) {
            <p class="kpi__detail">amplitude de {{ faixa }}</p>
          }
        </div>
      </div>
    }

    <section class="card table-card espaco">
      <sge-data-table
        [colunas]="colunas"
        [linhas]="lista.linhas()"
        [total]="lista.total()"
        [pagina]="lista.pagina()"
        [tamanhoPagina]="lista.tamanhoPagina()"
        [carregando]="lista.carregando()"
        [mensagemVazia]="
          lista.temFiltro() ? 'Nenhuma compra atende aos filtros.' : 'Nenhuma compra registrada.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-compra>
          <tr>
            <td>{{ data(compra.orderDate) }}</td>
            <td>
              @if (podeLerPedidos()) {
                <a [routerLink]="['/compras/pedidos', compra.orderId]">{{ compra.number }}</a>
              } @else {
                {{ compra.number }}
              }
              <span class="secundario">{{ rotuloStatus(compra) }}</span>
            </td>
            <td>{{ compra.partner.legalName ?? '—' }}</td>
            <td>
              {{ compra.product?.code ? compra.product.code + ' — ' : '' }}{{ compra.description }}
            </td>
            <td class="numero">
              {{ quantidade(compra.quantity) }}
              <span class="secundario">recebida {{ quantidade(compra.receivedQuantity) }}</span>
            </td>
            <td class="numero">{{ unitario(compra.unitPrice) }}</td>
            <td class="numero">{{ unitario(compra.landedUnitCost) }}</td>
            <td class="numero">{{ moeda(compra.lineAmount) }}</td>
            <td>
              @if (evolucao(compra); as mudanca) {
                <p-tag [value]="mudanca.texto" [severity]="mudanca.severidade" />
              } @else {
                <span class="secundario">primeira na página</span>
              }
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>
  `,
  styles: `
    .numero {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .secundario {
      display: block;
      font-size: 0.7rem;
      color: var(--p-text-muted-color);
    }
    .kpi__value--texto {
      font-size: 0.95rem;
    }
  `,
})
export class PurchaseHistoryPage {
  private readonly api = inject(PurchasingApiService);
  private readonly catalogo = inject(CatalogApiService);
  private readonly parceiros = inject(PartnersApiService);
  private readonly permissoes = inject(PermissionsService);

  protected readonly colunas: Coluna[] = [
    { campo: 'orderDate', cabecalho: 'Data', largura: '7rem' },
    { campo: 'number', cabecalho: 'Pedido', largura: '9rem' },
    { campo: 'partner', cabecalho: 'Fornecedor', largura: '12rem' },
    { campo: 'description', cabecalho: 'Item' },
    { campo: 'quantity', cabecalho: 'Quantidade', largura: '8rem' },
    { campo: 'unitPrice', cabecalho: 'Preço unit.', largura: '8rem' },
    { campo: 'landedUnitCost', cabecalho: 'Custo posto', largura: '8rem' },
    { campo: 'lineAmount', cabecalho: 'Valor', largura: '8rem' },
    { campo: 'evolucao', cabecalho: 'Evolução', largura: '9rem' },
  ];

  protected readonly resumo = signal<PurchaseHistorySummary | null>(null);

  protected readonly lista = new ListState<PurchaseHistoryLine>(
    (consulta) => this.api.history(consulta).pipe(tap((r) => this.resumo.set(r.summary))),
    consultaHistorico,
  );

  protected readonly podeBuscarProduto = () => this.permissoes.pode('products:READ');
  protected readonly podeBuscarFornecedor = () => this.permissoes.pode('partners:READ');
  protected readonly podeLerPedidos = () => this.permissoes.pode('purchase-orders:READ');

  /**
   * Compra anterior de cada linha: a próxima da página (ordem é data
   * decrescente) com o mesmo item — produto do catálogo ou, na compra avulsa,
   * a mesma descrição.
   */
  private readonly anteriores = computed(() => {
    const linhas = this.lista.linhas();
    const mapa = new Map<string, PurchaseHistoryLine>();
    linhas.forEach((linha, indice) => {
      const chave = this.chaveItem(linha);
      const anterior = linhas.slice(indice + 1).find((outra) => this.chaveItem(outra) === chave);
      if (anterior) mapa.set(linha.orderItemId, anterior);
    });
    return mapa;
  });

  protected readonly amplitude = computed(() => {
    const total = this.resumo();
    if (!total?.minPrice || !total.maxPrice) return null;
    const variacao = variacaoPercentual(total.maxPrice, total.minPrice);
    return variacao === null ? null : `${formatDecimal(variacao)}%`;
  });

  protected readonly buscarProduto = (termo: string): Observable<OpcaoFiltro[]> =>
    this.catalogo
      .list({ q: termo, pageSize: LIMITE_BUSCA })
      .pipe(
        map((r) => r.data.map((p) => ({ value: p.id, label: `${p.code} — ${p.description}` }))),
      );

  protected readonly buscarFornecedor = (termo: string): Observable<OpcaoFiltro[]> =>
    this.parceiros
      .list({ q: termo, role: 'FORNECEDOR', pageSize: LIMITE_BUSCA })
      .pipe(map((r) => r.data.map((p) => ({ value: p.id, label: p.tradeName ?? p.legalName }))));

  constructor() {
    this.lista.carregar();
  }

  protected filtrar(campo: 'productId' | 'partnerId', valor: string | null): void {
    if ((this.lista.filtros()[campo] ?? '') === (valor ?? '')) return;
    this.lista.aplicarFiltros({ ...this.lista.filtros(), [campo]: valor ?? '' });
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected quantidade(valor: string): string {
    return formatDecimal(valor, CASAS_UNITARIAS);
  }

  protected unitario(valor: string | null): string {
    return valor === null ? '—' : `R$ ${formatDecimal(valor, CASAS_UNITARIAS)}`;
  }

  protected rotuloStatus(linha: PurchaseHistoryLine): string {
    return ROTULO_STATUS_PEDIDO[linha.status] ?? linha.status;
  }

  protected evolucao(linha: PurchaseHistoryLine): Evolucao | null {
    const anterior = this.anteriores().get(linha.orderItemId);
    if (!anterior) return null;
    const variacao = variacaoPercentual(linha.unitPrice, anterior.unitPrice);
    if (variacao === null) return null;
    if (variacao === '0.00') return { texto: 'estável', severidade: 'secondary' };
    const subiu = !variacao.startsWith('-');
    const texto = formatDecimal(variacao);
    // Preço de compra que sobe é custo que sobe: vermelho.
    return {
      texto: `${subiu ? '▲ +' + texto : '▼ ' + texto}%`,
      severidade: subiu ? 'danger' : 'success',
    };
  }

  private chaveItem(linha: PurchaseHistoryLine): string {
    return linha.product?.id ?? `avulso:${linha.description.trim().toLowerCase()}`;
  }
}
