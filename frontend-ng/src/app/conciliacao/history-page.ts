import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { BankingApiService } from '../core/api/banking-api.service';
import { ReconciliationApiService } from '../core/api/reconciliation-api.service';
import type { CompanyBankAccount, ReconciliationListItem } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate, formatDateTime } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { opcaoConta } from '../bancos/rotulos';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro } from '../ui/filter-bar';
import {
  FILTRO_DIVERGENCIA,
  FILTRO_ORIGEM,
  FILTRO_VIGENCIA,
  ROTULO_ORIGEM,
  alvoVinculo,
  consultaHistorico,
  rotuloScore,
  valorComSinal,
} from './rotulos';

/**
 * Histórico de conciliações e trilha de desfazimento (RF-077 — UI-053).
 *
 * Entra com as desfeitas: uma conciliação errada que some leva junto a
 * evidência de que existiu, e é exatamente isso que se procura quando o
 * extrato não fecha. Cada linha desfeita mostra quando e por quê.
 *
 * Entra filtrada quando vem de um movimento (`?bankTransactionId=`).
 */
@Component({
  selector: 'sge-history-page',
  imports: [RouterLink, ButtonModule, TagModule, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Conciliação / Histórico</p>

    <div class="pagehead">
      <div>
        <h1>Histórico de conciliações</h1>
        <p>Vínculos feitos, por quem e como, inclusive os desfeitos e o motivo (RF-077).</p>
      </div>
    </div>

    <sge-filter-bar
      [busca]="false"
      [valores]="lista.filtros()"
      [filtros]="filtros()"
      [periodo]="true"
      (mudou)="lista.aplicarFiltros($event)"
    />

    @if (lista.filtros()['bankTransactionId']) {
      <p class="recorte">
        Mostrando a trilha de um movimento.
        <p-button label="Ver todos" severity="secondary" [text]="true" size="small" (onClick)="removerRecorte()" />
      </p>
    }

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
        [mensagemVazia]="lista.temFiltro() ? 'Nenhuma conciliação atende aos filtros.' : 'Nenhuma conciliação registrada.'"
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-vinculo>
          <tr [class.desfeito]="!!vinculo.undoneAt">
            <td>{{ dataHora(vinculo.createdAt) }}</td>
            <td>
              {{ data(vinculo.bankTransaction.movementDate) }} · {{ nomeConta(vinculo.bankTransaction.bankAccountId) }}
              <span class="secundario">
                {{ vinculo.bankTransaction.description ?? '—' }} ({{ valorMovimento(vinculo) }})
              </span>
            </td>
            <td>
              {{ alvo(vinculo) }}
              <span class="secundario">{{ origem(vinculo) }}</span>
            </td>
            <td class="numero riscavel">{{ moeda(vinculo.reconciledAmount) }}</td>
            <td class="numero">{{ vinculo.hasDivergence ? moeda(vinculo.difference) : '—' }}</td>
            <td>
              @if (vinculo.undoneAt) {
                <p-tag value="Desfeita" severity="secondary" [rounded]="true" />
                <span class="secundario">{{ dataHora(vinculo.undoneAt) }}: {{ vinculo.undoReason }}</span>
              } @else {
                <p-tag
                  [value]="vinculo.confirmed ? 'Vigente' : 'Sugestão'"
                  [severity]="vinculo.confirmed ? 'success' : 'info'"
                  [rounded]="true"
                />
                @if (vinculo.justification) {
                  <span class="secundario">{{ vinculo.justification }}</span>
                }
              }
            </td>
            <td class="acoes">
              <p-button
                label="Movimento"
                severity="secondary"
                [text]="true"
                size="small"
                [routerLink]="['/conciliacao/movimentos', vinculo.bankTransactionId]"
                [state]="{ descricao: vinculo.bankTransaction.description }"
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
    .desfeito td {
      color: var(--p-text-muted-color);
    }
    .desfeito .riscavel {
      text-decoration: line-through;
    }
    .recorte {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.75rem 0 0;
      font-size: 0.8rem;
      color: var(--p-text-muted-color);
    }
  `,
})
export class HistoryPage {
  private readonly api = inject(ReconciliationApiService);
  private readonly bancos = inject(BankingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas: Coluna[] = [
    { campo: 'createdAt', cabecalho: 'Conciliada em', largura: '9rem' },
    { campo: 'bankTransaction', cabecalho: 'Movimento' },
    { campo: 'target', cabecalho: 'Alvo / origem', largura: '12rem' },
    { campo: 'reconciledAmount', cabecalho: 'Conciliado', largura: '8rem' },
    { campo: 'difference', cabecalho: 'Diferença', largura: '8rem' },
    { campo: 'undoneAt', cabecalho: 'Situação', largura: '14rem' },
    { campo: 'acoes', cabecalho: '', largura: '7rem' },
  ];

  protected readonly lista = new ListState<ReconciliationListItem>(
    (consulta) => this.api.list(consulta),
    consultaHistorico,
  );

  private readonly contas = signal<CompanyBankAccount[]>([]);

  protected readonly filtros = computed<DefinicaoFiltro[]>(() => {
    const base = [FILTRO_VIGENCIA, FILTRO_ORIGEM, FILTRO_DIVERGENCIA];
    const contas = this.contas();
    if (contas.length === 0) return base;
    return [
      ...base,
      { name: 'bankAccountId', label: 'Conta', placeholder: 'Conta', options: contas.map(opcaoConta) },
    ];
  });

  constructor() {
    const bankTransactionId = this.rota.snapshot.queryParamMap.get('bankTransactionId') ?? '';
    if (bankTransactionId) this.lista.filtros.set({ q: '', bankTransactionId });
    this.lista.carregar();

    if (this.permissoes.pode('company-bank-accounts:READ')) {
      this.bancos
        .listAccounts({ pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (resultado) => this.contas.set(resultado.data),
          error: () => this.contas.set([]),
        });
    }
  }

  protected removerRecorte(): void {
    this.lista.aplicarFiltros({ ...this.lista.filtros(), bankTransactionId: '' });
  }

  protected alvo(vinculo: ReconciliationListItem): string {
    return alvoVinculo(vinculo);
  }

  protected origem(vinculo: ReconciliationListItem): string {
    const texto = ROTULO_ORIGEM[vinculo.origin] ?? vinculo.origin;
    return vinculo.score ? `${texto} · confiança ${rotuloScore(vinculo.score)}` : texto;
  }

  protected valorMovimento(vinculo: ReconciliationListItem): string {
    return valorComSinal(vinculo.bankTransaction);
  }

  protected nomeConta(id: string): string {
    return this.contas().find((c) => c.id === id)?.description ?? 'Conta';
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }
}
