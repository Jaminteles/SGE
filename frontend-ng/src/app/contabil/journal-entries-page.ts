import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { AccountingApiService } from '../core/api/accounting-api.service';
import type { AccountingPeriod, JournalEntry, LedgerAccountNode } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro } from '../ui/filter-bar';
import { TextField } from '../ui/text-field';
import {
  FILTRO_ORIGEM_LANCAMENTO,
  bloqueioDaCompetencia,
  consultaLancamentos,
  contasAnaliticas,
  documentoDoLancamento,
  opcaoContaContabil,
  periodoDaData,
  problemaEstorno,
  rotuloMes,
  rotuloOrigemLancamento,
} from './rotulos';

/**
 * Lançamentos contábeis (RF-081/RF-082 — UI-056).
 *
 * Partida dobrada, com origem e documento de cada lançamento. Não há edição
 * nem exclusão: o lançamento é imutável e corrigir é estornar, o que deixa as
 * duas versões visíveis no razão.
 *
 * O período fechado aparece na própria linha (UI-059): estornar ali só com
 * outra competência, porque o servidor recusa lançar em mês fechado (RN-008).
 */
@Component({
  selector: 'sge-journal-entries-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    TagModule,
    Alert,
    DataTable,
    ErrorAlert,
    FilterBar,
    TextField,
  ],
  template: `
    <p class="crumb">Contábil / Lançamentos</p>

    <div class="pagehead">
      <div>
        <h1>Lançamentos contábeis</h1>
        <p>Diário com débito e crédito, origem e documento de cada lançamento (RF-081/RF-082).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeLancar()) {
          <p-button label="Novo lançamento" icon="pi pi-plus" routerLink="/contabil/lancamentos/novo" />
        }
      </div>
    </div>

    @if (aviso(); as texto) {
      <sge-alert tom="sucesso" [titulo]="texto" />
    }

    <sge-filter-bar
      [busca]="false"
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
        [mensagemVazia]="lista.temFiltro() ? 'Nenhum lançamento atende aos filtros.' : 'Nenhum lançamento contábil registrado.'"
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-lancamento>
          <tr [class.estornado]="lancamento.isReversed">
            <td class="numero">{{ lancamento.number }}</td>
            <td>
              {{ data(lancamento.competenceDate) }}
              @if (fechado(lancamento); as mes) {
                <span class="bloqueio" [attr.title]="'Período ' + mes + ' fechado'">
                  <i class="pi pi-lock" aria-hidden="true"></i> {{ mes }} fechado
                </span>
              }
            </td>
            <td>
              {{ lancamento.history }}
              <span class="secundario">{{ lancamento.lines.length }} partida(s)</span>
            </td>
            <td>
              {{ origem(lancamento) }}
              <span class="secundario">{{ documento(lancamento) }}</span>
            </td>
            <td class="numero">{{ moeda(lancamento.totalAmount) }}</td>
            <td>
              @if (lancamento.isReversed) {
                <p-tag value="Estornado" severity="secondary" [rounded]="true" />
              } @else if (lancamento.reversalOfId) {
                <p-tag value="Estorno" severity="warn" [rounded]="true" />
              } @else {
                <p-tag value="Vigente" severity="success" [rounded]="true" />
              }
              @if (lancamento.exported) {
                <span class="secundario">Exportado</span>
              }
            </td>
            <td class="acoes">
              <p-button
                [label]="expandido() === lancamento.id ? 'Ocultar' : 'Partidas'"
                severity="secondary"
                [text]="true"
                size="small"
                [attr.aria-expanded]="expandido() === lancamento.id"
                (onClick)="alternar(lancamento.id)"
              />
              @if (podeEstornar() && estornavel(lancamento)) {
                <p-button label="Estornar" severity="danger" [text]="true" size="small" (onClick)="abrirEstorno(lancamento)" />
              }
            </td>
          </tr>
          @if (expandido() === lancamento.id) {
            <tr class="partidas">
              <td></td>
              <td colspan="6">
                <table class="partidas__tabela">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Conta</th>
                      <th class="numero">Débito</th>
                      <th class="numero">Crédito</th>
                      <th>Complemento</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (partida of lancamento.lines; track partida.id) {
                      <tr>
                        <td>{{ partida.sequence }}</td>
                        <td>{{ partida.accountCode }} — {{ partida.accountName }}</td>
                        <td class="numero">{{ partida.type === 'DEBITO' ? moeda(partida.amount) : '' }}</td>
                        <td class="numero">{{ partida.type === 'CREDITO' ? moeda(partida.amount) : '' }}</td>
                        <td>{{ partida.extraHistory ?? '' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </td>
            </tr>
          }
        </ng-template>
      </sge-data-table>
    </section>

    <p-dialog
      [visible]="estornando() !== null"
      (visibleChange)="$event || fecharEstorno()"
      [modal]="true"
      [style]="{ width: '34rem' }"
      [header]="'Estornar lançamento nº ' + (estornando()?.number ?? '')"
    >
      @if (erroEstorno(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <p class="secundario">
        O estorno gera um lançamento com as partidas invertidas. O original continua no razão, marcado como estornado.
      </p>
      @if (bloqueioEstorno(); as texto) {
        <sge-alert tom="aviso" titulo="Competência bloqueada" [mensagem]="texto" />
      }
      <div class="grade-campos">
        <sge-text-field
          rotulo="Motivo"
          [obrigatorio]="true"
          [ngModel]="motivo()"
          (ngModelChange)="motivo.set($event ?? '')"
        />
        <sge-text-field
          rotulo="Competência do estorno"
          tipo="date"
          dica="Em branco: a do lançamento estornado"
          [ngModel]="competenciaEstorno()"
          (ngModelChange)="competenciaEstorno.set($event ?? '')"
        />
      </div>
      @if (tentouEstornar() && problemaDoEstorno(); as texto) {
        <p class="campo__erro">{{ texto }}</p>
      }
      <ng-template #footer>
        <p-button label="Voltar" severity="secondary" [outlined]="true" [disabled]="salvando()" (onClick)="fecharEstorno()" />
        <p-button
          label="Estornar"
          icon="pi pi-undo"
          severity="danger"
          [loading]="salvando()"
          [disabled]="salvando() || !!bloqueioEstorno()"
          (onClick)="estornar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .numero {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .estornado td {
      color: var(--p-text-muted-color);
    }
    .bloqueio {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      margin-left: 0.4rem;
      padding: 0.05rem 0.4rem;
      font-size: 0.7rem;
      border-radius: 999px;
      color: var(--p-red-700, var(--p-text-color));
      background: var(--p-red-50, transparent);
    }
    .partidas td {
      background: var(--p-content-hover-background, transparent);
    }
    .partidas__tabela {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
    }
    .partidas__tabela th,
    .partidas__tabela td {
      padding: 0.3rem 0.5rem;
      text-align: left;
    }
    .partidas__tabela th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
  `,
})
export class JournalEntriesPage {
  private readonly api = inject(AccountingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas: Coluna[] = [
    { campo: 'number', cabecalho: 'Nº', largura: '5rem' },
    { campo: 'competenceDate', cabecalho: 'Competência', largura: '10rem' },
    { campo: 'history', cabecalho: 'Histórico' },
    { campo: 'origin', cabecalho: 'Origem / documento', largura: '13rem' },
    { campo: 'totalAmount', cabecalho: 'Valor', largura: '9rem' },
    { campo: 'isReversed', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '10rem' },
  ];

  protected readonly lista = new ListState<JournalEntry>(
    (consulta) => this.api.listEntries(consulta),
    consultaLancamentos,
  );

  /** `null` = sem permissão para ler períodos: a tela não afirma bloqueio. */
  private readonly periodos = signal<AccountingPeriod[] | null>(null);
  private readonly plano = signal<LedgerAccountNode[]>([]);

  protected readonly aviso = signal<string | null>(avisoDaNavegacao());
  protected readonly expandido = signal<string | null>(null);
  protected readonly estornando = signal<JournalEntry | null>(null);
  protected readonly motivo = signal('');
  protected readonly competenciaEstorno = signal('');
  protected readonly tentouEstornar = signal(false);
  protected readonly salvando = signal(false);
  protected readonly erroEstorno = signal<unknown>(null);

  protected readonly filtros = computed<DefinicaoFiltro[]>(() => {
    const contas = contasAnaliticas(this.plano());
    if (contas.length === 0) return [FILTRO_ORIGEM_LANCAMENTO];
    return [
      FILTRO_ORIGEM_LANCAMENTO,
      { name: 'accountId', label: 'Conta', placeholder: 'Conta', options: contas.map(opcaoContaContabil) },
    ];
  });

  protected readonly problemaDoEstorno = computed(() => problemaEstorno(this.motivo()));

  protected readonly bloqueioEstorno = computed(() => {
    const lancamento = this.estornando();
    if (!lancamento) return null;
    const competencia = this.competenciaEstorno() || lancamento.competenceDate.slice(0, 10);
    return bloqueioDaCompetencia(this.periodos(), competencia);
  });

  protected readonly podeLancar = () =>
    this.permissoes.pode('journal-entries:CREATE') && this.permissoes.pode('ledger-accounts:READ');
  protected readonly podeEstornar = () => this.permissoes.pode('journal-entries:DELETE');

  constructor() {
    this.lista.carregar();
    if (this.permissoes.pode('accounting-periods:READ')) {
      this.api
        .listPeriods()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (periodos) => this.periodos.set(periodos), error: () => this.periodos.set(null) });
    }
    if (this.permissoes.pode('ledger-accounts:READ')) {
      this.api
        .tree()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (plano) => this.plano.set(plano), error: () => this.plano.set([]) });
    }
  }

  protected alternar(id: string): void {
    this.expandido.update((atual) => (atual === id ? null : id));
  }

  /** Estorno de estorno e lançamento já estornado não se estornam de novo. */
  protected estornavel(lancamento: JournalEntry): boolean {
    return !lancamento.isReversed && !lancamento.reversalOfId;
  }

  protected abrirEstorno(lancamento: JournalEntry): void {
    this.estornando.set(lancamento);
    this.motivo.set('');
    this.competenciaEstorno.set('');
    this.tentouEstornar.set(false);
    this.erroEstorno.set(null);
  }

  protected fecharEstorno(): void {
    this.estornando.set(null);
  }

  protected estornar(): void {
    const lancamento = this.estornando();
    this.tentouEstornar.set(true);
    if (!lancamento || this.salvando() || this.problemaDoEstorno() || this.bloqueioEstorno()) return;

    this.salvando.set(true);
    this.erroEstorno.set(null);
    this.api
      .reverseEntry(lancamento.id, this.motivo().trim(), this.competenciaEstorno() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (estorno) => {
          this.salvando.set(false);
          this.estornando.set(null);
          this.aviso.set(`Lançamento nº ${lancamento.number} estornado pelo nº ${estorno.number}.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erroEstorno.set(falha);
        },
      });
  }

  /** "03/2026" quando a competência cai em período fechado; `null` caso contrário. */
  protected fechado(lancamento: JournalEntry): string | null {
    const periodos = this.periodos();
    if (!periodos) return null;
    const periodo = periodoDaData(periodos, lancamento.competenceDate.slice(0, 10));
    return periodo?.status === 'FECHADO' ? rotuloMes(periodo.year, periodo.month) : null;
  }

  protected origem(lancamento: JournalEntry): string {
    return rotuloOrigemLancamento(lancamento.origin);
  }

  protected documento(lancamento: JournalEntry): string {
    return documentoDoLancamento(lancamento);
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }
}

/** Mensagem deixada pelo formulário ao voltar para a lista. */
function avisoDaNavegacao(): string | null {
  const estado: unknown = typeof history === 'undefined' ? null : history.state;
  if (estado && typeof estado === 'object' && 'aviso' in estado && typeof estado.aviso === 'string') {
    return estado.aviso;
  }
  return null;
}
