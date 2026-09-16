import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import type { Observable } from 'rxjs';

import { AuthService } from '../core/auth/auth.service';
import { FinanceApiService } from '../core/api/finance-api.service';
import { PaymentConditionsApiService } from '../core/api/payment-conditions-api.service';
import type {
  CategoryClassification,
  FinancialEntry,
  FinancialInstallment,
  InstallmentStatus,
  InstallmentUpdateInput,
  PaymentMethodType,
  Settlement,
  SettlementInput,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency, formatDecimal } from '../core/lib/decimal';
import { formatDate, formatDateTime } from '../core/lib/format';
import { novaChaveIdempotencia } from '../core/lib/idempotency';
import { Alert } from '../ui/alert';
import { PrintExport } from '../ui/print-export';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { comparar, dataValida, diasEntre, hoje, paraCentavos, somar, subtrair } from './dinheiro';
import {
  OPCOES_METODO,
  ROTULO_APROVACAO,
  ROTULO_METODO,
  ROTULO_STATUS_PARCELA,
  ROTULO_STATUS_TITULO,
  ROTULO_TIPO,
  aceitaBaixa,
  contraparte,
  severidadeAprovacao,
  severidadeParcela,
  severidadeTitulo,
  tituloAberto,
} from './rotulos';

interface FormBaixa {
  principalAmount: string | null;
  applyLateCharges: boolean;
  interestAmount: string | null;
  penaltyAmount: string | null;
  discountAmount: string | null;
  settlementDate: string;
  paymentMethodId: string;
  method: string;
  note: string;
}

interface FormProrrogacao {
  dueDate: string;
  dailyInterestRate: string | null;
  penaltyRate: string | null;
}

const PARCELA_ABERTA: InstallmentStatus[] = ['ABERTA', 'PARCIALMENTE_LIQUIDADA'];

/**
 * Título: parcelas, baixas, estornos e encargos (RF-055/RF-056/RF-057 — UI-026).
 *
 * A baixa informa o principal quitado — só ele abate o saldo. Juros e multa
 * podem ser calculados pelo servidor a partir das taxas da parcela
 * (`applyLateCharges`), que é quem conhece a regra do atraso (bd/09); a tela
 * não reimplementa essa conta. O estorno é outra baixa, contrária, e nunca
 * apaga a original.
 *
 * Os botões de ação ficam travados enquanto a requisição anterior não volta:
 * clique duplo em "Registrar baixa" não pode virar duas baixas.
 */
@Component({
  selector: 'sge-entry-detail-page',
  imports: [
    PrintExport,
    FormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    TagModule,
    Alert,
    DecimalField,
    ErrorAlert,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Financeiro / Contas a pagar e receber / {{ numero() }}</p>

    <div class="pagehead">
      <div>
        <h1>Título {{ numero() }}</h1>
        <p>{{ subtitulo() }}</p>
      </div>
      <div class="pagehead__actions">
        <sge-print-export />
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          routerLink="/financeiro/titulos"
        />
        @if (titulo(); as registro) {
          @if (podeEditar() && aberto()) {
            <p-button
              label="Editar"
              severity="secondary"
              [outlined]="true"
              [routerLink]="['/financeiro/titulos', registro.id, 'editar']"
            />
          }
          @if (podeEditar() && aberto() && registro.approvalStatus === 'NAO_REQUERIDA') {
            <p-button
              label="Enviar para aprovação"
              severity="secondary"
              [outlined]="true"
              [loading]="agindo()"
              [disabled]="agindo()"
              (onClick)="enviarParaAprovacao()"
            />
          }
          @if (podeAprovar() && registro.approvalStatus === 'PENDENTE') {
            <p-button
              label="Aprovar"
              icon="pi pi-check"
              [loading]="agindo()"
              [disabled]="agindo() || proprioLancamento()"
              [title]="proprioLancamento() ? 'Quem lançou o título não pode aprová-lo' : ''"
              (onClick)="abrirDecisao('aprovar')"
            />
            <p-button
              label="Reprovar"
              severity="danger"
              [outlined]="true"
              [disabled]="agindo() || proprioLancamento()"
              (onClick)="abrirDecisao('reprovar')"
            />
          }
          @if (podeCancelar() && aberto()) {
            <p-button
              label="Cancelar título"
              severity="danger"
              [text]="true"
              [disabled]="agindo()"
              (onClick)="abrirCancelamento()"
            />
          }
        }
      </div>
    </div>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }
    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    @if (titulo(); as registro) {
      @if (registro.approvalStatus === 'PENDENTE') {
        <div class="espaco">
          <sge-alert
            tom="aviso"
            titulo="Aguardando aprovação"
            mensagem="A baixa fica bloqueada até a decisão de quem tem alçada para o valor (RF-056)."
          />
        </div>
      } @else if (registro.approvalStatus === 'REPROVADO') {
        <div class="espaco">
          <sge-alert tom="erro" titulo="Título reprovado" [mensagem]="registro.note ?? ''" />
        </div>
      }
      @if (registro.status === 'CANCELADO') {
        <div class="espaco">
          <sge-alert
            tom="info"
            [titulo]="'Cancelado em ' + dataHora(registro.canceledAt)"
            [mensagem]="registro.cancelReason ?? ''"
          />
        </div>
      }

      <div class="kpis">
        <div class="kpi">
          <p class="kpi__label">Valor líquido</p>
          <p class="kpi__value">{{ moeda(registro.netAmount) }}</p>
          <p class="kpi__detail">bruto {{ moeda(registro.grossAmount) }}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Liquidado</p>
          <p class="kpi__value">{{ moeda(registro.settledAmount) }}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Saldo</p>
          <p class="kpi__value">{{ moeda(registro.balance) }}</p>
          <p class="kpi__detail" [class.kpi__detail--bad]="parcelasVencidas() > 0">
            {{ parcelasVencidas() }} parcela(s) vencida(s)
          </p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Situação</p>
          <p class="kpi__value">
            <p-tag [value]="rotuloStatus()" [severity]="severidadeStatus()" [rounded]="true" />
          </p>
          <p class="kpi__detail">
            Aprovação:
            <p-tag
              [value]="rotuloAprovacao()"
              [severity]="severidadeAprovacao()"
              [rounded]="true"
            />
          </p>
        </div>
      </div>

      <section class="card secao espaco">
        <h2 class="secao__titulo">Dados e classificação</h2>
        <dl class="dados">
          <div>
            <dt>Carteira</dt>
            <dd>{{ tipo() }}</dd>
          </div>
          <div>
            <dt>Contraparte</dt>
            <dd>{{ nomeContraparte() }}</dd>
          </div>
          <div>
            <dt>Descrição</dt>
            <dd>{{ registro.description }}</dd>
          </div>
          <div>
            <dt>Documento</dt>
            <dd>{{ registro.documentReference ?? '—' }}</dd>
          </div>
          <div>
            <dt>Emissão</dt>
            <dd>{{ data(registro.issueDate) }}</dd>
          </div>
          <div>
            <dt>Competência</dt>
            <dd>{{ data(registro.competenceDate) }}</dd>
          </div>
          <div>
            <dt>Categoria</dt>
            <dd>
              {{
                registro.category ? registro.category.code + ' — ' + registro.category.name : '—'
              }}
            </dd>
          </div>
          <div>
            <dt>Conta contábil</dt>
            <dd>{{ contaContabil() }}</dd>
          </div>
          <div>
            <dt>Centro de custo</dt>
            <dd>
              {{
                registro.costCenter
                  ? registro.costCenter.code + ' — ' + registro.costCenter.name
                  : '—'
              }}
            </dd>
          </div>
          <div>
            <dt>Forma de pagamento</dt>
            <dd>{{ registro.paymentMethod?.name ?? '—' }}</dd>
          </div>
          <div>
            <dt>Condição</dt>
            <dd>{{ registro.paymentTerm?.name ?? '—' }}</dd>
          </div>
          <div>
            <dt>Origem</dt>
            <dd>{{ registro.origin ?? 'Manual' }}</dd>
          </div>
        </dl>
      </section>

      <section class="card table-card espaco">
        <div class="table-card__head">
          <h2 class="secao__titulo">Parcelas e baixas</h2>
        </div>
        <table class="grade">
          <thead>
            <tr>
              <th scope="col">Parcela</th>
              <th scope="col">Vencimento</th>
              <th scope="col" class="numero">Valor</th>
              <th scope="col" class="numero">Liquidado</th>
              <th scope="col" class="numero">Saldo</th>
              <th scope="col">Juros/dia · Multa</th>
              <th scope="col">Atraso</th>
              <th scope="col">Situação</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            @for (parcela of registro.installments; track parcela.id) {
              <tr>
                <td>{{ parcela.number }}/{{ parcela.totalInstallments }}</td>
                <td>
                  {{ data(parcela.dueDate) }}
                  @if (parcela.originalDueDate && parcela.originalDueDate !== parcela.dueDate) {
                    <span class="secundario">original {{ data(parcela.originalDueDate) }}</span>
                  }
                </td>
                <td class="numero">{{ moeda(parcela.amount) }}</td>
                <td class="numero">{{ moeda(parcela.settledAmount) }}</td>
                <td class="numero">{{ moeda(parcela.balance) }}</td>
                <td>{{ taxa(parcela.dailyInterestRate) }} · {{ taxa(parcela.penaltyRate) }}</td>
                <td [class.atraso]="diasAtraso(parcela) > 0">
                  {{ diasAtraso(parcela) > 0 ? diasAtraso(parcela) + ' dia(s)' : '—' }}
                </td>
                <td>
                  <p-tag
                    [value]="rotuloParcela(parcela.status)"
                    [severity]="severidadeParcela(parcela.status)"
                    [rounded]="true"
                  />
                </td>
                <td class="acoes">
                  @if (podeBaixar() && parcelaAberta(parcela) && baixaLiberada()) {
                    <p-button
                      [label]="registro.type === 'PAGAR' ? 'Pagar' : 'Receber'"
                      size="small"
                      [disabled]="agindo()"
                      (onClick)="abrirBaixa(parcela)"
                    />
                  }
                  @if (podeEditar() && parcelaAberta(parcela)) {
                    <p-button
                      label="Prorrogar"
                      severity="secondary"
                      [text]="true"
                      size="small"
                      [disabled]="agindo()"
                      (onClick)="abrirProrrogacao(parcela)"
                    />
                  }
                </td>
              </tr>
              @for (baixa of parcela.settlements; track baixa.id) {
                <tr
                  class="baixa"
                  [class.baixa--estornada]="baixa.isReversed || !!baixa.reversalOfId"
                >
                  <td colspan="2">
                    <i
                      class="pi"
                      [class.pi-undo]="!!baixa.reversalOfId"
                      [class.pi-arrow-right]="!baixa.reversalOfId"
                    ></i>
                    {{ baixa.reversalOfId ? 'Estorno' : 'Baixa' }} em
                    {{ data(baixa.settlementDate) }}
                  </td>
                  <td class="numero">{{ moeda(baixa.principalAmount) }}</td>
                  <td colspan="2" class="numero">total {{ moeda(baixa.totalAmount) }}</td>
                  <td>{{ encargosBaixa(baixa) }}</td>
                  <td colspan="2">
                    {{ meio(baixa) }}
                    @if (baixa.isReversed) {
                      <span class="secundario">
                        estornada em {{ dataHora(baixa.reversedAt) }} — {{ baixa.reversalReason }}
                      </span>
                    }
                    @if (baixa.reversalOfId && baixa.reversalReason) {
                      <span class="secundario">{{ baixa.reversalReason }}</span>
                    }
                  </td>
                  <td class="acoes">
                    @if (podeEstornar() && !baixa.isReversed && !baixa.reversalOfId) {
                      <p-button
                        label="Estornar"
                        severity="danger"
                        [text]="true"
                        size="small"
                        [disabled]="agindo()"
                        (onClick)="abrirEstorno(parcela, baixa)"
                      />
                    }
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </section>
    }

    <!-- Baixa (RF-057) -->
    <p-dialog
      [visible]="baixaAberta()"
      (visibleChange)="baixaAberta.set($event)"
      [modal]="true"
      [style]="{ width: '40rem' }"
      [header]="tituloBaixa()"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      @if (parcelaEmBaixa(); as parcela) {
        <p class="nota">
          Parcela {{ parcela.number }}/{{ parcela.totalInstallments }} · vencimento
          {{ data(parcela.dueDate) }} · saldo {{ moeda(parcela.balance) }}
          @if (diasAtraso(parcela) > 0) {
            · <strong class="atraso">{{ diasAtraso(parcela) }} dia(s) de atraso</strong>
          }
        </p>
      }
      <form class="grade-campos formulario" (ngSubmit)="registrarBaixa()">
        <sge-decimal-field
          rotulo="Principal quitado"
          name="principalAmount"
          dica="Só o principal abate o saldo da parcela"
          [obrigatorio]="true"
          [ngModel]="formBaixa().principalAmount"
          (ngModelChange)="mudarBaixa('principalAmount', $event)"
        />
        <sge-text-field
          rotulo="Data da baixa"
          name="settlementDate"
          tipo="date"
          [ngModel]="formBaixa().settlementDate"
          (ngModelChange)="mudarBaixa('settlementDate', $event)"
        />
        <label class="marcador">
          <input
            type="checkbox"
            name="applyLateCharges"
            [ngModel]="formBaixa().applyLateCharges"
            (ngModelChange)="mudarBaixa('applyLateCharges', $event)"
          />
          Calcular juros e multa do atraso pelas taxas da parcela (servidor)
        </label>
        @if (!formBaixa().applyLateCharges) {
          <sge-decimal-field
            rotulo="Juros cobrados"
            name="interestAmount"
            [ngModel]="formBaixa().interestAmount"
            (ngModelChange)="mudarBaixa('interestAmount', $event)"
          />
          <sge-decimal-field
            rotulo="Multa cobrada"
            name="penaltyAmount"
            [ngModel]="formBaixa().penaltyAmount"
            (ngModelChange)="mudarBaixa('penaltyAmount', $event)"
          />
        }
        <sge-decimal-field
          rotulo="Desconto na liquidação"
          name="discountAmount"
          [ngModel]="formBaixa().discountAmount"
          (ngModelChange)="mudarBaixa('discountAmount', $event)"
        />
        @if (opcoesForma().length > 0) {
          <sge-select-field
            rotulo="Forma de pagamento"
            name="paymentMethodId"
            [opcoes]="opcoesForma()"
            [ngModel]="formBaixa().paymentMethodId || null"
            (ngModelChange)="mudarBaixa('paymentMethodId', $event ?? '')"
          />
        }
        <sge-select-field
          rotulo="Meio utilizado"
          name="method"
          [opcoes]="opcoesMetodo"
          [ngModel]="formBaixa().method || null"
          (ngModelChange)="mudarBaixa('method', $event ?? '')"
        />
        <sge-text-field
          rotulo="Observação"
          name="note"
          [ngModel]="formBaixa().note"
          (ngModelChange)="mudarBaixa('note', $event)"
        />
      </form>
      <dl class="resumo">
        <div>
          <dt>Saldo da parcela depois</dt>
          <dd>{{ moeda(saldoAposBaixa()) }}</dd>
        </div>
        <div>
          <dt>Movimento de caixa</dt>
          <dd>
            {{
              formBaixa().applyLateCharges
                ? moeda(totalBaixa()) + ' + encargos calculados'
                : moeda(totalBaixa())
            }}
          </dd>
        </div>
      </dl>
      @if (problemaBaixa(); as problema) {
        <p class="campo__erro">{{ problema }}</p>
      }
      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="baixaAberta.set(false)"
        />
        <p-button
          label="Registrar baixa"
          icon="pi pi-check"
          [loading]="agindo()"
          [disabled]="agindo() || problemaBaixa() !== null"
          (onClick)="registrarBaixa()"
        />
      </ng-template>
    </p-dialog>

    <!-- Estorno (RF-057) -->
    <p-dialog
      [visible]="estornoAberto()"
      (visibleChange)="estornoAberto.set($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      header="Estornar baixa"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <sge-alert
        tom="aviso"
        titulo="O estorno é um lançamento contrário"
        mensagem="A baixa original fica registrada; o saldo da parcela volta a ficar em aberto."
      />
      <form class="grade-campos formulario" (ngSubmit)="estornar()">
        <sge-text-field
          rotulo="Motivo"
          name="motivoEstorno"
          [obrigatorio]="true"
          [ngModel]="motivo()"
          (ngModelChange)="motivo.set($event)"
        />
      </form>
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          (onClick)="estornoAberto.set(false)"
        />
        <p-button
          label="Estornar"
          severity="danger"
          [loading]="agindo()"
          [disabled]="agindo() || motivo().trim().length < 3"
          (onClick)="estornar()"
        />
      </ng-template>
    </p-dialog>

    <!-- Prorrogação e encargos (RF-055) -->
    <p-dialog
      [visible]="prorrogacaoAberta()"
      (visibleChange)="prorrogacaoAberta.set($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      header="Prorrogar parcela e ajustar encargos"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <form class="grade-campos formulario" (ngSubmit)="prorrogar()">
        <sge-text-field
          rotulo="Novo vencimento"
          name="dueDate"
          tipo="date"
          dica="O vencimento original fica preservado"
          [ngModel]="formProrrogacao().dueDate"
          (ngModelChange)="mudarProrrogacao('dueDate', $event)"
        />
        <sge-decimal-field
          rotulo="Juros de mora ao dia (%)"
          name="dailyInterestRate"
          [casas]="6"
          [ngModel]="formProrrogacao().dailyInterestRate"
          (ngModelChange)="mudarProrrogacao('dailyInterestRate', $event)"
        />
        <sge-decimal-field
          rotulo="Multa por atraso (%)"
          name="penaltyRate"
          [casas]="6"
          [ngModel]="formProrrogacao().penaltyRate"
          (ngModelChange)="mudarProrrogacao('penaltyRate', $event)"
        />
      </form>
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          (onClick)="prorrogacaoAberta.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="agindo()"
          [disabled]="agindo() || !dataValida(formProrrogacao().dueDate)"
          (onClick)="prorrogar()"
        />
      </ng-template>
    </p-dialog>

    <!-- Aprovação / reprovação (RF-056) -->
    <p-dialog
      [visible]="decisao() !== null"
      (visibleChange)="$event ? null : decisao.set(null)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      [header]="decisao() === 'aprovar' ? 'Aprovar título' : 'Reprovar título'"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <form class="grade-campos formulario" (ngSubmit)="decidir()">
        <sge-text-field
          [rotulo]="decisao() === 'aprovar' ? 'Observação' : 'Motivo'"
          name="motivoDecisao"
          [obrigatorio]="decisao() === 'reprovar'"
          [ngModel]="motivo()"
          (ngModelChange)="motivo.set($event)"
        />
      </form>
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          (onClick)="decisao.set(null)"
        />
        <p-button
          [label]="decisao() === 'aprovar' ? 'Aprovar' : 'Reprovar'"
          [severity]="decisao() === 'aprovar' ? 'primary' : 'danger'"
          [loading]="agindo()"
          [disabled]="agindo() || (decisao() === 'reprovar' && motivo().trim().length < 3)"
          (onClick)="decidir()"
        />
      </ng-template>
    </p-dialog>

    <!-- Cancelamento -->
    <p-dialog
      [visible]="cancelamentoAberto()"
      (visibleChange)="cancelamentoAberto.set($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      header="Cancelar título"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <form class="grade-campos formulario" (ngSubmit)="cancelar()">
        <sge-text-field
          rotulo="Motivo"
          name="motivoCancelamento"
          [obrigatorio]="true"
          dica="O título é preservado com a situação Cancelado"
          [ngModel]="motivo()"
          (ngModelChange)="motivo.set($event)"
        />
      </form>
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          (onClick)="cancelamentoAberto.set(false)"
        />
        <p-button
          label="Cancelar título"
          severity="danger"
          [loading]="agindo()"
          [disabled]="agindo() || motivo().trim().length < 3"
          (onClick)="cancelar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.75rem;
    }
    .dados {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
      gap: 0.75rem 1.5rem;
      margin: 0;
      font-size: 0.85rem;
    }
    .dados dt,
    .resumo dt {
      color: var(--p-text-muted-color);
      font-size: 0.75rem;
    }
    .dados dd,
    .resumo dd {
      margin: 0;
    }
    .resumo {
      display: flex;
      gap: 2rem;
      margin: 1rem 0 0;
      font-size: 0.85rem;
      font-variant-numeric: tabular-nums;
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
    .grade th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .grade .numero {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .baixa td {
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
      background: var(--p-content-hover-background, transparent);
    }
    .baixa--estornada td {
      text-decoration: line-through;
    }
    .baixa--estornada td.acoes,
    .baixa--estornada td .secundario {
      text-decoration: none;
    }
    .secundario {
      display: block;
    }
    .atraso {
      color: var(--p-red-500, #dc2626);
      font-weight: 600;
    }
    .marcador {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      grid-column: 1 / -1;
    }
  `,
})
export class EntryDetailPage {
  private readonly api = inject(FinanceApiService);
  private readonly condicoes = inject(PaymentConditionsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly auth = inject(AuthService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly entryId = this.rota.snapshot.paramMap.get('id') ?? '';
  protected readonly opcoesMetodo = OPCOES_METODO;
  protected readonly dataValida = dataValida;

  protected readonly titulo = signal<FinancialEntry | null>(null);
  protected readonly erro = signal<unknown>(null);
  protected readonly erroDialogo = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly agindo = signal(false);
  protected readonly opcoesForma = signal<OpcaoFiltro[]>([]);
  private readonly classificacao = signal<CategoryClassification | null | undefined>(undefined);

  protected readonly baixaAberta = signal(false);
  protected readonly parcelaEmBaixa = signal<FinancialInstallment | null>(null);
  protected readonly formBaixa = signal<FormBaixa>(this.baixaVazia());

  protected readonly estornoAberto = signal(false);
  private readonly alvoEstorno = signal<{
    parcela: FinancialInstallment;
    baixa: Settlement;
  } | null>(null);

  protected readonly prorrogacaoAberta = signal(false);
  private readonly parcelaEmProrrogacao = signal<FinancialInstallment | null>(null);
  protected readonly formProrrogacao = signal<FormProrrogacao>({
    dueDate: '',
    dailyInterestRate: null,
    penaltyRate: null,
  });

  protected readonly decisao = signal<'aprovar' | 'reprovar' | null>(null);
  protected readonly cancelamentoAberto = signal(false);
  protected readonly motivo = signal('');

  protected readonly podeEditar = () => this.permissoes.pode('financial-entries:UPDATE');
  protected readonly podeCancelar = () => this.permissoes.pode('financial-entries:DELETE');
  protected readonly podeAprovar = () => this.permissoes.pode('financial-entries:APPROVE');
  protected readonly podeBaixar = () => this.permissoes.pode('settlements:CREATE');
  protected readonly podeEstornar = () => this.permissoes.pode('settlements:DELETE');

  protected readonly numero = computed(() => this.titulo()?.number ?? '—');
  protected readonly aberto = computed(() => {
    const registro = this.titulo();
    return registro !== null && tituloAberto(registro);
  });
  protected readonly baixaLiberada = computed(() => {
    const registro = this.titulo();
    return registro !== null && aceitaBaixa(registro);
  });

  /** Segregação de funções (RF-056): quem lançou não decide. O servidor também recusa. */
  protected readonly proprioLancamento = computed(() => {
    const registro = this.titulo();
    const usuario = this.auth.usuario();
    return !!registro?.createdById && registro.createdById === usuario?.id;
  });

  protected readonly subtitulo = computed(() => {
    const registro = this.titulo();
    if (!registro) return 'Parcelas, baixas, estornos e encargos de atraso (RF-055 a RF-057).';
    return `${ROTULO_TIPO[registro.type]} · ${contraparte(registro)} · ${registro.description}`;
  });

  protected readonly parcelasVencidas = computed(
    () => (this.titulo()?.installments ?? []).filter((p) => this.diasAtraso(p) > 0).length,
  );

  protected readonly tipo = computed(() => {
    const registro = this.titulo();
    return registro ? ROTULO_TIPO[registro.type] : '—';
  });
  protected readonly nomeContraparte = computed(() => {
    const registro = this.titulo();
    return registro ? contraparte(registro) : '—';
  });
  protected readonly rotuloStatus = computed(() => {
    const registro = this.titulo();
    return registro ? ROTULO_STATUS_TITULO[registro.status] : '';
  });
  protected readonly severidadeStatus = computed(() => {
    const registro = this.titulo();
    return registro ? severidadeTitulo(registro.status) : 'secondary';
  });
  protected readonly rotuloAprovacao = computed(() => {
    const registro = this.titulo();
    return registro ? ROTULO_APROVACAO[registro.approvalStatus] : '';
  });
  protected readonly severidadeAprovacao = computed(() => {
    const registro = this.titulo();
    return registro ? severidadeAprovacao(registro.approvalStatus) : 'secondary';
  });

  /** Conta herdada da categoria (RF-054/RF-080). */
  protected readonly contaContabil = computed(() => {
    const registro = this.titulo();
    if (!registro?.categoryId) return '—';
    const item = this.classificacao();
    if (item === undefined) return 'Herdada da categoria';
    if (item === null || !item.ledgerAccountId) return 'Categoria sem conta contábil';
    return `${item.ledgerAccountCode} — ${item.ledgerAccountName}`;
  });

  protected readonly tituloBaixa = computed(() =>
    this.titulo()?.type === 'RECEBER' ? 'Registrar recebimento' : 'Registrar pagamento',
  );

  protected readonly saldoAposBaixa = computed(() =>
    subtrair(this.parcelaEmBaixa()?.balance, this.formBaixa().principalAmount),
  );

  /** Caixa movimentado: principal + juros + multa − desconto. Prévia; vale o servidor. */
  protected readonly totalBaixa = computed(() => {
    const form = this.formBaixa();
    const encargos = form.applyLateCharges ? '0' : somar(form.interestAmount, form.penaltyAmount);
    return subtrair(somar(form.principalAmount, encargos), form.discountAmount);
  });

  protected readonly problemaBaixa = computed<string | null>(() => {
    const form = this.formBaixa();
    const parcela = this.parcelaEmBaixa();
    if (!parcela) return null;
    if (paraCentavos(form.principalAmount) <= 0n) return 'Informe o principal quitado.';
    if (comparar(form.principalAmount, parcela.balance) > 0) {
      return 'O principal não pode superar o saldo da parcela.';
    }
    if (form.settlementDate !== '' && !dataValida(form.settlementDate))
      return 'Data da baixa inválida.';
    if (paraCentavos(this.totalBaixa()) < 0n) {
      return 'O desconto não pode superar o valor movimentado.';
    }
    return null;
  });

  constructor() {
    this.carregar();
    if (this.permissoes.pode('payment-methods:READ')) {
      this.condicoes
        .listMethods({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesForma.set(
              r.data.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` })),
            ),
          error: () => this.opcoesForma.set([]),
        });
    }
  }

  protected moeda(valor: string | null | undefined): string {
    return formatCurrency(valor ?? '0');
  }

  protected data(valor: string | null | undefined): string {
    return formatDate(valor);
  }

  protected dataHora(valor: string | null | undefined): string {
    return formatDateTime(valor);
  }

  protected taxa(valor: string): string {
    return `${formatDecimal(valor, 6)}%`;
  }

  protected rotuloParcela(status: InstallmentStatus): string {
    return ROTULO_STATUS_PARCELA[status] ?? status;
  }

  protected severidadeParcela(status: InstallmentStatus) {
    return severidadeParcela(status);
  }

  protected parcelaAberta(parcela: FinancialInstallment): boolean {
    return PARCELA_ABERTA.includes(parcela.status) && paraCentavos(parcela.balance) > 0n;
  }

  /** Só para exibir: o encargo em dinheiro é calculado pelo servidor. */
  protected diasAtraso(parcela: FinancialInstallment): number {
    if (!PARCELA_ABERTA.includes(parcela.status)) return 0;
    return Math.max(0, diasEntre(parcela.dueDate, hoje()));
  }

  protected encargosBaixa(baixa: Settlement): string {
    const partes = [
      paraCentavos(baixa.interestAmount) > 0n ? `juros ${this.moeda(baixa.interestAmount)}` : '',
      paraCentavos(baixa.penaltyAmount) > 0n ? `multa ${this.moeda(baixa.penaltyAmount)}` : '',
      paraCentavos(baixa.discountAmount) > 0n ? `desconto ${this.moeda(baixa.discountAmount)}` : '',
    ].filter(Boolean);
    return partes.length > 0 ? partes.join(' · ') : '—';
  }

  protected meio(baixa: Settlement): string {
    if (baixa.paymentMethod) return baixa.paymentMethod.name;
    return baixa.method ? (ROTULO_METODO[baixa.method] ?? baixa.method) : '—';
  }

  protected mudarBaixa<K extends keyof FormBaixa>(campo: K, valor: FormBaixa[K]): void {
    this.formBaixa.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarProrrogacao<K extends keyof FormProrrogacao>(
    campo: K,
    valor: FormProrrogacao[K],
  ): void {
    this.formProrrogacao.update((atual) => ({ ...atual, [campo]: valor }));
  }

  /**
   * Uma chave por baixa aberta (RN-004): o retry da mesma tentativa — queda de
   * rede, timeout — reusa a chave e o servidor devolve a baixa já gravada.
   * Abrir outra baixa gera outra chave.
   */
  private chaveBaixa = '';

  protected abrirBaixa(parcela: FinancialInstallment): void {
    this.chaveBaixa = novaChaveIdempotencia();
    this.parcelaEmBaixa.set(parcela);
    this.formBaixa.set({
      ...this.baixaVazia(),
      principalAmount: parcela.balance,
      applyLateCharges: this.diasAtraso(parcela) > 0,
      paymentMethodId: this.titulo()?.paymentMethodId ?? '',
    });
    this.erroDialogo.set(null);
    this.baixaAberta.set(true);
  }

  protected registrarBaixa(): void {
    const parcela = this.parcelaEmBaixa();
    if (!parcela || this.problemaBaixa() !== null) return;
    const form = this.formBaixa();
    const dto: SettlementInput = { principalAmount: form.principalAmount ?? '0' };
    if (form.applyLateCharges) {
      dto.applyLateCharges = true;
    } else {
      if (paraCentavos(form.interestAmount) > 0n)
        dto.interestAmount = form.interestAmount ?? undefined;
      if (paraCentavos(form.penaltyAmount) > 0n)
        dto.penaltyAmount = form.penaltyAmount ?? undefined;
    }
    if (paraCentavos(form.discountAmount) > 0n)
      dto.discountAmount = form.discountAmount ?? undefined;
    if (form.settlementDate !== '') dto.settlementDate = form.settlementDate;
    if (form.paymentMethodId !== '') dto.paymentMethodId = form.paymentMethodId;
    if (form.method !== '') dto.method = form.method as PaymentMethodType;
    if (form.note.trim() !== '') dto.note = form.note.trim();

    this.executarNoDialogo(
      () => this.api.settle(this.entryId, parcela.id, dto, this.chaveBaixa),
      () => this.baixaAberta.set(false),
      this.titulo()?.type === 'RECEBER' ? 'Recebimento registrado.' : 'Pagamento registrado.',
    );
  }

  protected abrirEstorno(parcela: FinancialInstallment, baixa: Settlement): void {
    this.alvoEstorno.set({ parcela, baixa });
    this.motivo.set('');
    this.erroDialogo.set(null);
    this.estornoAberto.set(true);
  }

  protected estornar(): void {
    const alvo = this.alvoEstorno();
    const motivo = this.motivo().trim();
    if (!alvo || motivo.length < 3) return;
    this.executarNoDialogo(
      () => this.api.reverseSettlement(this.entryId, alvo.parcela.id, alvo.baixa.id, motivo),
      () => this.estornoAberto.set(false),
      'Baixa estornada; o lançamento original foi preservado.',
    );
  }

  protected abrirProrrogacao(parcela: FinancialInstallment): void {
    this.parcelaEmProrrogacao.set(parcela);
    this.formProrrogacao.set({
      dueDate: parcela.dueDate.slice(0, 10),
      dailyInterestRate: parcela.dailyInterestRate,
      penaltyRate: parcela.penaltyRate,
    });
    this.erroDialogo.set(null);
    this.prorrogacaoAberta.set(true);
  }

  protected prorrogar(): void {
    const parcela = this.parcelaEmProrrogacao();
    const form = this.formProrrogacao();
    if (!parcela || !dataValida(form.dueDate)) return;
    const dto: InstallmentUpdateInput = {};
    if (form.dueDate !== parcela.dueDate.slice(0, 10)) dto.dueDate = form.dueDate;
    if (form.dailyInterestRate !== null && form.dailyInterestRate !== parcela.dailyInterestRate) {
      dto.dailyInterestRate = form.dailyInterestRate;
    }
    if (form.penaltyRate !== null && form.penaltyRate !== parcela.penaltyRate) {
      dto.penaltyRate = form.penaltyRate;
    }
    if (Object.keys(dto).length === 0) {
      this.prorrogacaoAberta.set(false);
      return;
    }
    this.executarNoDialogo(
      () => this.api.updateInstallment(this.entryId, parcela.id, dto),
      () => this.prorrogacaoAberta.set(false),
      'Parcela atualizada.',
    );
  }

  protected enviarParaAprovacao(): void {
    this.executarNoDialogo(
      () => this.api.submitEntry(this.entryId),
      () => undefined,
      'Título enviado para aprovação.',
    );
  }

  protected abrirDecisao(tipo: 'aprovar' | 'reprovar'): void {
    this.motivo.set('');
    this.erroDialogo.set(null);
    this.decisao.set(tipo);
  }

  protected decidir(): void {
    const tipo = this.decisao();
    const motivo = this.motivo().trim();
    if (tipo === null || (tipo === 'reprovar' && motivo.length < 3)) return;
    this.executarNoDialogo(
      () =>
        tipo === 'aprovar'
          ? this.api.approveEntry(this.entryId, motivo || undefined)
          : this.api.rejectEntry(this.entryId, motivo),
      () => this.decisao.set(null),
      tipo === 'aprovar' ? 'Título aprovado.' : 'Título reprovado.',
    );
  }

  protected abrirCancelamento(): void {
    this.motivo.set('');
    this.erroDialogo.set(null);
    this.cancelamentoAberto.set(true);
  }

  protected cancelar(): void {
    const motivo = this.motivo().trim();
    if (motivo.length < 3) return;
    this.executarNoDialogo(
      () => this.api.cancelEntry(this.entryId, motivo),
      () => this.cancelamentoAberto.set(false),
      'Título cancelado; o registro foi preservado.',
    );
  }

  private baixaVazia(): FormBaixa {
    return {
      principalAmount: null,
      applyLateCharges: false,
      interestAmount: null,
      penaltyAmount: null,
      discountAmount: null,
      settlementDate: hoje(),
      paymentMethodId: '',
      method: '',
      note: '',
    };
  }

  /**
   * Um só caminho para toda ação: trava os botões, fecha o diálogo no sucesso e
   * recarrega o título — saldo e situação vêm do servidor, não de conta local.
   */
  private executarNoDialogo(
    acao: () => Observable<unknown>,
    fechar: () => void,
    mensagem: string,
  ): void {
    if (this.agindo()) return;
    this.agindo.set(true);
    this.erroDialogo.set(null);
    this.erro.set(null);
    acao()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.agindo.set(false);
          fechar();
          this.aviso.set(mensagem);
          this.carregar();
        },
        error: (falha: unknown) => {
          this.agindo.set(false);
          // Sem diálogo aberto (ex.: envio para aprovação), o erro vai para a página.
          if (this.algumDialogoAberto()) this.erroDialogo.set(falha);
          else this.erro.set(falha);
        },
      });
  }

  private algumDialogoAberto(): boolean {
    return (
      this.baixaAberta() ||
      this.estornoAberto() ||
      this.prorrogacaoAberta() ||
      this.cancelamentoAberto() ||
      this.decisao() !== null
    );
  }

  private carregar(): void {
    this.api
      .getEntry(this.entryId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registro) => {
          this.titulo.set(registro);
          this.carregarClassificacao(registro);
        },
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private carregarClassificacao(registro: FinancialEntry): void {
    if (!registro.categoryId || !this.permissoes.pode('accounting-classifications:READ')) return;
    if (this.classificacao() !== undefined) return;
    this.api
      .categoryClassifications()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lista) =>
          this.classificacao.set(lista.find((c) => c.id === registro.categoryId) ?? null),
        error: () => this.classificacao.set(undefined),
      });
  }
}
