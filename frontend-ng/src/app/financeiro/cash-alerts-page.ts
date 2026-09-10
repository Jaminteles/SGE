import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { CashFlowApiService } from '../core/api/cash-flow-api.service';
import type { CashAlert, CashAlertEvaluation, CashAlertInput } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { Alert } from '../ui/alert';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { TextField } from '../ui/text-field';

interface Formulario {
  name: string;
  minimumBalance: string | null;
  daysAhead: string;
  isActive: boolean;
}

const VAZIO: Formulario = { name: '', minimumBalance: null, daysAhead: '7', isActive: true };

function horizonte(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d{1,3}$/.test(limpo)) return null;
  const dias = Number.parseInt(limpo, 10);
  return dias >= 1 && dias <= 180 ? dias : null;
}

/**
 * Alertas de insuficiência de caixa (RF-105 — UI-029).
 *
 * A configuração é gravada; o disparo, não. "Avaliar" caminha o saldo dia a
 * dia dentro do horizonte e responde o primeiro dia em que ele cruza o
 * mínimo. O alerta olha o caixa da empresa — a escolha de conta bancária
 * específica fica para quando o módulo Bancos tiver tela.
 */
@Component({
  selector: 'sge-cash-alerts-page',
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    TagModule,
    Alert,
    DecimalField,
    ErrorAlert,
    TextField,
  ],
  template: `
    <p class="crumb">Financeiro / Alertas de caixa</p>

    <div class="pagehead">
      <div>
        <h1>Alertas de caixa</h1>
        <p>Saldo mínimo tolerado e horizonte de antecedência (RF-105).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Novo alerta" icon="pi pi-plus" (onClick)="abrir(null)" />
        }
      </div>
    </div>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }
    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    <section class="card table-card espaco">
      @if (carregando()) {
        <p class="nota">Carregando…</p>
      } @else if (alertas().length === 0) {
        <p class="nota">Nenhum alerta configurado.</p>
      } @else {
        <table class="grade">
          <thead>
            <tr>
              <th scope="col">Alerta</th>
              <th scope="col" class="numero">Saldo mínimo</th>
              <th scope="col">Horizonte</th>
              <th scope="col">Situação</th>
              <th scope="col">Última avaliação</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            @for (alerta of alertas(); track alerta.id) {
              <tr>
                <td>{{ alerta.name }}</td>
                <td class="numero">{{ moeda(alerta.minimumBalance) }}</td>
                <td>{{ alerta.daysAhead }} dia(s)</td>
                <td>
                  <p-tag
                    [value]="alerta.isActive ? 'Ativo' : 'Inativo'"
                    [severity]="alerta.isActive ? 'success' : 'secondary'"
                    [rounded]="true"
                  />
                </td>
                <td>
                  @if (avaliacoes()[alerta.id]; as avaliacao) {
                    <p-tag
                      [value]="
                        avaliacao.breached ? 'Ruptura em ' + data(avaliacao.breachDate) : 'Coberto'
                      "
                      [severity]="avaliacao.breached ? 'danger' : 'success'"
                      [rounded]="true"
                    />
                    <span class="secundario">
                      menor saldo {{ moeda(avaliacao.lowestBalance) }}
                      @if (avaliacao.lowestBalanceDate) {
                        em {{ data(avaliacao.lowestBalanceDate) }}
                      }
                    </span>
                  } @else {
                    —
                  }
                </td>
                <td class="acoes">
                  @if (podeAvaliar()) {
                    <p-button
                      label="Avaliar"
                      severity="secondary"
                      [text]="true"
                      size="small"
                      [disabled]="avaliando() === alerta.id"
                      (onClick)="avaliar(alerta)"
                    />
                  }
                  @if (podeEditar()) {
                    <p-button
                      label="Editar"
                      severity="secondary"
                      [text]="true"
                      size="small"
                      (onClick)="abrir(alerta)"
                    />
                  }
                  @if (podeExcluir()) {
                    <p-button
                      label="Excluir"
                      severity="danger"
                      [text]="true"
                      size="small"
                      [disabled]="salvando()"
                      (onClick)="excluir(alerta)"
                    />
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>

    <p-dialog
      [visible]="aberto()"
      (visibleChange)="aberto.set($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      [header]="emEdicao() ? 'Editar alerta' : 'Novo alerta'"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <form class="grade-campos formulario" (ngSubmit)="salvar()">
        <sge-text-field
          rotulo="Nome"
          name="name"
          [obrigatorio]="true"
          [ngModel]="form().name"
          (ngModelChange)="mudar('name', $event)"
        />
        <sge-decimal-field
          rotulo="Saldo mínimo"
          name="minimumBalance"
          [obrigatorio]="true"
          [ngModel]="form().minimumBalance"
          (ngModelChange)="mudar('minimumBalance', $event)"
        />
        <sge-text-field
          rotulo="Horizonte (dias)"
          name="daysAhead"
          tipo="number"
          dica="De 1 a 180 dias"
          [erro]="horizonteValido() ? null : 'Informe de 1 a 180 dias.'"
          [ngModel]="form().daysAhead"
          (ngModelChange)="mudar('daysAhead', '' + ($event ?? ''))"
        />
        <label class="marcador">
          <input
            type="checkbox"
            name="isActive"
            [ngModel]="form().isActive"
            (ngModelChange)="mudar('isActive', $event)"
          />
          Ativo
        </label>
      </form>
      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="aberto.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando() || !valido()"
          (onClick)="salvar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.75rem;
    }
    .grade {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .grade th,
    .grade td {
      padding: 0.5rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .numero {
      text-align: right !important;
      font-variant-numeric: tabular-nums;
    }
    .secundario {
      display: block;
      font-size: 0.7rem;
      color: var(--p-text-muted-color);
    }
    .marcador {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
    }
  `,
})
export class CashAlertsPage {
  private readonly api = inject(CashFlowApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly alertas = signal<CashAlert[]>([]);
  protected readonly avaliacoes = signal<Record<string, CashAlertEvaluation>>({});
  protected readonly carregando = signal(true);
  protected readonly avaliando = signal<string | null>(null);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly aberto = signal(false);
  protected readonly emEdicao = signal<CashAlert | null>(null);
  protected readonly form = signal<Formulario>({ ...VAZIO });
  protected readonly salvando = signal(false);
  protected readonly erroForm = signal<unknown>(null);

  protected readonly podeCriar = () => this.permissoes.pode('cash-alerts:CREATE');
  protected readonly podeEditar = () => this.permissoes.pode('cash-alerts:UPDATE');
  protected readonly podeExcluir = () => this.permissoes.pode('cash-alerts:DELETE');
  /** A avaliação lê o fluxo: exige também `cash-flow:READ`. */
  protected readonly podeAvaliar = () => this.permissoes.pode('cash-flow:READ');

  protected readonly horizonteValido = computed(() => horizonte(this.form().daysAhead) !== null);

  protected readonly valido = computed(
    () =>
      this.form().name.trim() !== '' &&
      this.form().minimumBalance !== null &&
      this.horizonteValido(),
  );

  constructor() {
    this.carregar();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected data(valor: string | null): string {
    return formatDate(valor);
  }

  protected mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrir(alerta: CashAlert | null): void {
    this.emEdicao.set(alerta);
    this.form.set(
      alerta
        ? {
            name: alerta.name,
            minimumBalance: alerta.minimumBalance,
            daysAhead: String(alerta.daysAhead),
            isActive: alerta.isActive,
          }
        : { ...VAZIO },
    );
    this.erroForm.set(null);
    this.aberto.set(true);
  }

  protected salvar(): void {
    if (this.salvando() || !this.valido()) return;
    const form = this.form();
    const dto: CashAlertInput = {
      name: form.name.trim(),
      minimumBalance: form.minimumBalance ?? '0',
      daysAhead: horizonte(form.daysAhead) ?? 7,
      isActive: form.isActive,
    };
    const atual = this.emEdicao();
    this.salvando.set(true);
    this.erroForm.set(null);
    (atual ? this.api.updateAlert(atual.id, dto) : this.api.createAlert(dto))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (alerta) => {
          this.salvando.set(false);
          this.aberto.set(false);
          this.aviso.set(`Alerta ${alerta.name} salvo.`);
          this.carregar();
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erroForm.set(falha);
        },
      });
  }

  protected excluir(alerta: CashAlert): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erro.set(null);
    this.api
      .removeAlert(alerta.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.aviso.set(`Alerta ${alerta.name} excluído.`);
          this.carregar();
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erro.set(falha);
        },
      });
  }

  protected avaliar(alerta: CashAlert): void {
    this.avaliando.set(alerta.id);
    this.api
      .evaluateAlert(alerta.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (avaliacao) => {
          this.avaliando.set(null);
          this.avaliacoes.update((atual) => ({ ...atual, [alerta.id]: avaliacao }));
        },
        error: (falha: unknown) => {
          this.avaliando.set(null);
          this.erro.set(falha);
        },
      });
  }

  private carregar(): void {
    this.carregando.set(true);
    this.api
      .listAlerts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lista) => {
          this.alertas.set(lista);
          this.carregando.set(false);
        },
        error: (falha: unknown) => {
          this.alertas.set([]);
          this.carregando.set(false);
          this.erro.set(falha);
        },
      });
  }
}
