import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { of } from 'rxjs';
import { map } from 'rxjs/operators';

import { AccountingApiService } from '../core/api/accounting-api.service';
import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import type { AccountingPeriod, JournalLineType, LedgerAccountNode } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { hoje, paraCentavos } from '../financeiro/dinheiro';
import { Alert } from '../ui/alert';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { LIMITE_BUSCA, SearchSelect } from '../ui/search-select';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  OPCOES_LADO,
  bloqueioDaCompetencia,
  competenciaEfetiva,
  contasAnaliticas,
  filtrarOpcoes,
  formLancamentoVazio,
  montarLancamento,
  opcaoContaContabil,
  partidaVazia,
  problemaLancamento,
  totaisPartidas,
  type FormLancamento,
  type FormPartida,
} from './rotulos';

/**
 * Lançamento manual de débito e crédito (RF-081 — UI-056).
 *
 * A soma aparece enquanto se digita, em centavos `bigint`: débito e crédito
 * precisam fechar no centavo, e o servidor confere de novo em Decimal. Só conta
 * analítica e ativa recebe partida.
 *
 * Competência em período fechado bloqueia o envio na tela (UI-059) — o servidor
 * recusaria de qualquer forma (RN-008), e dizer antes poupa o retrabalho.
 */
@Component({
  selector: 'sge-journal-entry-form-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    Alert,
    DecimalField,
    ErrorAlert,
    SearchSelect,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Contábil / Lançamentos / Novo</p>

    <div class="pagehead">
      <div>
        <h1>Novo lançamento contábil</h1>
        <p>Partida dobrada: a soma dos débitos precisa ser igual à dos créditos (RF-081).</p>
      </div>
    </div>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }
    @if (bloqueio(); as texto) {
      <div class="espaco">
        <sge-alert tom="aviso" titulo="Período bloqueado" [mensagem]="texto" />
      </div>
    }

    <section class="card secao espaco">
      <div class="grade-campos">
        <sge-text-field
          rotulo="Data do lançamento"
          tipo="date"
          [obrigatorio]="true"
          [ngModel]="form().entryDate"
          (ngModelChange)="mudar('entryDate', $event ?? '')"
        />
        <sge-text-field
          rotulo="Competência"
          tipo="date"
          dica="Em branco: a data do lançamento"
          [ngModel]="form().competenceDate"
          (ngModelChange)="mudar('competenceDate', $event ?? '')"
        />
        <sge-text-field rotulo="Lote" dica="Opcional, até 30 caracteres" [ngModel]="form().batch" (ngModelChange)="mudar('batch', $event ?? '')" />
      </div>
      <sge-text-field
        rotulo="Histórico"
        [obrigatorio]="true"
        dica="O que o lançamento registra"
        [ngModel]="form().history"
        (ngModelChange)="mudar('history', $event ?? '')"
      />
    </section>

    <section class="card secao espaco">
      <h2 class="secao__titulo">Partidas</h2>
      @for (partida of form().lines; track $index; let i = $index) {
        <div class="partida">
          <span class="partida__numero">{{ i + 1 }}</span>
          <sge-select-field
            rotulo="Lado"
            [obrigatorio]="true"
            [opcoes]="opcoesLado"
            [ngModel]="partida.type"
            (ngModelChange)="mudarPartida(i, 'type', $event ?? 'DEBITO')"
          />
          <sge-search-select
            class="partida__conta"
            rotulo="Conta analítica"
            [obrigatorio]="true"
            [buscar]="buscarConta"
            [ngModel]="partida.accountId || null"
            (ngModelChange)="mudarPartida(i, 'accountId', $event ?? '')"
          />
          <sge-decimal-field
            rotulo="Valor"
            [obrigatorio]="true"
            [ngModel]="partida.amount"
            (ngModelChange)="mudarPartida(i, 'amount', $event)"
          />
          @if (podeLerCentros()) {
            <sge-search-select
              rotulo="Centro de custo"
              placeholder="Nenhum"
              [buscar]="buscarCentro"
              [ngModel]="partida.costCenterId || null"
              (ngModelChange)="mudarPartida(i, 'costCenterId', $event ?? '')"
            />
          }
          <sge-text-field
            rotulo="Complemento"
            [ngModel]="partida.extraHistory"
            (ngModelChange)="mudarPartida(i, 'extraHistory', $event ?? '')"
          />
          <p-button
            icon="pi pi-trash"
            severity="secondary"
            [text]="true"
            [attr.aria-label]="'Remover partida ' + (i + 1)"
            [disabled]="form().lines.length <= 2"
            (onClick)="removerPartida(i)"
          />
        </div>
      }

      <div class="rodape">
        <div class="acoes">
          <p-button label="Débito" icon="pi pi-plus" severity="secondary" [outlined]="true" size="small" (onClick)="adicionarPartida('DEBITO')" />
          <p-button label="Crédito" icon="pi pi-plus" severity="secondary" [outlined]="true" size="small" (onClick)="adicionarPartida('CREDITO')" />
        </div>
        <dl class="totais" aria-live="polite">
          <div><dt>Débitos</dt><dd>{{ moeda(totais().debito) }}</dd></div>
          <div><dt>Créditos</dt><dd>{{ moeda(totais().credito) }}</dd></div>
          <div [class.totais--diferenca]="desbalanceado()">
            <dt>Diferença</dt>
            <dd>{{ moeda(totais().diferenca) }}</dd>
          </div>
        </dl>
      </div>
    </section>

    @if (tentouSalvar() && problema(); as texto) {
      <p class="campo__erro">{{ texto }}</p>
    }

    <div class="acoes espaco">
      <p-button label="Voltar" severity="secondary" [outlined]="true" routerLink="/contabil/lancamentos" [disabled]="salvando()" />
      <p-button
        label="Registrar lançamento"
        icon="pi pi-check"
        [loading]="salvando()"
        [disabled]="salvando() || !!bloqueio()"
        (onClick)="salvar()"
      />
    </div>
  `,
  styles: `
    .partida {
      display: grid;
      grid-template-columns: 1.5rem 8rem minmax(14rem, 2fr) 9rem minmax(10rem, 1fr) minmax(10rem, 1fr) auto;
      align-items: end;
      gap: 0.6rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .partida__numero {
      padding-bottom: 0.6rem;
      font-size: 0.8rem;
      color: var(--p-text-muted-color);
    }
    @media (max-width: 1100px) {
      .partida {
        grid-template-columns: 1fr 1fr;
      }
    }
    .rodape {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      margin-top: 0.75rem;
    }
    .totais {
      display: flex;
      gap: 1.5rem;
      margin: 0;
    }
    .totais dt {
      font-size: 0.7rem;
      color: var(--p-text-muted-color);
    }
    .totais dd {
      margin: 0;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .totais--diferenca dd {
      color: var(--p-red-600, var(--p-text-color));
    }
  `,
})
export class JournalEntryFormPage {
  private readonly api = inject(AccountingApiService);
  private readonly configuracoes = inject(ConfigurationsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly opcoesLado = OPCOES_LADO;

  protected readonly form = signal<FormLancamento>(formLancamentoVazio(hoje()));
  protected readonly tentouSalvar = signal(false);
  protected readonly salvando = signal(false);
  protected readonly erro = signal<unknown>(null);

  private readonly plano = signal<LedgerAccountNode[]>([]);
  /** `null` = sem permissão para ler períodos: quem responde é o servidor. */
  private readonly periodos = signal<AccountingPeriod[] | null>(null);
  private readonly opcoesConta = computed(() => contasAnaliticas(this.plano()).map(opcaoContaContabil));

  protected readonly totais = computed(() => totaisPartidas(this.form().lines));
  protected readonly desbalanceado = computed(() => paraCentavos(this.totais().diferenca) !== 0n);
  protected readonly problema = computed(() => problemaLancamento(this.form()));
  protected readonly bloqueio = computed(() =>
    bloqueioDaCompetencia(this.periodos(), competenciaEfetiva(this.form())),
  );

  protected readonly buscarConta = (termo: string) => of(filtrarOpcoes(this.opcoesConta(), termo));
  protected readonly buscarCentro = (termo: string) =>
    this.configuracoes
      .listCostCenters({ q: termo, isActive: true, pageSize: LIMITE_BUSCA })
      .pipe(map((resultado) => resultado.data.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }))));

  protected readonly podeLerCentros = () => this.permissoes.pode('cost-centers:READ');

  constructor() {
    this.api
      .tree()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (plano) => this.plano.set(plano), error: (falha: unknown) => this.erro.set(falha) });
    if (this.permissoes.pode('accounting-periods:READ')) {
      this.api
        .listPeriods()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (periodos) => this.periodos.set(periodos), error: () => this.periodos.set(null) });
    }
  }

  protected mudar<K extends keyof Omit<FormLancamento, 'lines'>>(campo: K, valor: FormLancamento[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarPartida<K extends keyof FormPartida>(indice: number, campo: K, valor: FormPartida[K]): void {
    this.form.update((atual) => ({
      ...atual,
      lines: atual.lines.map((linha, i) => (i === indice ? { ...linha, [campo]: valor } : linha)),
    }));
  }

  protected adicionarPartida(tipo: JournalLineType): void {
    this.form.update((atual) => ({ ...atual, lines: [...atual.lines, partidaVazia(tipo)] }));
  }

  protected removerPartida(indice: number): void {
    this.form.update((atual) =>
      atual.lines.length <= 2 ? atual : { ...atual, lines: atual.lines.filter((_, i) => i !== indice) },
    );
  }

  protected salvar(): void {
    this.tentouSalvar.set(true);
    // O botão desabilitado durante o envio evita o lançamento em dobro por
    // clique repetido: o lançamento manual não tem chave de idempotência.
    if (this.problema() || this.bloqueio() || this.salvando()) return;

    this.salvando.set(true);
    this.erro.set(null);
    this.api
      .createEntry(montarLancamento(this.form()))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lancamento) => {
          this.salvando.set(false);
          void this.router.navigate(['/contabil/lancamentos'], {
            state: { aviso: `Lançamento nº ${lancamento.number} registrado.` },
          });
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erro.set(falha);
        },
      });
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }
}
