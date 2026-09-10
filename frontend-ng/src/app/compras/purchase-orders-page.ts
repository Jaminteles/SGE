import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { PurchasingApiService } from '../core/api/purchasing-api.service';
import type { ApprovalStatus, PurchaseOrder, PurchaseOrderStatus } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { ROTULO_APROVACAO, severidadeAprovacao } from '../financeiro/rotulos';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar } from '../ui/filter-bar';
import {
  FILTRO_APROVACAO_PEDIDO,
  FILTRO_PENDENTE_RECEBIMENTO,
  FILTRO_STATUS_PEDIDO,
  ROTULO_STATUS_PEDIDO,
  consultaPedido,
  fornecedor,
  severidadePedido,
} from './rotulos';

/**
 * Acompanhamento dos pedidos de compra (RF-036/RF-038 — UI-031).
 *
 * O período filtra pela data do pedido. O filtro "com entrega pendente" é a
 * fila de quem recebe: pedidos aprovados que ainda esperam mercadoria.
 */
@Component({
  selector: 'sge-purchase-orders-page',
  imports: [RouterLink, ButtonModule, TagModule, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Compras / Pedidos</p>

    <div class="pagehead">
      <div>
        <h1>Pedidos de compra</h1>
        <p>Criação, aprovação por alçada e acompanhamento das entregas (RF-036 a RF-038).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Novo pedido" icon="pi pi-plus" routerLink="novo" />
        }
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar por número, fornecedor ou observação"
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
          lista.temFiltro() ? 'Nenhum pedido atende aos filtros.' : 'Nenhum pedido de compra.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-pedido>
          <tr>
            <td>{{ pedido.number }}</td>
            <td>{{ data(pedido.orderDate) }}</td>
            <td>{{ nomeFornecedor(pedido) }}</td>
            <td>{{ pedido.expectedDate ? data(pedido.expectedDate) : '—' }}</td>
            <td class="numero">{{ pedido.items.length }}</td>
            <td class="numero">{{ moeda(pedido.totalAmount) }}</td>
            <td>
              <p-tag
                [value]="rotuloStatus(pedido.status)"
                [severity]="severidadeStatus(pedido.status)"
                [rounded]="true"
              />
            </td>
            <td>
              <p-tag
                [value]="rotuloAprovacao(pedido.approvalStatus)"
                [severity]="severidadeAprovacao(pedido.approvalStatus)"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              <p-button
                label="Abrir"
                severity="secondary"
                [text]="true"
                size="small"
                [routerLink]="[pedido.id]"
              />
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
  `,
})
export class PurchaseOrdersPage {
  private readonly api = inject(PurchasingApiService);
  private readonly permissoes = inject(PermissionsService);

  protected readonly colunas: Coluna[] = [
    { campo: 'number', cabecalho: 'Número', largura: '9rem' },
    { campo: 'orderDate', cabecalho: 'Data', largura: '7rem' },
    { campo: 'partner', cabecalho: 'Fornecedor' },
    { campo: 'expectedDate', cabecalho: 'Previsão', largura: '7rem' },
    { campo: 'items', cabecalho: 'Itens', largura: '5rem' },
    { campo: 'totalAmount', cabecalho: 'Total', largura: '9rem' },
    { campo: 'status', cabecalho: 'Situação', largura: '11rem' },
    { campo: 'approvalStatus', cabecalho: 'Aprovação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '6rem' },
  ];

  protected readonly filtros = [
    FILTRO_STATUS_PEDIDO,
    FILTRO_APROVACAO_PEDIDO,
    FILTRO_PENDENTE_RECEBIMENTO,
  ];

  protected readonly lista = new ListState<PurchaseOrder>(
    (consulta) => this.api.listOrders(consulta),
    consultaPedido,
  );

  protected readonly podeCriar = () => this.permissoes.pode('purchase-orders:CREATE');

  constructor() {
    this.lista.carregar();
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected nomeFornecedor(pedido: PurchaseOrder): string {
    return fornecedor(pedido);
  }

  protected rotuloStatus(status: PurchaseOrderStatus): string {
    return ROTULO_STATUS_PEDIDO[status] ?? status;
  }

  protected severidadeStatus(status: PurchaseOrderStatus) {
    return severidadePedido(status);
  }

  protected rotuloAprovacao(status: ApprovalStatus): string {
    return ROTULO_APROVACAO[status] ?? status;
  }

  protected severidadeAprovacao(status: ApprovalStatus) {
    return severidadeAprovacao(status);
  }
}
