import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';

import { FiscalApiService } from '../core/api/fiscal-api.service';
import type {
  FiscalAssessmentReport,
  FiscalDirection,
  FiscalLedgerReport,
} from '../core/api/types';
import { formatCurrency } from '../core/lib/decimal';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { mesDaData } from '../contabil/rotulos';
import { hoje } from '../financeiro/dinheiro';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { OPCOES_SENTIDO, problemaRecorteFiscal, rotuloSentido } from './tributos';

type Relatorio = 'apuracao' | 'livro';

const OPCOES_RELATORIO = [
  { value: 'apuracao', label: 'Apuração por competência' },
  { value: 'livro', label: 'Livro de entradas e saídas' },
];

/**
 * Apuração e livro fiscal (RF-093 — UI-064).
 *
 * O período é obrigatório: relatório fiscal sem período é a base inteira da
 * empresa, e o custo cresce com o histórico. A apuração se entrega por
 * competência, e é por competência que se consulta.
 *
 * Os totais nunca somam entrada com saída. O imposto da entrada é crédito e o
 * da saída é débito: somá-los produziria um número que não é a apuração de
 * nada.
 */
@Component({
  selector: 'sge-fiscal-reports-page',
  imports: [FormsModule, ButtonModule, Alert, ErrorAlert, SelectField, TextField],
  template: `
    <p class="crumb">Fiscal / Relatórios</p>

    <div class="pagehead">
      <div>
        <h1>Relatórios fiscais</h1>
        <p>Apuração por competência e livro de entradas e saídas por CFOP e NCM (RF-093).</p>
      </div>
    </div>

    <div class="card espaco barra">
      <sge-select-field
        rotulo="Relatório"
        [obrigatorio]="true"
        [opcoes]="opcoesRelatorio"
        [ngModel]="relatorio()"
        (ngModelChange)="trocarRelatorio($event ?? 'apuracao')"
      />
      <sge-text-field
        rotulo="De"
        tipo="date"
        [obrigatorio]="true"
        [ngModel]="de()"
        (ngModelChange)="de.set($event ?? '')"
      />
      <sge-text-field
        rotulo="Até"
        tipo="date"
        [obrigatorio]="true"
        [ngModel]="ate()"
        (ngModelChange)="ate.set($event ?? '')"
      />
      <sge-select-field
        rotulo="Sentido"
        placeholder="Entradas e saídas"
        [opcoes]="opcoesSentido"
        [ngModel]="sentido()"
        (ngModelChange)="sentido.set($event)"
      />
      @if (relatorio() === 'livro') {
        <sge-text-field
          rotulo="CFOP"
          [ngModel]="cfop()"
          (ngModelChange)="cfop.set($event ?? '')"
        />
        <sge-text-field rotulo="NCM" [ngModel]="ncm()" (ngModelChange)="ncm.set($event ?? '')" />
      }
      <p-button
        label="Consultar"
        icon="pi pi-search"
        [loading]="carregando()"
        [disabled]="carregando() || !!problema()"
        (onClick)="consultar()"
      />
    </div>

    @if (problema(); as texto) {
      <div class="espaco"><sge-alert tom="aviso" [titulo]="texto" /></div>
    }
    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (relatorio() === 'apuracao') {
      @if (apuracao(); as dados) {
        <div class="kpis espaco">
          @for (total of totais(); track total.sentido) {
            <div class="kpi">
              <span class="kpi__label">{{ total.rotulo }}</span>
              <span class="kpi__value">{{ moeda(total.icms) }}</span>
              <span class="kpi__detail kpi__detail--neutral">
                {{ total.documentos }} documento(s) · total {{ moeda(total.valor) }}
              </span>
            </div>
          }
        </div>

        <section class="card espaco">
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
                  <th class="numero" scope="col">ICMS ST</th>
                  <th class="numero" scope="col">IPI</th>
                  <th class="numero" scope="col">PIS</th>
                  <th class="numero" scope="col">COFINS</th>
                  <th class="numero" scope="col">ISS</th>
                </tr>
              </thead>
              <tbody>
                @for (linha of dados.rows; track linha.competence + linha.direction + linha.model) {
                  <tr>
                    <td>{{ linha.competence }}</td>
                    <td>{{ sentidoLegivel(linha.direction) }}</td>
                    <td>{{ linha.model }}</td>
                    <td class="numero">{{ linha.documents }}</td>
                    <td class="numero">{{ moeda(linha.totalAmount) }}</td>
                    <td class="numero">{{ moeda(linha.icmsAmount) }}</td>
                    <td class="numero">{{ moeda(linha.icmsStAmount) }}</td>
                    <td class="numero">{{ moeda(linha.ipiAmount) }}</td>
                    <td class="numero">{{ moeda(linha.pisAmount) }}</td>
                    <td class="numero">{{ moeda(linha.cofinsAmount) }}</td>
                    <td class="numero">{{ moeda(linha.issAmount) }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="11" class="vazio">
                      Nenhum documento fiscal na competência consultada.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    } @else if (livro(); as dados) {
      <section class="card espaco">
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
                <th class="numero" scope="col">ICMS ST</th>
                <th class="numero" scope="col">IPI</th>
                <th class="numero" scope="col">PIS</th>
                <th class="numero" scope="col">COFINS</th>
              </tr>
            </thead>
            <tbody>
              @for (
                linha of dados.rows;
                track linha.competence + linha.direction + linha.cfop + linha.ncm
              ) {
                <tr>
                  <td>{{ linha.competence }}</td>
                  <td>{{ sentidoLegivel(linha.direction) }}</td>
                  <td class="codigo">{{ linha.cfop ?? '—' }}</td>
                  <td class="codigo">{{ linha.ncm ?? '—' }}</td>
                  <td class="numero">{{ linha.items }}</td>
                  <td class="numero">{{ moeda(linha.totalAmount) }}</td>
                  <td class="numero">{{ moeda(linha.icmsBase) }}</td>
                  <td class="numero">{{ moeda(linha.icmsAmount) }}</td>
                  <td class="numero">{{ moeda(linha.icmsStAmount) }}</td>
                  <td class="numero">{{ moeda(linha.ipiAmount) }}</td>
                  <td class="numero">{{ moeda(linha.pisAmount) }}</td>
                  <td class="numero">{{ moeda(linha.cofinsAmount) }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="12" class="vazio">Nenhum item fiscal no recorte consultado.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
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
      .codigo {
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class FiscalReportsPage {
  private readonly api = inject(FiscalApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly opcoesRelatorio = OPCOES_RELATORIO;
  protected readonly opcoesSentido = OPCOES_SENTIDO;
  protected readonly moeda = formatCurrency;
  protected readonly sentidoLegivel = rotuloSentido;

  private readonly mes = mesDaData(hoje());

  protected readonly relatorio = signal<Relatorio>('apuracao');
  protected readonly de = signal(this.mes.de);
  protected readonly ate = signal(this.mes.ate);
  protected readonly sentido = signal<string | null>(null);
  protected readonly cfop = signal('');
  protected readonly ncm = signal('');

  protected readonly apuracao = signal<FiscalAssessmentReport | null>(null);
  protected readonly livro = signal<FiscalLedgerReport | null>(null);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);

  protected readonly problema = computed(() => problemaRecorteFiscal(this.de(), this.ate()));

  /** Entrada e saída ficam em colunas separadas: crédito e débito não se somam. */
  protected readonly totais = computed(() => {
    const dados = this.apuracao();
    if (!dados) return [];
    return Object.entries(dados.totals)
      .filter(([, total]) => total.documents > 0)
      .map(([sentido, total]) => ({
        sentido,
        rotulo: `${rotuloSentido(sentido)} — ICMS`,
        icms: total.icmsAmount,
        valor: total.totalAmount,
        documentos: total.documents,
      }));
  });

  constructor() {
    this.consultar();
  }

  protected trocarRelatorio(valor: string): void {
    this.relatorio.set(valor as Relatorio);
    this.consultar();
  }

  protected consultar(): void {
    if (this.carregando() || this.problema()) return;

    const recorte = {
      from: this.de(),
      to: this.ate(),
      ...(this.sentido() ? { direction: this.sentido() as FiscalDirection } : {}),
    };

    this.carregando.set(true);
    this.erro.set(null);

    if (this.relatorio() === 'apuracao') {
      this.api
        .assessment(recorte)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (dados) => {
            this.apuracao.set(dados);
            this.livro.set(null);
            this.carregando.set(false);
          },
          error: (falha: unknown) => this.falhar(falha),
        });
      return;
    }

    this.api
      .ledger({
        ...recorte,
        ...(this.cfop().trim() ? { cfop: this.cfop().trim() } : {}),
        ...(this.ncm().trim() ? { ncm: this.ncm().trim() } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dados) => {
          this.livro.set(dados);
          this.apuracao.set(null);
          this.carregando.set(false);
        },
        error: (falha: unknown) => this.falhar(falha),
      });
  }

  private falhar(falha: unknown): void {
    this.apuracao.set(null);
    this.livro.set(null);
    this.erro.set(falha);
    this.carregando.set(false);
  }
}
