import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { AccountingApiService } from '../core/api/accounting-api.service';
import type { AccountingPeriod, AccountingPeriodStatus } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatDate, formatDateTime } from '../core/lib/format';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { hoje } from '../financeiro/dinheiro';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  FILTRO_STATUS_PERIODO,
  ROTULO_STATUS_PERIODO,
  SEVERIDADE_STATUS_PERIODO,
  acoesDoPeriodo,
  anteriorAberto,
  problemaExercicio,
  problemaReabertura,
  rotuloMes,
} from './rotulos';

type Confirmacao = { periodo: AccountingPeriod; acao: 'EM_FECHAMENTO' | 'FECHADO' | 'REABRIR' };

/**
 * Fechamento e reabertura de períodos (RF-086 — UI-059).
 *
 * O bloqueio é do banco (RN-008): período fechado não aceita lançamento. A tela
 * o torna visível — cadeado na linha, e os lançamentos e o formulário avisam
 * quando a competência cai num mês fechado.
 *
 * Fechar é em duas etapas (em fechamento ainda aceita ajuste) e segue a ordem
 * dos meses. Reabrir exige motivo, que vai para a trilha de auditoria.
 */
@Component({
  selector: 'sge-periods-page',
  imports: [FormsModule, ButtonModule, DialogModule, TagModule, Alert, ErrorAlert, SelectField, TextField],
  template: `
    <p class="crumb">Contábil / Períodos</p>

    <div class="pagehead">
      <div>
        <h1>Períodos contábeis</h1>
        <p>Abertura do exercício, fechamento em duas etapas e reabertura com motivo (RF-086).</p>
      </div>
    </div>

    @if (aviso(); as texto) {
      <sge-alert tom="sucesso" [titulo]="texto" />
    }

    <section class="card secao barra">
      <sge-text-field rotulo="Exercício" tipo="number" [ngModel]="ano()" (ngModelChange)="ano.set(($event ?? '').toString())" />
      <sge-select-field
        rotulo="Situação"
        [placeholder]="filtroStatus.placeholder ?? 'Todas'"
        [opcoes]="filtroStatus.options"
        [ngModel]="status() || null"
        (ngModelChange)="status.set($event ?? '')"
      />
      <p-button label="Consultar" icon="pi pi-search" severity="secondary" [outlined]="true" [disabled]="!!problemaAno()" (onClick)="carregar()" />
      @if (podeAlterar()) {
        <p-button
          [label]="'Abrir exercício ' + ano()"
          icon="pi pi-calendar-plus"
          [loading]="abrindo()"
          [disabled]="abrindo() || !!problemaAno()"
          (onClick)="abrirExercicio()"
        />
      }
    </section>
    @if (problemaAno(); as texto) {
      <p class="campo__erro">{{ texto }}</p>
    }

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (fechados() > 0) {
      <p class="nota espaco">
        <i class="pi pi-lock" aria-hidden="true"></i>
        {{ fechados() }} período(s) fechado(s): lançamentos e estornos com essa competência são recusados.
      </p>
    }

    <section class="card espaco">
      <div class="tabela-rolagem">
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">Período</th>
              <th scope="col">Intervalo</th>
              <th scope="col">Situação</th>
              <th scope="col">Histórico</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            @for (periodo of periodos(); track periodo.id) {
              <tr [class.fechado]="periodo.status === 'FECHADO'">
                <td class="mes">
                  @if (periodo.status === 'FECHADO') {
                    <i class="pi pi-lock" aria-hidden="true"></i>
                    <span class="sr-only">Bloqueado para lançamentos</span>
                  } @else {
                    <i class="pi pi-lock-open" aria-hidden="true"></i>
                  }
                  {{ mes(periodo) }}
                </td>
                <td>{{ data(periodo.startDate) }} a {{ data(periodo.endDate) }}</td>
                <td>
                  <p-tag [value]="rotuloStatus(periodo.status)" [severity]="severidade(periodo.status)" [rounded]="true" />
                  @if (periodo.status === 'FECHADO') {
                    <span class="secundario">Não aceita lançamentos</span>
                  } @else if (periodo.status === 'EM_FECHAMENTO') {
                    <span class="secundario">Ainda aceita ajustes</span>
                  }
                </td>
                <td>
                  @if (periodo.closedAt) {
                    <span class="secundario">Fechado em {{ dataHora(periodo.closedAt) }}</span>
                  }
                  @if (periodo.reopenedAt) {
                    <span class="secundario">Reaberto em {{ dataHora(periodo.reopenedAt) }}: {{ periodo.reopenReason }}</span>
                  }
                </td>
                <td class="acoes">
                  @if (podeAlterar()) {
                    @if (acoes(periodo).iniciarFechamento) {
                      <p-button label="Iniciar fechamento" severity="secondary" [text]="true" size="small" (onClick)="confirmar(periodo, 'EM_FECHAMENTO')" />
                    }
                    @if (acoes(periodo).fechar) {
                      <p-button label="Fechar" icon="pi pi-lock" severity="danger" [text]="true" size="small" (onClick)="confirmar(periodo, 'FECHADO')" />
                    }
                    @if (acoes(periodo).reabrir) {
                      <p-button label="Reabrir" icon="pi pi-lock-open" severity="warn" [text]="true" size="small" (onClick)="confirmar(periodo, 'REABRIR')" />
                    }
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="vazio">
                  @if (carregando()) {
                    Carregando…
                  } @else {
                    Nenhum período para o filtro. Abra o exercício para criar os doze meses.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <p-dialog
      [visible]="confirmacao() !== null"
      (visibleChange)="$event || confirmacao.set(null)"
      [modal]="true"
      [style]="{ width: '32rem' }"
      [header]="tituloConfirmacao()"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      @if (confirmacao(); as c) {
        @if (c.acao === 'FECHADO') {
          <p>Depois de fechado, o período não aceita lançamento nem estorno — o bloqueio é do banco.</p>
          @if (anterior(c.periodo); as a) {
            <sge-alert
              tom="aviso"
              titulo="Mês anterior ainda aberto"
              [mensagem]="mes(a) + ' está ' + rotuloStatus(a.status).toLowerCase() + ': o servidor recusa fechar fora de ordem.'"
            />
          }
        } @else if (c.acao === 'EM_FECHAMENTO') {
          <p>Em fechamento o período ainda aceita ajustes. É a etapa de conferência antes de fechar.</p>
        } @else {
          <sge-alert
            tom="aviso"
            titulo="Reabrir altera números já entregues"
            mensagem="O motivo e o responsável ficam na trilha de auditoria."
          />
          <sge-text-field rotulo="Motivo" [obrigatorio]="true" [ngModel]="motivo()" (ngModelChange)="motivo.set($event ?? '')" />
          @if (tentou() && problemaMotivo(); as texto) {
            <p class="campo__erro">{{ texto }}</p>
          }
        }
      }
      <ng-template #footer>
        <p-button label="Voltar" severity="secondary" [outlined]="true" [disabled]="salvando()" (onClick)="confirmacao.set(null)" />
        <p-button label="Confirmar" icon="pi pi-check" [loading]="salvando()" [disabled]="salvando()" (onClick)="executar()" />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    ESTILO_TABELA,
    `
      .barra {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 0.75rem;
      }
      .mes {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .mes i {
        margin-right: 0.35rem;
        font-size: 0.75rem;
        color: var(--p-text-muted-color);
      }
      .fechado .mes i {
        color: var(--p-red-600, var(--p-text-color));
      }
      .fechado td {
        background: var(--p-content-hover-background, transparent);
      }
      .secundario {
        display: block;
      }
    `,
  ],
})
export class PeriodsPage {
  private readonly api = inject(AccountingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly filtroStatus = FILTRO_STATUS_PERIODO;

  protected readonly ano = signal(hoje().slice(0, 4));
  protected readonly status = signal<AccountingPeriodStatus | ''>('');
  protected readonly periodos = signal<AccountingPeriod[]>([]);
  protected readonly carregando = signal(false);
  protected readonly abrindo = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly confirmacao = signal<Confirmacao | null>(null);
  protected readonly motivo = signal('');
  protected readonly tentou = signal(false);
  protected readonly salvando = signal(false);
  protected readonly erroDialogo = signal<unknown>(null);

  protected readonly problemaAno = computed(() => problemaExercicio(this.ano()));
  protected readonly problemaMotivo = computed(() => problemaReabertura(this.motivo()));
  protected readonly fechados = computed(() => this.periodos().filter((p) => p.status === 'FECHADO').length);

  protected readonly tituloConfirmacao = computed(() => {
    const c = this.confirmacao();
    if (!c) return '';
    const mes = rotuloMes(c.periodo.year, c.periodo.month);
    if (c.acao === 'FECHADO') return `Fechar ${mes}`;
    if (c.acao === 'EM_FECHAMENTO') return `Iniciar fechamento de ${mes}`;
    return `Reabrir ${mes}`;
  });

  protected readonly podeAlterar = () => this.permissoes.pode('accounting-periods:UPDATE');

  constructor() {
    this.carregar();
  }

  protected carregar(): void {
    if (this.problemaAno()) return;
    this.carregando.set(true);
    this.erro.set(null);
    this.api
      .listPeriods({ year: Number.parseInt(this.ano(), 10), status: this.status() || undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (periodos) => {
          this.periodos.set(periodos);
          this.carregando.set(false);
        },
        error: (falha: unknown) => {
          this.periodos.set([]);
          this.erro.set(falha);
          this.carregando.set(false);
        },
      });
  }

  protected abrirExercicio(): void {
    if (this.abrindo() || this.problemaAno()) return;
    const ano = Number.parseInt(this.ano(), 10);
    this.abrindo.set(true);
    this.erro.set(null);
    this.api
      .openYear(ano)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (periodos) => {
          this.abrindo.set(false);
          this.status.set('');
          this.periodos.set(periodos);
          this.aviso.set(`Exercício ${ano} aberto: ${periodos.length} período(s) disponíveis.`);
        },
        error: (falha: unknown) => {
          this.abrindo.set(false);
          this.erro.set(falha);
        },
      });
  }

  protected confirmar(periodo: AccountingPeriod, acao: Confirmacao['acao']): void {
    this.confirmacao.set({ periodo, acao });
    this.motivo.set('');
    this.tentou.set(false);
    this.erroDialogo.set(null);
  }

  protected executar(): void {
    const c = this.confirmacao();
    if (!c || this.salvando()) return;
    this.tentou.set(true);
    if (c.acao === 'REABRIR' && this.problemaMotivo()) return;

    const requisicao =
      c.acao === 'REABRIR'
        ? this.api.reopenPeriod(c.periodo.id, this.motivo().trim())
        : this.api.closePeriod(c.periodo.id, c.acao);

    this.salvando.set(true);
    this.erroDialogo.set(null);
    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (atualizado) => {
        this.salvando.set(false);
        this.confirmacao.set(null);
        this.periodos.update((lista) => lista.map((p) => (p.id === atualizado.id ? atualizado : p)));
        this.aviso.set(`Período ${this.mes(atualizado)}: ${this.rotuloStatus(atualizado.status).toLowerCase()}.`);
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroDialogo.set(falha);
      },
    });
  }

  protected acoes(periodo: AccountingPeriod) {
    return acoesDoPeriodo(periodo.status);
  }

  protected anterior(periodo: AccountingPeriod): AccountingPeriod | null {
    return anteriorAberto(this.periodos(), periodo);
  }

  protected mes(periodo: AccountingPeriod): string {
    return rotuloMes(periodo.year, periodo.month);
  }

  protected rotuloStatus(status: AccountingPeriodStatus): string {
    return ROTULO_STATUS_PERIODO[status] ?? status;
  }

  protected severidade(status: AccountingPeriodStatus) {
    return SEVERIDADE_STATUS_PERIODO[status];
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }
}
