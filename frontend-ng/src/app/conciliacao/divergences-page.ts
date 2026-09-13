import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';

import { BankingApiService } from '../core/api/banking-api.service';
import { ReconciliationApiService, type DivergenceQuery } from '../core/api/reconciliation-api.service';
import type {
  CompanyBankAccount,
  DivergenceMovementSummary,
  ReconciliationDivergences,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { opcaoConta } from '../bancos/rotulos';
import { ErrorAlert } from '../ui/error-alert';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { ESTILO_TABELA, valorComSinal } from './rotulos';

/** Filtros do painel, na forma de `QueryDivergenceDto`. Vazio não vai na URL. */
export function consultaDivergencias(filtros: { conta: string; de: string; ate: string }): DivergenceQuery {
  return {
    bankAccountId: filtros.conta || undefined,
    from: filtros.de || undefined,
    to: filtros.ate || undefined,
  };
}

/**
 * Painel de divergências entre extrato e lançamentos (RF-076 — UI-052).
 *
 * Quatro perguntas, cada uma um problema diferente: extrato sem lançamento,
 * extrato atribuído em parte, vínculo aceito com diferença e — a mais grave —
 * baixa lançada que o extrato não confirma. O servidor devolve totais e uma
 * amostra de até 50 linhas; quem investiga desce para o movimento.
 */
@Component({
  selector: 'sge-divergences-page',
  imports: [FormsModule, RouterLink, ButtonModule, ErrorAlert, SelectField, TextField],
  template: `
    <p class="crumb">Conciliação / Divergências</p>

    <div class="pagehead">
      <div>
        <h1>Divergências da conciliação</h1>
        <p>O que o extrato e os lançamentos não confirmam um do outro (RF-076).</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Atualizar"
          icon="pi pi-refresh"
          severity="secondary"
          [outlined]="true"
          [loading]="carregando()"
          (onClick)="carregar()"
        />
      </div>
    </div>

    <section class="card secao">
      <div class="filtros">
        @if (contas().length > 0) {
          <sge-select-field
            rotulo="Conta"
            placeholder="Todas"
            [opcoes]="opcoesConta()"
            [ngModel]="filtros().conta"
            (ngModelChange)="filtrar('conta', $event ?? '')"
          />
        }
        <sge-text-field rotulo="De" tipo="date" [ngModel]="filtros().de" (ngModelChange)="filtrar('de', $event ?? '')" />
        <sge-text-field rotulo="Até" tipo="date" [ngModel]="filtros().ate" (ngModelChange)="filtrar('ate', $event ?? '')" />
      </div>
    </section>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (painel(); as p) {
      <div class="kpis espaco">
        <div class="kpi">
          <span class="kpi__label">Extrato sem lançamento</span>
          <span class="kpi__value">{{ p.unreconciled.count }}</span>
          <span class="kpi__detail" [class.kpi__detail--warn]="p.unreconciled.count > 0">{{ totais(p.unreconciled) }}</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Conciliado em parte</span>
          <span class="kpi__value">{{ p.partiallyReconciled.count }}</span>
          <span class="kpi__detail" [class.kpi__detail--warn]="p.partiallyReconciled.count > 0">
            {{ totais(p.partiallyReconciled) }}
          </span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Vínculos com diferença</span>
          <span class="kpi__value">{{ p.divergentLinks.count }}</span>
          <span class="kpi__detail kpi__detail--neutral">Aceitos com justificativa</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Baixa sem movimento</span>
          <span class="kpi__value">{{ p.settlementsWithoutMovement.count }}</span>
          <span class="kpi__detail" [class.kpi__detail--bad]="p.settlementsWithoutMovement.count > 0">
            Entre as 500 baixas mais recentes
          </span>
        </div>
      </div>

      <section class="card secao espaco">
        <h2 class="secao__titulo">Saldo informado pelo banco</h2>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th>Conta</th>
                <th class="numero">Saldo</th>
                <th>Data do saldo</th>
                <th class="numero">Pendentes</th>
                <th class="numero">Valor pendente</th>
              </tr>
            </thead>
            <tbody>
              @for (conta of p.accounts; track conta.id) {
                <tr>
                  <td>
                    {{ conta.description }}
                    <span class="secundario">{{ conta.bankCode }} · Ag {{ conta.agency }} · Conta {{ conta.account }}</span>
                  </td>
                  <td class="numero">{{ moeda(conta.currentBalance) }}</td>
                  <td>{{ conta.balanceDate ? data(conta.balanceDate) : '—' }}</td>
                  <td class="numero">{{ conta.pendingCount }}</td>
                  <td class="numero">{{ moeda(conta.pendingAmount) }}</td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="vazio">Nenhuma conta ativa.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="card secao espaco">
        <h2 class="secao__titulo">Baixas sem movimento no extrato</h2>
        <p class="secundario">Lançamos, o banco não confirmou: pagamento considerado feito que não aparece no extrato.</p>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th>Data da baixa</th>
                <th>Conta</th>
                <th class="numero">Valor</th>
              </tr>
            </thead>
            <tbody>
              @for (baixa of p.settlementsWithoutMovement.sample; track baixa.id) {
                <tr>
                  <td>{{ data(baixa.settlementDate) }}</td>
                  <td>{{ nomeConta(baixa.bankAccountId) }}</td>
                  <td class="numero">{{ moeda(baixa.totalAmount) }}</td>
                </tr>
              } @empty {
                <tr><td colspan="3" class="vazio">Toda baixa em conta bancária tem movimento conciliado.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      @for (grupo of gruposMovimento(); track grupo.titulo) {
        <section class="card secao espaco">
          <h2 class="secao__titulo">{{ grupo.titulo }}</h2>
          <div class="tabela-rolagem">
            <table class="tabela">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Conta</th>
                  <th>Descrição</th>
                  <th class="numero">Valor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (mov of grupo.resumo.sample; track mov.id) {
                  <tr>
                    <td>{{ data(mov.movementDate) }}</td>
                    <td>{{ nomeConta(mov.bankAccountId) }}</td>
                    <td>{{ mov.description ?? '—' }}</td>
                    <td class="numero" [class.saida]="mov.direction === 'DEBITO'">{{ valorSinal(mov) }}</td>
                    <td class="acoes">
                      <p-button
                        label="Conciliar"
                        [text]="true"
                        size="small"
                        [routerLink]="['/conciliacao/movimentos', mov.id]"
                        [state]="{ descricao: mov.description }"
                      />
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="vazio">{{ grupo.vazio }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <section class="card secao espaco">
        <h2 class="secao__titulo">Vínculos aceitos com diferença</h2>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th>Movimento</th>
                <th>Descrição</th>
                <th class="numero">Conciliado</th>
                <th class="numero">Diferença</th>
                <th>Justificativa</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (vinculo of p.divergentLinks.sample; track vinculo.id) {
                <tr>
                  <td>{{ data(vinculo.bankTransaction.movementDate) }}</td>
                  <td>{{ vinculo.bankTransaction.description ?? '—' }}</td>
                  <td class="numero">{{ moeda(vinculo.reconciledAmount) }}</td>
                  <td class="numero">{{ moeda(vinculo.difference) }}</td>
                  <td>{{ vinculo.justification ?? '—' }}</td>
                  <td class="acoes">
                    <p-button
                      label="Abrir"
                      [text]="true"
                      size="small"
                      [routerLink]="['/conciliacao/movimentos', vinculo.bankTransactionId]"
                      [state]="{ descricao: vinculo.bankTransaction.description }"
                    />
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="vazio">Nenhum vínculo aceito com diferença.</td></tr>
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
      .filtros {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
        gap: 0.75rem;
      }
    `,
  ],
})
export class DivergencesPage {
  private readonly api = inject(ReconciliationApiService);
  private readonly bancos = inject(BankingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly contas = signal<CompanyBankAccount[]>([]);
  protected readonly filtros = signal({ conta: '', de: '', ate: '' });
  protected readonly painel = signal<ReconciliationDivergences | null>(null);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);
  /** Descarta a resposta de um filtro que já foi substituído. */
  private requisicao = 0;

  protected readonly opcoesConta = computed(() => this.contas().map(opcaoConta));

  protected readonly gruposMovimento = computed(() => {
    const p = this.painel();
    if (!p) return [];
    return [
      {
        titulo: 'Extrato sem lançamento',
        resumo: p.unreconciled,
        vazio: 'Todo movimento do período tem par ou foi marcado como sem par.',
      },
      {
        titulo: 'Extrato conciliado em parte',
        resumo: p.partiallyReconciled,
        vazio: 'Nenhum movimento com valor sobrando.',
      },
    ];
  });

  constructor() {
    this.carregar();
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

  protected filtrar(campo: 'conta' | 'de' | 'ate', valor: string): void {
    this.filtros.update((atual) => ({ ...atual, [campo]: valor }));
    this.carregar();
  }

  protected carregar(): void {
    const atual = ++this.requisicao;
    this.carregando.set(true);
    this.erro.set(null);

    this.api
      .divergences(consultaDivergencias(this.filtros()))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => {
          if (atual !== this.requisicao) return;
          this.carregando.set(false);
          this.painel.set(resultado);
        },
        error: (falha: unknown) => {
          if (atual !== this.requisicao) return;
          this.carregando.set(false);
          this.painel.set(null);
          this.erro.set(falha);
        },
      });
  }

  protected totais(resumo: DivergenceMovementSummary): string {
    return `Entradas ${formatCurrency(resumo.creditTotal)} · saídas ${formatCurrency(resumo.debitTotal)}`;
  }

  protected nomeConta(id: string | null): string {
    if (!id) return '—';
    return this.contas().find((c) => c.id === id)?.description ?? '—';
  }

  protected valorSinal(mov: { amount: string; direction: 'DEBITO' | 'CREDITO' }): string {
    return valorComSinal(mov);
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }
}
