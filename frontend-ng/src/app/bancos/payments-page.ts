import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { BankingApiService } from '../core/api/banking-api.service';
import type {
  CompanyBankAccount,
  PaymentMethodType,
  PaymentTransaction,
  PaymentTransactionStatus,
  TransactionDirection,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate, formatDateTime } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { ROTULO_METODO } from '../financeiro/rotulos';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro } from '../ui/filter-bar';
import {
  FILTRO_METODO_ORDEM,
  FILTRO_SENTIDO,
  FILTRO_STATUS_ORDEM,
  ROTULO_SENTIDO,
  ROTULO_STATUS_ORDEM,
  consultaOrdem,
  emRetentativa,
  favorecido,
  opcaoConta,
  severidadeOrdem,
} from './rotulos';

/**
 * Consulta das ordens de pagamento e recebimento (RF-063/RF-064 — UI-044).
 *
 * O período filtra pela data de criação. Cancelar, consultar o provedor e
 * confirmar ficam no detalhe, onde a ordem inteira está à vista — ação de
 * dinheiro não se dispara de uma linha de tabela.
 */
@Component({
  selector: 'sge-payments-page',
  imports: [RouterLink, ButtonModule, TagModule, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Bancos / Ordens</p>

    <div class="pagehead">
      <div>
        <h1>Ordens de pagamento</h1>
        <p>PIX, boleto e transferências emitidos, agendados e cancelados (RF-062 a RF-065).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Nova ordem" icon="pi pi-plus" routerLink="nova" />
        }
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar por favorecido, descrição ou identificador do banco"
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
          lista.temFiltro() ? 'Nenhuma ordem atende aos filtros.' : 'Nenhuma ordem emitida.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-ordem>
          <tr>
            <td>{{ dataHora(ordem.createdAt) }}</td>
            <td>
              {{ nomeFavorecido(ordem) }}
              @if (ordem.description) {
                <span class="secundario">{{ ordem.description }}</span>
              }
            </td>
            <td>
              {{ metodo(ordem.method) }}
              <span class="secundario">{{ sentido(ordem.direction) }}</span>
            </td>
            <td>{{ nomeConta(ordem.bankAccountId) }}</td>
            <td>{{ ordem.scheduledFor ? data(ordem.scheduledFor) : '—' }}</td>
            <td class="numero">{{ moeda(ordem.amount) }}</td>
            <td>
              <p-tag
                [value]="rotuloStatus(ordem.status)"
                [severity]="severidadeStatus(ordem.status)"
                [rounded]="true"
              />
              @if (retentando(ordem)) {
                <span class="secundario">Tentativa {{ ordem.attempts }} de {{ ordem.maxAttempts }}</span>
              }
            </td>
            <td class="acoes">
              <p-button
                label="Abrir"
                severity="secondary"
                [text]="true"
                size="small"
                [routerLink]="[ordem.id]"
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
export class PaymentsPage {
  private readonly api = inject(BankingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas: Coluna[] = [
    { campo: 'createdAt', cabecalho: 'Criada em', largura: '9rem' },
    { campo: 'payee', cabecalho: 'Favorecido' },
    { campo: 'method', cabecalho: 'Modalidade', largura: '9rem' },
    { campo: 'bankAccountId', cabecalho: 'Conta', largura: '11rem' },
    { campo: 'scheduledFor', cabecalho: 'Agendada', largura: '7rem' },
    { campo: 'amount', cabecalho: 'Valor', largura: '9rem' },
    { campo: 'status', cabecalho: 'Situação', largura: '10rem' },
    { campo: 'acoes', cabecalho: '', largura: '6rem' },
  ];

  protected readonly lista = new ListState<PaymentTransaction>(
    (consulta) => this.api.listPayments(consulta),
    consultaOrdem,
  );

  private readonly contas = signal<CompanyBankAccount[]>([]);

  /** O filtro de conta só existe para quem pode ler as contas. */
  protected readonly filtros = computed<DefinicaoFiltro[]>(() => {
    const base = [FILTRO_STATUS_ORDEM, FILTRO_METODO_ORDEM, FILTRO_SENTIDO];
    const contas = this.contas();
    if (contas.length === 0) return base;
    return [
      ...base,
      { name: 'bankAccountId', label: 'Conta', placeholder: 'Conta', options: contas.map(opcaoConta) },
    ];
  });

  protected readonly podeCriar = () =>
    this.permissoes.pode('payments:CREATE') && this.permissoes.pode('company-bank-accounts:READ');

  constructor() {
    // O painel de operações abre esta lista já filtrada (`?status=FALHA`).
    const status = this.rota.snapshot.queryParamMap.get('status');
    if (status && status in ROTULO_STATUS_ORDEM) this.lista.filtros.set({ q: '', status });
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

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected nomeFavorecido(ordem: PaymentTransaction): string {
    return favorecido(ordem);
  }

  protected nomeConta(id: string): string {
    return this.contas().find((c) => c.id === id)?.description ?? '—';
  }

  protected metodo(valor: PaymentMethodType): string {
    return ROTULO_METODO[valor] ?? valor;
  }

  protected sentido(valor: TransactionDirection): string {
    return ROTULO_SENTIDO[valor] ?? valor;
  }

  protected rotuloStatus(status: PaymentTransactionStatus): string {
    return ROTULO_STATUS_ORDEM[status] ?? status;
  }

  protected severidadeStatus(status: PaymentTransactionStatus) {
    return severidadeOrdem(status);
  }

  protected retentando(ordem: PaymentTransaction): boolean {
    return emRetentativa(ordem);
  }
}
