import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { BankingApiService } from '../core/api/banking-api.service';
import { ReconciliationApiService } from '../core/api/reconciliation-api.service';
import type {
  BankStatementImport,
  CompanyBankAccount,
  PendingBankTransaction,
  ReconciliationStatus,
  StatementFormat,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import {
  FILTRO_SENTIDO,
  OPCOES_FORMATO,
  ROTULO_CONCILIACAO,
  opcaoConta,
  problemaExtrato,
  severidadeConciliacao,
} from '../bancos/rotulos';
import {
  FILTRO_STATUS_PENDENTE,
  consultaPendentes,
  resumoIdentificacao,
  valorComSinal,
} from './rotulos';

/**
 * Importação de OFX/CSV e movimentos identificados (RF-071/RF-072 — UI-048).
 *
 * A importação é a mesma do módulo Bancos (`POST /banking/statements/import`),
 * que recusa arquivo repetido e não duplica lançamento de período sobreposto.
 * Depois dela a lista já entra recortada na conta e no período do extrato,
 * que é o que o usuário vai conciliar em seguida.
 *
 * A identificação (natureza, contraparte, parceiro) é gravada no movimento por
 * `POST .../identify`: ela registra o que se sabia quando a conciliação foi
 * decidida, e por isso é um clique, não um recálculo a cada leitura.
 */
@Component({
  selector: 'sge-pending-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    TagModule,
    Alert,
    DataTable,
    ErrorAlert,
    FilterBar,
    SelectField,
  ],
  template: `
    <p class="crumb">Conciliação / Movimentos</p>

    <div class="pagehead">
      <div>
        <h1>Movimentos a conciliar</h1>
        <p>Extratos OFX/CSV importados e a identificação de cada lançamento (RF-071/RF-072).</p>
      </div>
    </div>

    @if (podeImportar()) {
      <section class="card secao">
        <h2 class="secao__titulo">Importar extrato</h2>
        <div class="grade-campos">
          <sge-select-field
            rotulo="Conta"
            [obrigatorio]="true"
            [opcoes]="opcoesConta()"
            [ngModel]="contaImportacao()"
            (ngModelChange)="contaImportacao.set($event ?? '')"
          />
          <sge-select-field
            rotulo="Formato"
            placeholder="Detectar pelo conteúdo"
            [opcoes]="opcoesFormato"
            [ngModel]="formato()"
            (ngModelChange)="formato.set($event ?? '')"
          />
        </div>
        <div class="acoes-importacao">
          <label class="seletor" [class.seletor--inativo]="importando()">
            <i class="pi pi-paperclip" aria-hidden="true"></i>
            <span>{{ arquivo()?.name ?? 'Escolher arquivo OFX ou CSV' }}</span>
            <input
              type="file"
              accept=".ofx,.csv,.txt"
              [disabled]="importando()"
              (change)="escolherArquivo($event)"
            />
          </label>
          <p-button
            label="Importar"
            icon="pi pi-upload"
            [loading]="importando()"
            [disabled]="importando() || !arquivo() || !contaImportacao()"
            (onClick)="importar()"
          />
        </div>

        @if (problemaArquivo(); as texto) {
          <div class="espaco"><sge-alert tom="aviso" [titulo]="texto" /></div>
        }
        @if (erroImportacao(); as falha) {
          <div class="espaco"><sge-error-alert [erro]="falha" /></div>
        }
        @if (resultado(); as extrato) {
          <div class="espaco">
            <sge-alert
              tom="sucesso"
              [titulo]="resumoImportacao(extrato)"
              mensagem="A lista abaixo mostra os movimentos pendentes desta conta no período do extrato."
            />
          </div>
        }
      </section>
    }

    <div class="espaco">
      <sge-filter-bar
        placeholderBusca="Buscar por descrição, documento ou contraparte"
        [valores]="lista.filtros()"
        [filtros]="filtros()"
        [periodo]="true"
        (mudou)="lista.aplicarFiltros($event)"
      />
    </div>

    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }
    @if (erroAcao(); as falha) {
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
            ? 'Nenhum movimento atende aos filtros.'
            : 'Nenhum movimento pendente de conciliação.'
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
            <td>
              @if (identificacao(movimento); as texto) {
                {{ texto }}
              } @else {
                <span class="secundario">Não identificado</span>
              }
            </td>
            <td>
              <p-tag
                [value]="rotuloConciliacao(movimento.reconciliationStatus)"
                [severity]="severidade(movimento.reconciliationStatus)"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              @if (podeIdentificar()) {
                <p-button
                  [label]="identificacao(movimento) ? 'Reidentificar' : 'Identificar'"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  [loading]="identificando() === movimento.id"
                  [disabled]="!!identificando()"
                  (onClick)="identificar(movimento)"
                />
              }
              <p-button
                label="Conciliar"
                [text]="true"
                size="small"
                [routerLink]="['/conciliacao/movimentos', movimento.id]"
                [state]="{ descricao: movimento.description }"
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
    .acoes-importacao {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 0.75rem;
    }
    .seletor {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.45rem 0.8rem;
      font-size: 0.85rem;
      border: 1px dashed var(--p-content-border-color);
      border-radius: var(--p-content-border-radius);
      cursor: pointer;
    }
    .seletor input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .seletor--inativo {
      opacity: 0.6;
      pointer-events: none;
    }
  `,
})
export class PendingPage {
  private readonly api = inject(ReconciliationApiService);
  private readonly bancos = inject(BankingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas: Coluna[] = [
    { campo: 'movementDate', cabecalho: 'Data', largura: '7rem' },
    { campo: 'bankAccountId', cabecalho: 'Conta', largura: '10rem' },
    { campo: 'description', cabecalho: 'Descrição' },
    { campo: 'amount', cabecalho: 'Valor', largura: '9rem' },
    { campo: 'identification', cabecalho: 'Identificação', largura: '12rem' },
    { campo: 'reconciliationStatus', cabecalho: 'Situação', largura: '9rem' },
    { campo: 'acoes', cabecalho: '', largura: '13rem' },
  ];

  /** OFX e CSV: o CNAB 240 é importado pela tela de extratos do módulo Bancos. */
  protected readonly opcoesFormato = OPCOES_FORMATO.filter((opcao) => opcao.value !== 'CNAB240');

  protected readonly lista = new ListState<PendingBankTransaction>(
    (consulta) => this.api.listPending(consulta),
    consultaPendentes,
  );

  protected readonly contas = signal<CompanyBankAccount[]>([]);
  protected readonly contaImportacao = signal('');
  protected readonly formato = signal<StatementFormat | ''>('');
  protected readonly arquivo = signal<File | null>(null);
  protected readonly problemaArquivo = signal<string | null>(null);
  protected readonly importando = signal(false);
  protected readonly erroImportacao = signal<unknown>(null);
  protected readonly resultado = signal<BankStatementImport | null>(null);
  protected readonly identificando = signal<string | null>(null);
  protected readonly erroAcao = signal<unknown>(null);

  protected readonly opcoesConta = computed(() =>
    this.contas()
      .filter((c) => c.isActive)
      .map(opcaoConta),
  );

  protected readonly filtros = computed<DefinicaoFiltro[]>(() => {
    const base = [FILTRO_STATUS_PENDENTE, FILTRO_SENTIDO];
    const contas = this.contas();
    if (contas.length === 0) return base;
    return [
      ...base,
      { name: 'bankAccountId', label: 'Conta', placeholder: 'Conta', options: contas.map(opcaoConta) },
    ];
  });

  private readonly podeLerContas = () => this.permissoes.pode('company-bank-accounts:READ');
  /** Importar exige escolher a conta — e escolher exige ler as contas. */
  protected readonly podeImportar = () =>
    this.permissoes.pode('bank-statements:CREATE') && this.podeLerContas();
  protected readonly podeIdentificar = () => this.permissoes.pode('reconciliation:CREATE');

  constructor() {
    this.lista.carregar();
    if (this.podeLerContas()) {
      this.bancos
        .listAccounts({ pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        // As contas dão nome à coluna e ao filtro: sem elas a lista continua valendo.
        .subscribe({
          next: (resultado) => {
            this.contas.set(resultado.data);
            const padrao = resultado.data.find((c) => c.isDefault && c.isActive);
            if (padrao && !this.contaImportacao()) this.contaImportacao.set(padrao.id);
          },
          error: () => this.contas.set([]),
        });
    }
  }

  protected escolherArquivo(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const escolhido = entrada.files?.[0] ?? null;
    entrada.value = '';
    this.resultado.set(null);
    this.erroImportacao.set(null);
    this.selecionar(escolhido);
  }

  /** Separado do evento para que o teste escolha um arquivo sem montar `FileList`. */
  selecionar(arquivo: File | null): void {
    let problema = arquivo ? problemaExtrato(arquivo) : null;
    if (!problema && arquivo && !/\.(ofx|csv|txt)$/i.test(arquivo.name)) {
      problema = 'Nesta tela entram extratos OFX ou CSV.';
    }
    this.problemaArquivo.set(problema);
    this.arquivo.set(problema ? null : arquivo);
  }

  protected importar(): void {
    const arquivo = this.arquivo();
    const conta = this.contaImportacao();
    if (!arquivo || !conta || this.importando()) return;

    this.importando.set(true);
    this.erroImportacao.set(null);
    this.resultado.set(null);

    this.bancos
      .importStatement(arquivo, conta, this.formato() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (extrato) => {
          this.importando.set(false);
          this.arquivo.set(null);
          this.resultado.set(extrato);
          this.lista.aplicarFiltros({
            q: '',
            status: '',
            direction: '',
            bankAccountId: extrato.bankAccountId,
            from: extrato.periodStart?.slice(0, 10) ?? '',
            to: extrato.periodEnd?.slice(0, 10) ?? '',
          });
        },
        error: (falha: unknown) => {
          this.importando.set(false);
          this.erroImportacao.set(falha);
        },
      });
  }

  protected identificar(movimento: PendingBankTransaction): void {
    if (this.identificando()) return;
    this.identificando.set(movimento.id);
    this.erroAcao.set(null);

    this.api
      .identify(movimento.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ bankTransactionId, ...identificacao }) => {
          this.identificando.set(null);
          this.lista.linhas.update((linhas) =>
            linhas.map((linha) =>
              linha.id === bankTransactionId
                ? { ...linha, metadata: { ...(linha.metadata ?? {}), identification: identificacao } }
                : linha,
            ),
          );
        },
        error: (falha: unknown) => {
          this.identificando.set(null);
          this.erroAcao.set(falha);
        },
      });
  }

  protected resumoImportacao(extrato: BankStatementImport): string {
    const repetidos =
      extrato.duplicateCount > 0 ? `, ${extrato.duplicateCount} já existiam e foram ignorados` : '';
    return `${extrato.importedCount} de ${extrato.totalCount} lançamentos importados${repetidos}.`;
  }

  protected identificacao(movimento: PendingBankTransaction): string | null {
    return resumoIdentificacao(movimento);
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected valor(movimento: PendingBankTransaction): string {
    return valorComSinal(movimento);
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
