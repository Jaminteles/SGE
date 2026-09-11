import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { BankingApiService } from '../core/api/banking-api.service';
import type {
  BankStatementImport,
  CompanyBankAccount,
  StatementFormat,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate, formatDateTime } from '../core/lib/format';
import { ListState, type Consulta } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import type { ValoresFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { OPCOES_FORMATO, ROTULO_FORMATO, opcaoConta, problemaExtrato } from './rotulos';

/** Traduz os filtros da tela para `QueryStatementImportDto`. */
export function consultaImportacao(filtros: ValoresFiltro): Consulta {
  return {
    bankAccountId: filtros['bankAccountId'] || undefined,
    periodFrom: filtros['from'] || undefined,
    periodTo: filtros['to'] || undefined,
  };
}

/**
 * Importação e consulta de extratos (RF-060/RF-071 — UI-046).
 *
 * A importação é síncrona no backend e devolve as contagens: quantos
 * lançamentos entraram e quantos já existiam. Reimportar o mesmo arquivo é
 * recusado (409) e períodos sobrepostos não duplicam lançamento — a tela só
 * mostra o que o servidor contou.
 */
@Component({
  selector: 'sge-statements-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    TagModule,
    Alert,
    DataTable,
    ErrorAlert,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Bancos / Extratos</p>

    <div class="pagehead">
      <div>
        <h1>Extratos bancários</h1>
        <p>Importação de OFX, CSV e CNAB 240 sem duplicar lançamentos (RF-060/RF-071).</p>
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
            <span>{{ arquivo()?.name ?? 'Escolher arquivo' }}</span>
            <input
              type="file"
              accept=".ofx,.csv,.txt,.ret,.rem,.cnab"
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
              [mensagem]="periodo(extrato)"
            />
            @if (podeVerMovimentos()) {
              <p-button
                label="Ver lançamentos importados"
                severity="secondary"
                [text]="true"
                size="small"
                routerLink="/bancos/movimentos"
                [queryParams]="{ statementImportId: extrato.id }"
              />
            }
          </div>
        }
      </section>
    }

    <section class="card secao espaco">
      <h2 class="secao__titulo">Importações realizadas</h2>
      <div class="filtros">
        @if (contas().length > 0) {
          <sge-select-field
            rotulo="Conta"
            placeholder="Todas"
            [opcoes]="opcoesConta()"
            [ngModel]="filtro('bankAccountId')"
            (ngModelChange)="filtrar('bankAccountId', $event ?? '')"
          />
        }
        <sge-text-field
          rotulo="Período a partir de"
          tipo="date"
          [ngModel]="filtro('from')"
          (ngModelChange)="filtrar('from', $event ?? '')"
        />
        <sge-text-field
          rotulo="Período até"
          tipo="date"
          [ngModel]="filtro('to')"
          (ngModelChange)="filtrar('to', $event ?? '')"
        />
      </div>
    </section>

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
        mensagemVazia="Nenhum extrato importado."
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-extrato>
          <tr>
            <td>{{ dataHora(extrato.createdAt) }}</td>
            <td>{{ nomeConta(extrato.bankAccountId) }}</td>
            <td>
              {{ extrato.fileName ?? '—' }}
              <span class="secundario">{{ formatoRotulo(extrato.format) }}</span>
            </td>
            <td>{{ periodo(extrato) }}</td>
            <td class="numero">
              {{ extrato.closingBalance ? moeda(extrato.closingBalance) : '—' }}
            </td>
            <td class="numero">
              {{ extrato.importedCount }} de {{ extrato.totalCount }}
              @if (extrato.duplicateCount > 0) {
                <span class="secundario">{{ extrato.duplicateCount }} já existiam</span>
              }
            </td>
            <td>
              <p-tag
                [value]="extrato.status === 'CONCLUIDO' ? 'Concluída' : extrato.status"
                [severity]="extrato.status === 'CONCLUIDO' ? 'success' : 'warn'"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              @if (podeVerMovimentos()) {
                <p-button
                  label="Lançamentos"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  routerLink="/bancos/movimentos"
                  [queryParams]="{ statementImportId: extrato.id }"
                />
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
    .filtros {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
      gap: 0.75rem;
    }
  `,
})
export class StatementsPage {
  private readonly api = inject(BankingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas: Coluna[] = [
    { campo: 'createdAt', cabecalho: 'Importado em', largura: '9rem' },
    { campo: 'bankAccountId', cabecalho: 'Conta', largura: '11rem' },
    { campo: 'fileName', cabecalho: 'Arquivo' },
    { campo: 'period', cabecalho: 'Período', largura: '11rem' },
    { campo: 'closingBalance', cabecalho: 'Saldo final', largura: '9rem' },
    { campo: 'importedCount', cabecalho: 'Lançamentos', largura: '9rem' },
    { campo: 'status', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '8rem' },
  ];

  protected readonly opcoesFormato = OPCOES_FORMATO;

  protected readonly lista = new ListState<BankStatementImport>(
    (consulta) => this.api.listStatements(consulta),
    consultaImportacao,
  );

  protected readonly contas = signal<CompanyBankAccount[]>([]);
  protected readonly contaImportacao = signal('');
  protected readonly formato = signal<StatementFormat | ''>('');
  protected readonly arquivo = signal<File | null>(null);
  protected readonly problemaArquivo = signal<string | null>(null);
  protected readonly importando = signal(false);
  protected readonly erroImportacao = signal<unknown>(null);
  protected readonly resultado = signal<BankStatementImport | null>(null);

  protected readonly opcoesConta = computed(() =>
    this.contas()
      .filter((c) => c.isActive)
      .map(opcaoConta),
  );

  protected readonly podeLerContas = () => this.permissoes.pode('company-bank-accounts:READ');
  /** Importar exige escolher a conta — e escolher exige ler as contas. */
  protected readonly podeImportar = () =>
    this.permissoes.pode('bank-statements:CREATE') && this.podeLerContas();
  protected readonly podeVerMovimentos = () => this.permissoes.pode('bank-statements:READ');

  constructor() {
    this.lista.carregar();
    if (this.podeLerContas()) {
      this.api
        .listAccounts({ pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
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
    const problema = arquivo ? problemaExtrato(arquivo) : null;
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

    this.api
      .importStatement(arquivo, conta, this.formato() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (extrato) => {
          this.importando.set(false);
          this.arquivo.set(null);
          this.resultado.set(extrato);
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.importando.set(false);
          this.erroImportacao.set(falha);
        },
      });
  }

  /** Valor atual de um filtro, vazio quando ausente. */
  protected filtro(nome: string): string {
    return this.lista.filtros()[nome] || '';
  }

  protected filtrar(campo: string, valor: string): void {
    this.lista.aplicarFiltros({ ...this.lista.filtros(), [campo]: valor });
  }

  protected resumoImportacao(extrato: BankStatementImport): string {
    const repetidos =
      extrato.duplicateCount > 0 ? `, ${extrato.duplicateCount} já existiam e foram ignorados` : '';
    return `${extrato.importedCount} de ${extrato.totalCount} lançamentos importados${repetidos}.`;
  }

  protected periodo(extrato: BankStatementImport): string {
    if (!extrato.periodStart && !extrato.periodEnd) return 'Período não informado no arquivo';
    return `${formatDate(extrato.periodStart) || '—'} a ${formatDate(extrato.periodEnd) || '—'}`;
  }

  protected nomeConta(id: string): string {
    return this.contas().find((c) => c.id === id)?.description ?? '—';
  }

  protected formatoRotulo(formato: StatementFormat): string {
    return ROTULO_FORMATO[formato] ?? formato;
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }
}
