import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { BankingApiService } from '../core/api/banking-api.service';
import type {
  BankTransaction,
  CompanyBankAccount,
  ReconciliationStatus,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro } from '../ui/filter-bar';
import {
  FILTRO_SENTIDO,
  ROTULO_CONCILIACAO,
  consultaMovimento,
  opcaoConta,
  severidadeConciliacao,
} from './rotulos';

/**
 * Consulta dos movimentos bancários importados (RF-060 — UI-046).
 *
 * Entra filtrada quando vem da conta (`?bankAccountId=`) ou de uma importação
 * (`?statementImportId=`). O valor é exibido com sinal pelo sentido: o banco
 * guarda o módulo e o sentido separados.
 */
@Component({
  selector: 'sge-bank-transactions-page',
  imports: [ButtonModule, TagModule, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Bancos / Movimentos</p>

    <div class="pagehead">
      <div>
        <h1>Movimentos bancários</h1>
        <p>Lançamentos importados dos extratos, com a situação da conciliação (RF-060).</p>
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar por descrição, documento ou contraparte"
      [valores]="lista.filtros()"
      [filtros]="filtros()"
      [periodo]="true"
      (mudou)="lista.aplicarFiltros($event)"
    />

    @if (lista.filtros()['statementImportId']) {
      <p class="recorte">
        Mostrando os lançamentos de uma importação.
        <p-button
          label="Ver todos"
          severity="secondary"
          [text]="true"
          size="small"
          (onClick)="removerRecorte()"
        />
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
        [mensagemVazia]="
          lista.temFiltro() ? 'Nenhum movimento atende aos filtros.' : 'Nenhum movimento importado.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-movimento>
          <tr>
            <td>{{ data(movimento.movementDate) }}</td>
            <td>{{ nomeConta(movimento.bankAccountId) }}</td>
            <td>
              {{ movimento.description ?? '—' }}
              @if (movimento.counterpartName || movimento.document) {
                <span class="secundario">
                  {{ movimento.counterpartName ?? '' }}
                  {{ movimento.document ? 'Doc. ' + movimento.document : '' }}
                </span>
              }
            </td>
            <td class="numero" [class.saida]="movimento.direction === 'DEBITO'">
              {{ valor(movimento) }}
            </td>
            <td class="numero">{{ movimento.balanceAfter ? moeda(movimento.balanceAfter) : '—' }}</td>
            <td>
              <p-tag
                [value]="rotuloConciliacao(movimento.reconciliationStatus)"
                [severity]="severidade(movimento.reconciliationStatus)"
                [rounded]="true"
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
    .saida {
      color: var(--p-red-600, var(--p-text-color));
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
export class BankTransactionsPage {
  private readonly api = inject(BankingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas: Coluna[] = [
    { campo: 'movementDate', cabecalho: 'Data', largura: '7rem' },
    { campo: 'bankAccountId', cabecalho: 'Conta', largura: '11rem' },
    { campo: 'description', cabecalho: 'Descrição' },
    { campo: 'amount', cabecalho: 'Valor', largura: '9rem' },
    { campo: 'balanceAfter', cabecalho: 'Saldo após', largura: '9rem' },
    { campo: 'reconciliationStatus', cabecalho: 'Conciliação', largura: '9rem' },
  ];

  protected readonly lista = new ListState<BankTransaction>(
    (consulta) => this.api.listTransactions(consulta),
    consultaMovimento,
  );

  private readonly contas = signal<CompanyBankAccount[]>([]);

  protected readonly filtros = computed<DefinicaoFiltro[]>(() => {
    const contas = this.contas();
    if (contas.length === 0) return [FILTRO_SENTIDO];
    return [
      FILTRO_SENTIDO,
      { name: 'bankAccountId', label: 'Conta', placeholder: 'Conta', options: contas.map(opcaoConta) },
    ];
  });

  constructor() {
    const parametros = this.rota.snapshot.queryParamMap;
    const bankAccountId = parametros.get('bankAccountId') ?? '';
    const statementImportId = parametros.get('statementImportId') ?? '';
    if (bankAccountId || statementImportId) {
      this.lista.filtros.set({ q: '', bankAccountId, statementImportId });
    }
    this.lista.carregar();

    if (this.permissoes.pode('company-bank-accounts:READ')) {
      this.api
        .listAccounts({ pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        // As contas só dão nome à coluna e ao filtro: sem elas a lista continua valendo.
        .subscribe({
          next: (resultado) => this.contas.set(resultado.data),
          error: () => this.contas.set([]),
        });
    }
  }

  protected removerRecorte(): void {
    this.lista.aplicarFiltros({ ...this.lista.filtros(), statementImportId: '' });
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  /** Saída com sinal: o banco guarda o módulo e o sentido separados. */
  protected valor(movimento: BankTransaction): string {
    const texto = formatCurrency(movimento.amount);
    return movimento.direction === 'DEBITO' ? `− ${texto}` : texto;
  }

  protected nomeConta(id: string): string {
    return this.contas().find((c) => c.id === id)?.description ?? '—';
  }

  protected rotuloConciliacao(status: ReconciliationStatus): string {
    return ROTULO_CONCILIACAO[status] ?? status;
  }

  protected severidade(status: ReconciliationStatus) {
    return severidadeConciliacao(status);
  }
}
