import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { of } from 'rxjs';
import { map } from 'rxjs/operators';

import { AccountingApiService } from '../core/api/accounting-api.service';
import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import type { LedgerAccountNode, LedgerReport } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { hoje } from '../financeiro/dinheiro';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { LIMITE_BUSCA, SearchSelect } from '../ui/search-select';
import { TextField } from '../ui/text-field';
import {
  ROTULO_NATUREZA,
  contasAnaliticas,
  filtrarOpcoes,
  mesDaData,
  opcaoContaContabil,
  problemaRecorte,
  rotuloOrigemLancamento,
  saldoInvertido,
} from './rotulos';

/** Linhas por página do razão (`QueryLedgerDto.limit`, teto 500). */
export const LINHAS_RAZAO = 200;

/**
 * Razão de uma conta (RF-083 — UI-057).
 *
 * Saldo anterior, movimento linha a linha com saldo corrido e saldo final — é o
 * que se confere quando um saldo não bate. O recorte por centro de custo vale
 * para os três números; o saldo final vem do servidor e não muda com a página.
 *
 * Entra pré-filtrado quando vem do balancete (`?accountId=&from=&to=`).
 */
@Component({
  selector: 'sge-ledger-page',
  imports: [FormsModule, ButtonModule, Alert, ErrorAlert, SearchSelect, TextField],
  template: `
    <p class="crumb">Contábil / Razão</p>

    <div class="pagehead">
      <div>
        <h1>Razão</h1>
        <p>Movimento de uma conta com saldo anterior e saldo corrido, por período e centro de custo (RF-083).</p>
      </div>
    </div>

    @if (!podeLerPlano() && !conta()) {
      <sge-alert
        tom="info"
        titulo="Escolha a conta pelo balancete"
        mensagem="Sem acesso ao plano de contas, o razão é aberto a partir de uma linha do balancete."
      />
    }

    <section class="card secao">
      <div class="grade-campos">
        @if (podeLerPlano()) {
          <sge-search-select
            rotulo="Conta analítica"
            [obrigatorio]="true"
            [buscar]="buscarConta"
            [resolver]="resolverConta"
            [ngModel]="conta() || null"
            (ngModelChange)="conta.set($event ?? '')"
          />
        }
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
      @if (problema(); as texto) {
        <p class="campo__erro">{{ texto }}</p>
      }
      <div class="acoes">
        <p-button label="Consultar" icon="pi pi-search" [loading]="carregando()" [disabled]="carregando() || !!problema()" (onClick)="consultar(0)" />
      </div>
    </section>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (razao(); as r) {
      <section class="card espaco">
        <div class="table-card__head">
          <h2>{{ r.account.code }} — {{ r.account.name }}</h2>
          <span class="table-card__count">
            Natureza {{ natureza(r) }} · {{ data(r.range.from) }} a {{ data(r.range.to) }}
            @if (r.costCenterId) {
              · recortado por centro de custo
            }
          </span>
        </div>

        <div class="kpis resumo">
          <div class="kpi"><span class="kpi__label">Saldo anterior</span><span class="kpi__value">{{ moeda(r.openingBalance) }}</span></div>
          <div class="kpi"><span class="kpi__label">Débitos</span><span class="kpi__value">{{ moeda(r.totalDebit) }}</span></div>
          <div class="kpi"><span class="kpi__label">Créditos</span><span class="kpi__value">{{ moeda(r.totalCredit) }}</span></div>
          <div class="kpi">
            <span class="kpi__label">Saldo final</span>
            <span class="kpi__value" [class.saida]="invertido(r.closingBalance)">{{ moeda(r.closingBalance) }}</span>
          </div>
        </div>

        @if (invertido(r.closingBalance)) {
          <sge-alert
            tom="aviso"
            titulo="Saldo contrário à natureza da conta"
            mensagem="Saldo negativo numa conta de natureza definida costuma indicar lançamento no lado errado."
          />
        }

        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">Competência</th>
                <th scope="col">Nº</th>
                <th scope="col">Histórico</th>
                <th scope="col">Origem</th>
                <th class="numero" scope="col">Débito</th>
                <th class="numero" scope="col">Crédito</th>
                <th class="numero" scope="col">Saldo</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of r.rows; track $index) {
                <tr>
                  <td>{{ data(linha.competenceDate) }}</td>
                  <td>{{ linha.entryNumber }}</td>
                  <td>
                    {{ linha.history }}
                    @if (linha.extraHistory) {
                      <span class="secundario">{{ linha.extraHistory }}</span>
                    }
                  </td>
                  <td>{{ origem(linha.origin) }}</td>
                  <td class="numero">{{ valorOuVazio(linha.debit) }}</td>
                  <td class="numero">{{ valorOuVazio(linha.credit) }}</td>
                  <td class="numero" [class.saida]="invertido(linha.balance)">{{ moeda(linha.balance) }}</td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="vazio">Sem movimento na conta neste período.</td></tr>
              }
            </tbody>
          </table>
        </div>

        @if (offset() > 0 || r.rows.length === linhasPorPagina) {
          <div class="acoes paginacao">
            <p-button label="Anteriores" severity="secondary" [text]="true" [disabled]="offset() === 0 || carregando()" (onClick)="consultar(offset() - linhasPorPagina)" />
            <span class="secundario">Linhas {{ offset() + 1 }} a {{ offset() + r.rows.length }}</span>
            <p-button label="Seguintes" severity="secondary" [text]="true" [disabled]="r.rows.length < linhasPorPagina || carregando()" (onClick)="consultar(offset() + linhasPorPagina)" />
          </div>
        }
      </section>
    }
  `,
  styles: [
    ESTILO_TABELA,
    `
      .resumo {
        margin: 0.75rem 0;
      }
      .paginacao {
        justify-content: center;
        align-items: center;
        margin-top: 0.5rem;
      }
    `,
  ],
})
export class LedgerPage {
  private readonly api = inject(AccountingApiService);
  private readonly configuracoes = inject(ConfigurationsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly linhasPorPagina = LINHAS_RAZAO;

  protected readonly conta = signal('');
  protected readonly de = signal('');
  protected readonly ate = signal('');
  protected readonly centro = signal('');
  protected readonly offset = signal(0);
  protected readonly razao = signal<LedgerReport | null>(null);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);

  private readonly plano = signal<LedgerAccountNode[]>([]);
  private readonly opcoesConta = computed(() => contasAnaliticas(this.plano()).map(opcaoContaContabil));

  protected readonly problema = computed(() =>
    this.conta() ? problemaRecorte(this.de(), this.ate()) : 'Escolha a conta.',
  );

  protected readonly buscarConta = (termo: string) => of(filtrarOpcoes(this.opcoesConta(), termo));
  protected readonly resolverConta = (id: string) =>
    of(this.opcoesConta().find((opcao) => opcao.value === id) ?? { value: id, label: 'Conta selecionada' });
  protected readonly buscarCentro = (termo: string) =>
    this.configuracoes
      .listCostCenters({ q: termo, pageSize: LIMITE_BUSCA })
      .pipe(map((resultado) => resultado.data.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))));

  protected readonly podeLerPlano = () => this.permissoes.pode('ledger-accounts:READ');
  protected readonly podeLerCentros = () => this.permissoes.pode('cost-centers:READ');

  constructor() {
    const parametros = this.rota.snapshot.queryParamMap;
    const mes = mesDaData(hoje());
    this.conta.set(parametros.get('accountId') ?? '');
    this.de.set(parametros.get('from') ?? mes.de);
    this.ate.set(parametros.get('to') ?? mes.ate);
    this.centro.set(parametros.get('costCenterId') ?? '');

    if (this.podeLerPlano()) {
      this.api
        .tree()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (plano) => this.plano.set(plano), error: () => this.plano.set([]) });
    }
    if (this.conta()) this.consultar(0);
  }

  protected consultar(offset: number): void {
    if (this.problema()) return;
    this.carregando.set(true);
    this.erro.set(null);
    this.offset.set(Math.max(0, offset));
    this.api
      .ledger({
        accountId: this.conta(),
        from: this.de(),
        to: this.ate(),
        costCenterId: this.centro() || undefined,
        limit: LINHAS_RAZAO,
        offset: this.offset() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (razao) => {
          this.razao.set(razao);
          this.carregando.set(false);
        },
        error: (falha: unknown) => {
          this.razao.set(null);
          this.erro.set(falha);
          this.carregando.set(false);
        },
      });
  }

  protected natureza(razao: LedgerReport): string {
    return (ROTULO_NATUREZA[razao.account.nature] ?? razao.account.nature).toLowerCase();
  }

  protected origem(origem: string | null): string {
    return rotuloOrigemLancamento(origem);
  }

  protected invertido(valor: string): boolean {
    return saldoInvertido(valor);
  }

  protected valorOuVazio(valor: string): string {
    return /^0+(\.0+)?$/.test(valor) ? '' : formatCurrency(valor);
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }
}
