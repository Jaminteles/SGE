import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import { FinanceApiService } from '../core/api/finance-api.service';
import type { ApprovalStatus, EntryStatus, FinancialEntry } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro, type OpcaoFiltro } from '../ui/filter-bar';
import {
  FILTRO_APROVACAO,
  FILTRO_EM_ABERTO,
  FILTRO_STATUS_TITULO,
  FILTRO_TIPO,
  ROTULO_APROVACAO,
  ROTULO_STATUS_TITULO,
  ROTULO_TIPO,
  consultaTitulo,
  contraparte,
  severidadeAprovacao,
  severidadeTitulo,
} from './rotulos';

/**
 * Contas a pagar e a receber (RF-051/RF-052/RF-054 — UI-024/UI-025).
 *
 * Uma listagem só para as duas carteiras, como no backend: o filtro de
 * carteira separa pagar de receber. O período filtra pelo **vencimento** das
 * parcelas, que é a pergunta do dia a dia ("o que vence nesta semana?").
 */
@Component({
  selector: 'sge-entries-page',
  imports: [RouterLink, ButtonModule, TagModule, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Financeiro / Contas a pagar e receber</p>

    <div class="pagehead">
      <div>
        <h1>Contas a pagar e receber</h1>
        <p>
          Lançamento, parcelamento, classificação e acompanhamento dos títulos (RF-051 a RF-055).
        </p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Novo título" icon="pi pi-plus" routerLink="novo" />
        }
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar por número, descrição ou documento"
      [valores]="lista.filtros()"
      [filtros]="filtros()"
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
          lista.temFiltro() ? 'Nenhum título atende aos filtros.' : 'Nenhum título lançado.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-titulo>
          <tr>
            <td>{{ titulo.number }}</td>
            <td>{{ tipo(titulo) }}</td>
            <td>{{ nomeContraparte(titulo) }}</td>
            <td>
              {{ titulo.description }}
              @if (titulo.category) {
                <span class="secundario"
                  >{{ titulo.category.code }} — {{ titulo.category.name }}</span
                >
              }
            </td>
            <td>{{ proximoVencimento(titulo) }}</td>
            <td class="numero">{{ moeda(titulo.netAmount) }}</td>
            <td class="numero">{{ moeda(titulo.balance) }}</td>
            <td>
              <p-tag
                [value]="rotuloStatus(titulo.status)"
                [severity]="severidadeStatus(titulo.status)"
                [rounded]="true"
              />
            </td>
            <td>
              <p-tag
                [value]="rotuloAprovacao(titulo.approvalStatus)"
                [severity]="severidadeAprovacao(titulo.approvalStatus)"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              <p-button
                label="Abrir"
                severity="secondary"
                [text]="true"
                size="small"
                [routerLink]="[titulo.id]"
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
    .secundario {
      display: block;
    }
  `,
})
export class EntriesPage {
  private readonly api = inject(FinanceApiService);
  private readonly configuracoes = inject(ConfigurationsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas: Coluna[] = [
    { campo: 'number', cabecalho: 'Número', largura: '9rem' },
    { campo: 'type', cabecalho: 'Carteira', largura: '7rem' },
    { campo: 'partner', cabecalho: 'Contraparte', largura: '13rem' },
    { campo: 'description', cabecalho: 'Descrição / categoria' },
    { campo: 'dueDate', cabecalho: 'Próx. vencimento', largura: '9rem' },
    { campo: 'netAmount', cabecalho: 'Valor líquido', largura: '9rem' },
    { campo: 'balance', cabecalho: 'Saldo', largura: '9rem' },
    { campo: 'status', cabecalho: 'Situação', largura: '10rem' },
    { campo: 'approvalStatus', cabecalho: 'Aprovação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '6rem' },
  ];

  protected readonly lista = new ListState<FinancialEntry>(
    (consulta) => this.api.listEntries(consulta),
    consultaTitulo,
  );

  private readonly opcoesCategoria = signal<OpcaoFiltro[]>([]);
  private readonly opcoesCentro = signal<OpcaoFiltro[]>([]);

  protected readonly podeCriar = () => this.permissoes.pode('financial-entries:CREATE');

  constructor() {
    this.lista.carregar();
    this.carregarClassificacoes();
  }

  /** Filtros de classificação (RF-054) só aparecem quando há o que escolher. */
  protected filtros(): DefinicaoFiltro[] {
    const lista: DefinicaoFiltro[] = [
      FILTRO_TIPO,
      FILTRO_STATUS_TITULO,
      FILTRO_APROVACAO,
      FILTRO_EM_ABERTO,
    ];
    if (this.opcoesCategoria().length > 0) {
      lista.push({
        name: 'categoryId',
        label: 'Categoria',
        placeholder: 'Categoria',
        options: this.opcoesCategoria(),
      });
    }
    if (this.opcoesCentro().length > 0) {
      lista.push({
        name: 'costCenterId',
        label: 'Centro de custo',
        placeholder: 'Centro de custo',
        options: this.opcoesCentro(),
      });
    }
    return lista;
  }

  protected tipo(titulo: FinancialEntry): string {
    return ROTULO_TIPO[titulo.type] ?? titulo.type;
  }

  protected nomeContraparte(titulo: FinancialEntry): string {
    return contraparte(titulo);
  }

  /** Primeira parcela ainda com saldo; título quitado não tem próximo vencimento. */
  protected proximoVencimento(titulo: FinancialEntry): string {
    const parcela = titulo.installments.find(
      (p) => p.status === 'ABERTA' || p.status === 'PARCIALMENTE_LIQUIDADA',
    );
    return parcela ? formatDate(parcela.dueDate) : '—';
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected rotuloStatus(status: EntryStatus): string {
    return ROTULO_STATUS_TITULO[status] ?? status;
  }

  protected severidadeStatus(status: EntryStatus) {
    return severidadeTitulo(status);
  }

  protected rotuloAprovacao(status: ApprovalStatus): string {
    return ROTULO_APROVACAO[status] ?? status;
  }

  protected severidadeAprovacao(status: ApprovalStatus) {
    return severidadeAprovacao(status);
  }

  private carregarClassificacoes(): void {
    if (this.permissoes.pode('categories:READ')) {
      this.configuracoes
        .listCategories({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesCategoria.set(
              r.data.map((c) => ({
                value: c.id,
                label: `${c.code} — ${c.name} (${ROTULO_TIPO[c.type]})`,
              })),
            ),
          error: () => this.opcoesCategoria.set([]),
        });
    }
    if (this.permissoes.pode('cost-centers:READ')) {
      this.configuracoes
        .listCostCenters({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesCentro.set(
              r.data.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
            ),
          error: () => this.opcoesCentro.set([]),
        });
    }
  }
}
