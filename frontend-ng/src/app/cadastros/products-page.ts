import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { CatalogApiService } from '../core/api/catalog-api.service';
import type { ItemType, Product } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { ListState } from '../core/lib/list-state';
import { FILTRO_SITUACAO } from '../admin/filtros';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type OpcaoFiltro } from '../ui/filter-bar';
import { FILTRO_TIPO_ITEM, ROTULO_ITEM, consultaProduto } from './rotulos';

/**
 * Catálogo de produtos e serviços (RF-028 a RF-030 — UI-020).
 *
 * Produto e serviço são o mesmo recurso, discriminado por `type` — as abas do
 * Figma viram o filtro que o backend já aceita, não listagens separadas.
 *
 * NCM e CEST só fazem sentido em mercadoria: em serviço a coluna sai como "—",
 * porque o item usa código da LC 116 em vez de NCM.
 */
@Component({
  selector: 'sge-products-page',
  imports: [RouterLink, ButtonModule, TagModule, Alert, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Cadastros / Catálogo</p>

    <div class="pagehead">
      <div>
        <h1>Produtos e serviços</h1>
        <p>Catálogo com unidade, categoria, preço e dados fiscais (RF-028 a RF-030).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Novo item" icon="pi pi-plus" routerLink="novo" />
        }
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar por código, nome ou NCM"
      [valores]="lista.filtros()"
      [filtros]="[FILTRO_TIPO_ITEM, filtroCategoria(), FILTRO_SITUACAO]"
      (mudou)="lista.aplicarFiltros($event)"
    />

    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
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
            ? 'Nenhum item encontrado com esses filtros.'
            : 'Nenhum item cadastrado.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-item>
          <tr>
            <td>{{ item.code }}</td>
            <td>{{ item.description }}</td>
            <td>{{ tipo(item.type) }}</td>
            <td>{{ item.unit?.symbol ?? '—' }}</td>
            <td>{{ fiscal(item) }}</td>
            <td class="coluna--numerica">{{ preco(item) }}</td>
            <td>
              <p-tag
                [value]="item.isActive ? 'Ativo' : 'Inativo'"
                [severity]="item.isActive ? 'success' : 'secondary'"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              <p-button
                label="Abrir"
                severity="secondary"
                [text]="true"
                size="small"
                [routerLink]="[item.id]"
              />
              @if (podeInativar() && item.isActive) {
                <p-button
                  label="Inativar"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  (onClick)="inativar(item)"
                />
              }
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>
  `,
})
export class ProductsPage {
  private readonly api = inject(CatalogApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_TIPO_ITEM = FILTRO_TIPO_ITEM;
  protected readonly FILTRO_SITUACAO = FILTRO_SITUACAO;

  protected readonly colunas: Coluna[] = [
    { campo: 'code', cabecalho: 'Código', largura: '9rem' },
    { campo: 'description', cabecalho: 'Descrição' },
    { campo: 'type', cabecalho: 'Tipo', largura: '8rem' },
    { campo: 'unit', cabecalho: 'Un.', largura: '5rem' },
    { campo: 'ncm', cabecalho: 'NCM / CEST', largura: '12rem' },
    { campo: 'salePrice', cabecalho: 'Preço', numerica: true, largura: '9rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly lista = new ListState<Product>(
    (consulta) => this.api.list(consulta),
    consultaProduto,
  );

  protected readonly opcoesCategoria = signal<OpcaoFiltro[]>([]);
  protected readonly aviso = signal<string | null>(null);

  protected readonly podeCriar = () => this.permissoes.pode('products:CREATE');
  protected readonly podeInativar = () => this.permissoes.pode('products:DELETE');

  constructor() {
    this.lista.carregar();
    this.carregarCategorias();
  }

  protected filtroCategoria() {
    return {
      name: 'categoryId',
      label: 'Categoria',
      placeholder: 'Categoria',
      options: this.opcoesCategoria(),
    };
  }

  protected tipo(tipo: ItemType): string {
    return ROTULO_ITEM[tipo] ?? tipo;
  }

  protected fiscal(item: Product): string {
    if (!item.ncm) return '—';
    return item.cest ? `${item.ncm} / ${item.cest}` : item.ncm;
  }

  protected preco(item: Product): string {
    return item.salePrice ? formatCurrency(item.salePrice) : '—';
  }

  protected inativar(item: Product): void {
    this.aviso.set(null);
    this.api
      .inactivate(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Item ${item.description} inativado.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => this.lista.erro.set(falha),
      });
  }

  private carregarCategorias(): void {
    if (!this.permissoes.pode('product-categories:READ')) return;
    this.api
      .listCategories({ pageSize: 100, isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) =>
          this.opcoesCategoria.set(
            r.data.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
          ),
        error: () => this.opcoesCategoria.set([]),
      });
  }
}
