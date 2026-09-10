import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { PurchasingApiService } from '../core/api/purchasing-api.service';
import type { GoodsReceipt } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatDateTime } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar } from '../ui/filter-bar';
import { FILTRO_DIVERGENCIA, consultaRecebimento } from './rotulos';

/**
 * Recebimentos e divergências (RF-039/RF-040 — UI-033).
 *
 * O filtro de conferência é a fila de quem trata divergência: entregas com
 * quantidade ou preço diferente do pedido, ou com mercadoria recusada.
 */
@Component({
  selector: 'sge-goods-receipts-page',
  imports: [RouterLink, ButtonModule, TagModule, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Compras / Recebimentos</p>

    <div class="pagehead">
      <div>
        <h1>Recebimentos</h1>
        <p>Entregas conferidas, divergências e o que cada uma gerou (RF-039 a RF-041).</p>
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar pelo número do recebimento"
      [valores]="lista.filtros()"
      [filtros]="filtros"
      [periodo]="true"
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
        [mensagemVazia]="
          lista.temFiltro()
            ? 'Nenhum recebimento atende aos filtros.'
            : 'Nenhum recebimento registrado.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-entrega>
          <tr>
            <td>{{ entrega.number }}</td>
            <td>{{ dataHora(entrega.receivedAt) }}</td>
            <td>
              @if (entrega.order) {
                @if (podeLerPedidos()) {
                  <a [routerLink]="['/compras/pedidos', entrega.order.id]">{{
                    entrega.order.number
                  }}</a>
                } @else {
                  {{ entrega.order.number }}
                }
              } @else {
                —
              }
            </td>
            <td>{{ nota(entrega) }}</td>
            <td>{{ entrega.inspector?.name ?? '—' }}</td>
            <td>
              <p-tag
                [value]="entrega.hasDivergence ? 'Com divergência' : 'Conferida'"
                [severity]="entrega.hasDivergence ? 'warn' : 'success'"
                [rounded]="true"
              />
            </td>
            <td>
              <span class="marcas">
                <p-tag
                  [value]="entrega.generatedStock ? 'Estoque' : 'Sem estoque'"
                  [severity]="entrega.generatedStock ? 'info' : 'secondary'"
                />
                <p-tag
                  [value]="entrega.generatedPayable ? 'Título' : 'Sem título'"
                  [severity]="entrega.generatedPayable ? 'info' : 'secondary'"
                />
              </span>
            </td>
            <td class="acoes">
              <p-button
                label="Abrir"
                severity="secondary"
                [text]="true"
                size="small"
                [routerLink]="[entrega.id]"
              />
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>
  `,
  styles: `
    .marcas {
      display: inline-flex;
      gap: 0.3rem;
    }
  `,
})
export class GoodsReceiptsPage {
  private readonly api = inject(PurchasingApiService);
  private readonly permissoes = inject(PermissionsService);

  protected readonly colunas: Coluna[] = [
    { campo: 'number', cabecalho: 'Número', largura: '9rem' },
    { campo: 'receivedAt', cabecalho: 'Recebido em', largura: '10rem' },
    { campo: 'order', cabecalho: 'Pedido', largura: '9rem' },
    { campo: 'fiscalDocument', cabecalho: 'Nota fiscal', largura: '9rem' },
    { campo: 'inspector', cabecalho: 'Conferente' },
    { campo: 'hasDivergence', cabecalho: 'Conferência', largura: '9rem' },
    { campo: 'efeitos', cabecalho: 'Gerou', largura: '11rem' },
    { campo: 'acoes', cabecalho: '', largura: '6rem' },
  ];

  protected readonly filtros = [FILTRO_DIVERGENCIA];

  protected readonly lista = new ListState<GoodsReceipt>(
    (consulta) => this.api.listReceipts(consulta),
    consultaRecebimento,
  );

  protected readonly podeLerPedidos = () => this.permissoes.pode('purchase-orders:READ');

  constructor() {
    this.lista.carregar();
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }

  protected nota(entrega: GoodsReceipt): string {
    const nota = entrega.fiscalDocument;
    if (!nota) return '—';
    return nota.series ? `${nota.number}/${nota.series}` : nota.number;
  }
}
