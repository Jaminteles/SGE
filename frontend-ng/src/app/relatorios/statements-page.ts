import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { ReportingApiService } from '../core/api/reporting-api.service';
import type {
  AccountingStatementReport,
  FiscalStatementReport,
  ReportFormat,
  ReportKey,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { salvarArquivo } from '../fiscal/rotulos';
import { rotuloSentido } from '../fiscal/tributos';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { SelectField } from '../ui/select-field';
import {
  OPCOES_FORMATO,
  OPCOES_RELATORIO,
  PERMISSAO_ORIGEM,
  ROTULO_RELATORIO,
  ReportFilterStore,
  competenciaLegivel,
  paraConsulta,
  problemaFiltro,
} from './filtros';
import { ReportFilterBar } from './report-filter-bar';

/**
 * Relatórios contábeis e fiscais, com exportação (RF-111/RF-113 — UI-073).
 *
 * Nada é recalculado aqui: o balancete e a DRE vêm do M11, a apuração e o livro
 * fiscal vêm do M12. O M15 apenas os apresenta juntos — se recalculasse,
 * existiriam duas definições de "resultado do mês" e a primeira divergência
 * viraria discussão sobre qual relatório está certo.
 *
 * O M15 também não é caminho curto: cada peça continua exigindo a permissão do
 * módulo de origem, e a exportação exige `reports:EXPORT` **somada** a ela.
 */
@Component({
  selector: 'sge-statements-page',
  imports: [
    FormsModule,
    ButtonModule,
    TagModule,
    Alert,
    ErrorAlert,
    SelectField,
    ReportFilterBar,
  ],
  template: `
    <p class="crumb">Relatórios / Contábil e fiscal</p>

    <div class="pagehead">
      <div>
        <h1>Relatórios contábeis e fiscais</h1>
        <p>Balancete, DRE, apuração e livro fiscal do período (RF-111).</p>
      </div>
    </div>

    <sge-report-filter-bar />

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }
    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (podeExportar()) {
      <section class="card espaco barra">
        <sge-select-field
          rotulo="Relatório"
          [obrigatorio]="true"
          [opcoes]="opcoesRelatorio"
          [ngModel]="relatorio()"
          (ngModelChange)="relatorio.set($event ?? 'financeiro')"
        />
        <sge-select-field
          rotulo="Formato"
          [obrigatorio]="true"
          [opcoes]="opcoesFormato"
          [ngModel]="formato()"
          (ngModelChange)="formato.set($event ?? 'pdf')"
        />
        <p-button
          label="Exportar"
          icon="pi pi-download"
          [loading]="exportando()"
          [disabled]="exportando() || !!bloqueioExportacao()"
          (onClick)="exportar()"
        />
      </section>

      @if (bloqueioExportacao(); as texto) {
        <div class="espaco"><sge-alert tom="aviso" [titulo]="texto" /></div>
      }
    }

    @if (!podeLerContabil() && !podeLerFiscal()) {
      <div class="espaco">
        <sge-alert
          tom="info"
          titulo="Sem acesso às peças contábeis e fiscais"
          mensagem="Ler estes relatórios pelo módulo de Relatórios continua exigindo a permissão do módulo de origem."
        />
      </div>
    }

    @if (podeLerContabil()) {
      @if (contabil(); as peca) {
        <section class="card espaco">
          <div class="table-card__head">
            <h2>Balancete de verificação</h2>
            @if (peca.trialBalance.balanced) {
              <p-tag value="Débito = crédito" severity="success" [rounded]="true" />
            } @else {
              <p-tag value="Balancete não fecha" severity="danger" [rounded]="true" />
            }
          </div>
          <div class="tabela-rolagem">
            <table class="tabela">
              <thead>
                <tr>
                  <th scope="col">Conta</th>
                  <th class="numero" scope="col">Saldo anterior</th>
                  <th class="numero" scope="col">Débito</th>
                  <th class="numero" scope="col">Crédito</th>
                  <th class="numero" scope="col">Saldo final</th>
                </tr>
              </thead>
              <tbody>
                @for (linha of peca.trialBalance.rows; track linha.accountId) {
                  <tr>
                    <td>
                      <span class="codigo">{{ linha.code }}</span> {{ linha.name }}
                    </td>
                    <td class="numero">{{ moeda(linha.openingBalance) }}</td>
                    <td class="numero">{{ moeda(linha.debit) }}</td>
                    <td class="numero">{{ moeda(linha.credit) }}</td>
                    <td class="numero">{{ moeda(linha.closingBalance) }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="vazio">Nenhum movimento contábil no período.</td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td>Totais</td>
                  <td class="numero"></td>
                  <td class="numero">{{ moeda(peca.trialBalance.totalDebit) }}</td>
                  <td class="numero">{{ moeda(peca.trialBalance.totalCredit) }}</td>
                  <td class="numero"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section class="card espaco">
          <div class="table-card__head">
            <h2>Demonstração do resultado</h2>
          </div>
          <div class="kpis espaco-interno">
            <div class="kpi">
              <span class="kpi__label">Receita</span>
              <span class="kpi__value">{{ moeda(peca.incomeStatement.revenue.total) }}</span>
            </div>
            <div class="kpi">
              <span class="kpi__label">Custo</span>
              <span class="kpi__value">{{ moeda(peca.incomeStatement.cost.total) }}</span>
            </div>
            <div class="kpi">
              <span class="kpi__label">Despesa</span>
              <span class="kpi__value">{{ moeda(peca.incomeStatement.expense.total) }}</span>
            </div>
            <div class="kpi">
              <span class="kpi__label">Resultado líquido</span>
              <span class="kpi__value">{{ moeda(peca.incomeStatement.netResult) }}</span>
              <span class="kpi__detail kpi__detail--neutral">
                bruto {{ moeda(peca.incomeStatement.grossResult) }}
              </span>
            </div>
          </div>
        </section>
      }
    }

    @if (podeLerFiscal()) {
      @if (fiscal(); as peca) {
        <section class="card espaco">
          <div class="table-card__head">
            <h2>Apuração fiscal</h2>
            <span class="table-card__count">{{ peca.assessment.rows.length }} linha(s)</span>
          </div>
          <div class="tabela-rolagem">
            <table class="tabela">
              <thead>
                <tr>
                  <th scope="col">Competência</th>
                  <th scope="col">Sentido</th>
                  <th scope="col">Modelo</th>
                  <th class="numero" scope="col">Documentos</th>
                  <th class="numero" scope="col">Total</th>
                  <th class="numero" scope="col">ICMS</th>
                  <th class="numero" scope="col">IPI</th>
                  <th class="numero" scope="col">PIS/COFINS</th>
                </tr>
              </thead>
              <tbody>
                @for (linha of peca.assessment.rows; track $index) {
                  <tr>
                    <td>{{ competencia(linha.competence) }}</td>
                    <td>{{ sentido(linha.direction) }}</td>
                    <td>{{ linha.model }}</td>
                    <td class="numero">{{ linha.documents }}</td>
                    <td class="numero">{{ moeda(linha.totalAmount) }}</td>
                    <td class="numero">{{ moeda(linha.icmsAmount) }}</td>
                    <td class="numero">{{ moeda(linha.ipiAmount) }}</td>
                    <td class="numero">
                      {{ moeda(linha.pisAmount) }} / {{ moeda(linha.cofinsAmount) }}
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="8" class="vazio">Nenhum documento fiscal na competência.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="card espaco">
          <div class="table-card__head">
            <h2>Livro de entradas e saídas</h2>
            <span class="table-card__count">{{ peca.ledger.rows.length }} linha(s)</span>
          </div>
          <div class="tabela-rolagem">
            <table class="tabela">
              <thead>
                <tr>
                  <th scope="col">Competência</th>
                  <th scope="col">Sentido</th>
                  <th scope="col">CFOP</th>
                  <th scope="col">NCM</th>
                  <th class="numero" scope="col">Itens</th>
                  <th class="numero" scope="col">Total</th>
                  <th class="numero" scope="col">Base ICMS</th>
                  <th class="numero" scope="col">ICMS</th>
                </tr>
              </thead>
              <tbody>
                @for (linha of peca.ledger.rows; track $index) {
                  <tr>
                    <td>{{ competencia(linha.competence) }}</td>
                    <td>{{ sentido(linha.direction) }}</td>
                    <td class="codigo">{{ linha.cfop ?? '—' }}</td>
                    <td class="codigo">{{ linha.ncm ?? '—' }}</td>
                    <td class="numero">{{ linha.items }}</td>
                    <td class="numero">{{ moeda(linha.totalAmount) }}</td>
                    <td class="numero">{{ moeda(linha.icmsBase) }}</td>
                    <td class="numero">{{ moeda(linha.icmsAmount) }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="8" class="vazio">Nenhum item fiscal no período.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    }

    @if (carregando()) {
      <p class="secundario espaco">Carregando as peças do período…</p>
    }
  `,
  styles: [
    ESTILO_TABELA,
    `
      .barra {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 1rem;
        padding: 0.875rem;
      }
      .espaco-interno {
        padding: 0 0.875rem 0.875rem;
      }
      .codigo {
        color: var(--p-text-muted-color);
        font-variant-numeric: tabular-nums;
      }
      tfoot td {
        font-weight: 600;
      }
    `,
  ],
})
export class StatementsPage {
  private readonly api = inject(ReportingApiService);
  private readonly store = inject(ReportFilterStore);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly opcoesRelatorio = OPCOES_RELATORIO;
  protected readonly opcoesFormato = OPCOES_FORMATO;
  protected readonly moeda = formatCurrency;
  protected readonly competencia = competenciaLegivel;
  protected readonly sentido = rotuloSentido;

  protected readonly contabil = signal<AccountingStatementReport | null>(null);
  protected readonly fiscal = signal<FiscalStatementReport | null>(null);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly relatorio = signal<ReportKey>('financeiro');
  protected readonly formato = signal<ReportFormat>('pdf');
  protected readonly exportando = signal(false);

  protected readonly podeExportar = () => this.permissoes.pode('reports:EXPORT');
  protected readonly podeLerContabil = () =>
    this.permissoes.permite({ all: ['reports:READ', 'accounting-reports:READ'] });
  protected readonly podeLerFiscal = () =>
    this.permissoes.permite({ all: ['reports:READ', 'fiscal-reports:READ'] });

  /**
   * Exportar o relatório contábil ou fiscal exige a permissão do módulo de
   * origem além de `reports:EXPORT` — o aviso evita oferecer o que dá 403.
   */
  protected readonly bloqueioExportacao = computed(() => {
    const problema = problemaFiltro(this.store.filtro());
    if (problema) return problema;

    const exigida = PERMISSAO_ORIGEM[this.relatorio()];
    if (exigida && !this.permissoes.pode(exigida)) {
      return `${ROTULO_RELATORIO[this.relatorio()]} exige também a permissão do módulo de origem (${exigida}).`;
    }
    return null;
  });

  constructor() {
    effect(() => {
      this.store.filtro();
      untracked(() => this.carregar());
    });
  }

  protected exportar(): void {
    if (this.exportando() || this.bloqueioExportacao()) return;

    this.exportando.set(true);
    this.erro.set(null);
    this.api
      .export({
        ...paraConsulta(this.store.filtro()),
        report: this.relatorio(),
        format: this.formato(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (arquivo) => {
          this.exportando.set(false);
          salvarArquivo(arquivo.content, arquivo.filename);
          this.aviso.set(`${arquivo.filename} gerado.`);
        },
        error: (falha: unknown) => {
          this.exportando.set(false);
          this.erro.set(falha);
        },
      });
  }

  private carregar(): void {
    const consulta = this.store.consulta();
    this.erro.set(null);
    this.carregando.set(true);

    let pendentes = 0;
    const concluir = () => {
      pendentes -= 1;
      if (pendentes <= 0) this.carregando.set(false);
    };

    if (this.podeLerContabil()) {
      pendentes += 1;
      this.api
        .accounting(consulta)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (peca) => {
            this.contabil.set(peca);
            concluir();
          },
          error: (falha: unknown) => {
            this.contabil.set(null);
            this.erro.set(falha);
            concluir();
          },
        });
    }

    if (this.podeLerFiscal()) {
      pendentes += 1;
      this.api
        .fiscal(consulta)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (peca) => {
            this.fiscal.set(peca);
            concluir();
          },
          error: (falha: unknown) => {
            this.fiscal.set(null);
            this.erro.set(falha);
            concluir();
          },
        });
    }

    if (pendentes === 0) this.carregando.set(false);
  }
}
