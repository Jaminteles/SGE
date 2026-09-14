import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { map } from 'rxjs/operators';

import { AccountingApiService } from '../core/api/accounting-api.service';
import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import type { TrialBalance, TrialBalanceRow } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { hoje, subtrair } from '../financeiro/dinheiro';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { LIMITE_BUSCA, SearchSelect } from '../ui/search-select';
import { TextField } from '../ui/text-field';
import { ROTULO_TIPO_CONTA, mesDaData, problemaRecorte, saldoInvertido } from './rotulos';

/**
 * Balancete de verificação (RF-084 — UI-057).
 *
 * Débitos e créditos do período precisam fechar: é essa igualdade que dá nome
 * ao relatório, e a tela a destaca. Cada conta leva ao razão com o mesmo
 * recorte, para achar onde o saldo deixou de bater.
 */
@Component({
  selector: 'sge-trial-balance-page',
  imports: [FormsModule, RouterLink, ButtonModule, CheckboxModule, Alert, ErrorAlert, SearchSelect, TextField],
  template: `
    <p class="crumb">Contábil / Balancete</p>

    <div class="pagehead">
      <div>
        <h1>Balancete de verificação</h1>
        <p>Saldo anterior, movimento e saldo final por conta, por período e centro de custo (RF-084).</p>
      </div>
    </div>

    <section class="card secao">
      <div class="grade-campos">
        <sge-text-field rotulo="De" tipo="date" [obrigatorio]="true" [ngModel]="de()" (ngModelChange)="de.set($event ?? '')" />
        <sge-text-field rotulo="Até" tipo="date" [obrigatorio]="true" [ngModel]="ate()" (ngModelChange)="ate.set($event ?? '')" />
        @if (podeLerCentros()) {
          <sge-search-select
            rotulo="Centro de custo"
            placeholder="Todos"
            [buscar]="buscarCentro"
            [ngModel]="centro() || null"
            (ngModelChange)="centro.set($event ?? '')"
          />
        }
      </div>
      <label class="marcador">
        <p-checkbox [binary]="true" [ngModel]="incluirZeradas()" (ngModelChange)="incluirZeradas.set($event)" />
        Incluir contas analíticas sem movimento e sem saldo
      </label>
      @if (problema(); as texto) {
        <p class="campo__erro">{{ texto }}</p>
      }
      <div class="acoes">
        <p-button label="Consultar" icon="pi pi-search" [loading]="carregando()" [disabled]="carregando() || !!problema()" (onClick)="consultar()" />
      </div>
    </section>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (balancete(); as b) {
      <div class="espaco">
        @if (b.balanced) {
          <sge-alert tom="sucesso" titulo="Débitos e créditos fecham" [mensagem]="'Total de ' + moeda(b.totalDebit) + ' em cada lado.'" />
        } @else {
          <sge-alert
            tom="erro"
            titulo="Balancete não fecha"
            [mensagem]="'Débitos ' + moeda(b.totalDebit) + ' × créditos ' + moeda(b.totalCredit) + ' — diferença de ' + moeda(diferenca(b)) + '. É problema de escrituração, não de apresentação.'"
          />
        }
      </div>

      <section class="card espaco">
        <div class="table-card__head">
          <h2>{{ data(b.range.from) }} a {{ data(b.range.to) }}</h2>
          <span class="table-card__count">
            {{ b.rows.length }} conta(s)
            @if (b.costCenterId) {
              · recortado por centro de custo
            }
          </span>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th>Conta</th>
                <th>Tipo</th>
                <th class="numero">Saldo anterior</th>
                <th class="numero">Débitos</th>
                <th class="numero">Créditos</th>
                <th class="numero">Saldo final</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (linha of b.rows; track linha.accountId) {
                <tr>
                  <td><span class="secundario-inline">{{ linha.code }}</span> {{ linha.name }}</td>
                  <td>{{ tipo(linha) }}</td>
                  <td class="numero" [class.saida]="invertido(linha.openingBalance)">{{ moeda(linha.openingBalance) }}</td>
                  <td class="numero">{{ moeda(linha.debit) }}</td>
                  <td class="numero">{{ moeda(linha.credit) }}</td>
                  <td class="numero" [class.saida]="invertido(linha.closingBalance)">{{ moeda(linha.closingBalance) }}</td>
                  <td class="acoes">
                    <p-button
                      label="Razão"
                      severity="secondary"
                      [text]="true"
                      size="small"
                      routerLink="/contabil/razao"
                      [queryParams]="parametrosRazao(linha, b)"
                    />
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="vazio">Nenhuma conta com saldo ou movimento no período.</td></tr>
              }
            </tbody>
            @if (b.rows.length > 0) {
              <tfoot>
                <tr class="total">
                  <td colspan="3">Totais do período</td>
                  <td class="numero">{{ moeda(b.totalDebit) }}</td>
                  <td class="numero">{{ moeda(b.totalCredit) }}</td>
                  <td colspan="2"></td>
                </tr>
              </tfoot>
            }
          </table>
        </div>
      </section>
    }
  `,
  styles: [
    ESTILO_TABELA,
    `
      .marcador {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0.5rem 0;
        font-size: 0.85rem;
      }
      .secundario-inline {
        color: var(--p-text-muted-color);
        font-variant-numeric: tabular-nums;
      }
      .total td {
        font-weight: 600;
      }
    `,
  ],
})
export class TrialBalancePage {
  private readonly api = inject(AccountingApiService);
  private readonly configuracoes = inject(ConfigurationsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly de = signal(mesDaData(hoje()).de);
  protected readonly ate = signal(mesDaData(hoje()).ate);
  protected readonly centro = signal('');
  protected readonly incluirZeradas = signal(false);
  protected readonly balancete = signal<TrialBalance | null>(null);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);

  protected readonly problema = computed(() => problemaRecorte(this.de(), this.ate()));

  protected readonly buscarCentro = (termo: string) =>
    this.configuracoes
      .listCostCenters({ q: termo, pageSize: LIMITE_BUSCA })
      .pipe(map((resultado) => resultado.data.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))));

  protected readonly podeLerCentros = () => this.permissoes.pode('cost-centers:READ');

  protected consultar(): void {
    if (this.problema()) return;
    this.carregando.set(true);
    this.erro.set(null);
    this.api
      .trialBalance({
        from: this.de(),
        to: this.ate(),
        costCenterId: this.centro() || undefined,
        includeZeroed: this.incluirZeradas() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (balancete) => {
          this.balancete.set(balancete);
          this.carregando.set(false);
        },
        error: (falha: unknown) => {
          this.balancete.set(null);
          this.erro.set(falha);
          this.carregando.set(false);
        },
      });
  }

  /** O razão abre com o mesmo recorte do balancete. */
  protected parametrosRazao(linha: TrialBalanceRow, balancete: TrialBalance): Record<string, string> {
    return {
      accountId: linha.accountId,
      from: balancete.range.from,
      to: balancete.range.to,
      ...(balancete.costCenterId ? { costCenterId: balancete.costCenterId } : {}),
    };
  }

  protected diferenca(balancete: TrialBalance): string {
    return subtrair(balancete.totalDebit, balancete.totalCredit);
  }

  protected tipo(linha: TrialBalanceRow): string {
    return ROTULO_TIPO_CONTA[linha.type] ?? linha.type;
  }

  protected invertido(valor: string): boolean {
    return saldoInvertido(valor);
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }
}
