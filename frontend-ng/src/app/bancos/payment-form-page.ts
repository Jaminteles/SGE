import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';

import { BankingApiService } from '../core/api/banking-api.service';
import { ApiError } from '../core/api/errors';
import type {
  CompanyBankAccount,
  PaymentInput,
  PaymentMethodType,
  TransactionDirection,
} from '../core/api/types';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { novaChaveIdempotencia } from '../core/lib/idempotency';
import { dataValida, hoje, paraCentavos } from '../financeiro/dinheiro';
import { ROTULO_METODO } from '../financeiro/rotulos';
import { Alert } from '../ui/alert';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  OPCOES_METODO_ORDEM,
  OPCOES_SENTIDO,
  ROTULO_SENTIDO,
  identificacaoConta,
  opcaoConta,
  problemaFavorecido,
  somenteDigitos,
} from './rotulos';

export interface FormOrdem {
  bankAccountId: string;
  direction: TransactionDirection;
  method: PaymentMethodType | '';
  /** Decimal canônico em string (RN-012). */
  amount: string | null;
  description: string;
  /** `YYYY-MM-DD`; vazio = executar assim que possível (RF-063). */
  scheduledFor: string;
  payeeName: string;
  payeeDocument: string;
  payeeBankCode: string;
  payeeAgency: string;
  payeeAccount: string;
  pixKey: string;
  barcode: string;
}

const VAZIO: FormOrdem = {
  bankAccountId: '',
  direction: 'DEBITO',
  method: '',
  amount: null,
  description: '',
  scheduledFor: '',
  payeeName: '',
  payeeDocument: '',
  payeeBankCode: '',
  payeeAgency: '',
  payeeAccount: '',
  pixKey: '',
  barcode: '',
};

/**
 * Respostas que provam que **nada** foi criado com a chave: validação, acesso,
 * conta inexistente. Depois de uma delas, mudar o formulário é montar outra
 * ordem — e outra ordem tem outra chave. Rede, 5xx e 409 (a chave está em uso)
 * não provam nada: a chave fica.
 */
const RECUSAS_DEFINITIVAS = [400, 403, 404, 422];

/**
 * Emissão de PIX, boleto e transferência (RF-062/RF-063/RF-067 — UI-043 e o
 * agendamento da UI-044).
 *
 * Uma chave de idempotência por ordem montada: o retry da mesma tentativa —
 * queda de rede, timeout, duplo clique — reusa a chave e o servidor devolve a
 * ordem já criada. O envio passa por uma confirmação com o resumo, porque
 * depois dele o dinheiro está a caminho.
 */
@Component({
  selector: 'sge-payment-form-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    Alert,
    DecimalField,
    ErrorAlert,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Bancos / Ordens / Nova</p>

    <div class="pagehead">
      <div>
        <h1>Nova ordem de pagamento</h1>
        <p>PIX, boleto e transferência, imediatos ou agendados (RF-062/RF-063).</p>
      </div>
      <div class="pagehead__actions">
        <p-button label="Voltar" severity="secondary" [outlined]="true" routerLink="/bancos/ordens" />
      </div>
    </div>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }
    @if (erroContas(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }
    @if (tentou() && problema(); as texto) {
      <div class="espaco"><sge-alert tom="aviso" [titulo]="texto" /></div>
    }

    <form (ngSubmit)="revisar()">
      <section class="card secao espaco">
        <h2 class="secao__titulo">Ordem</h2>
        <div class="grade-campos">
          <sge-select-field
            rotulo="Sentido"
            name="direction"
            [opcoes]="opcoesSentido"
            [ngModel]="form().direction"
            (ngModelChange)="mudar('direction', $event ?? 'DEBITO')"
          />
          <sge-select-field
            rotulo="Conta"
            name="bankAccountId"
            [obrigatorio]="true"
            [dica]="dicaConta()"
            [opcoes]="opcoesConta()"
            [ngModel]="form().bankAccountId"
            (ngModelChange)="mudar('bankAccountId', $event ?? '')"
          />
          <sge-select-field
            rotulo="Modalidade"
            name="method"
            [obrigatorio]="true"
            [opcoes]="opcoesMetodo"
            [ngModel]="form().method"
            (ngModelChange)="mudar('method', $event ?? '')"
          />
          <sge-decimal-field
            rotulo="Valor"
            name="amount"
            [obrigatorio]="true"
            [ngModel]="form().amount"
            (ngModelChange)="mudar('amount', $event)"
          />
          <sge-text-field
            rotulo="Agendar para"
            name="scheduledFor"
            tipo="date"
            dica="Vazio: executar assim que possível"
            [ngModel]="form().scheduledFor"
            (ngModelChange)="mudar('scheduledFor', $event ?? '')"
          />
          <sge-text-field
            rotulo="Descrição"
            name="description"
            dica="Aparece no extrato e nos relatórios"
            [ngModel]="form().description"
            (ngModelChange)="mudar('description', $event)"
          />
        </div>
      </section>

      <section class="card secao espaco">
        <h2 class="secao__titulo">{{ form().direction === 'CREDITO' ? 'Pagador' : 'Favorecido' }}</h2>
        @switch (form().method) {
          @case ('') {
            <p class="vazio">Escolha a modalidade para informar o destino.</p>
          }
          @case ('PIX') {
            <div class="grade-campos">
              <sge-text-field
                rotulo="Chave PIX"
                name="pixKey"
                [obrigatorio]="true"
                [ngModel]="form().pixKey"
                (ngModelChange)="mudar('pixKey', $event)"
              />
              <sge-text-field
                rotulo="Nome"
                name="payeeName"
                [ngModel]="form().payeeName"
                (ngModelChange)="mudar('payeeName', $event)"
              />
              <sge-text-field
                rotulo="CPF/CNPJ"
                name="payeeDocument"
                [ngModel]="form().payeeDocument"
                (ngModelChange)="mudar('payeeDocument', $event)"
              />
            </div>
          }
          @case ('BOLETO') {
            <div class="grade-campos">
              <sge-text-field
                rotulo="Código de barras ou linha digitável"
                name="barcode"
                [obrigatorio]="true"
                [ngModel]="form().barcode"
                (ngModelChange)="mudar('barcode', $event)"
              />
              <sge-text-field
                rotulo="Beneficiário"
                name="payeeName"
                [ngModel]="form().payeeName"
                (ngModelChange)="mudar('payeeName', $event)"
              />
              <sge-text-field
                rotulo="CPF/CNPJ"
                name="payeeDocument"
                [ngModel]="form().payeeDocument"
                (ngModelChange)="mudar('payeeDocument', $event)"
              />
            </div>
          }
          @case ('TRANSFERENCIA_INTERNA') {
            <div class="grade-campos">
              <sge-text-field
                rotulo="Conta de destino"
                name="payeeAccount"
                [obrigatorio]="true"
                [ngModel]="form().payeeAccount"
                (ngModelChange)="mudar('payeeAccount', $event)"
              />
              <sge-text-field
                rotulo="Nome"
                name="payeeName"
                [ngModel]="form().payeeName"
                (ngModelChange)="mudar('payeeName', $event)"
              />
            </div>
          }
          @default {
            <div class="grade-campos">
              <sge-text-field
                rotulo="Nome"
                name="payeeName"
                [ngModel]="form().payeeName"
                (ngModelChange)="mudar('payeeName', $event)"
              />
              <sge-text-field
                rotulo="CPF/CNPJ"
                name="payeeDocument"
                [obrigatorio]="true"
                [ngModel]="form().payeeDocument"
                (ngModelChange)="mudar('payeeDocument', $event)"
              />
              <sge-text-field
                rotulo="Banco"
                name="payeeBankCode"
                dica="Código COMPE"
                [obrigatorio]="true"
                [ngModel]="form().payeeBankCode"
                (ngModelChange)="mudar('payeeBankCode', $event)"
              />
              <sge-text-field
                rotulo="Agência"
                name="payeeAgency"
                [obrigatorio]="true"
                [ngModel]="form().payeeAgency"
                (ngModelChange)="mudar('payeeAgency', $event)"
              />
              <sge-text-field
                rotulo="Conta"
                name="payeeAccount"
                [obrigatorio]="true"
                [ngModel]="form().payeeAccount"
                (ngModelChange)="mudar('payeeAccount', $event)"
              />
            </div>
          }
        }
      </section>

      <div class="rodape espaco">
        <p-button
          label="Revisar e enviar"
          icon="pi pi-send"
          type="submit"
          [disabled]="enviando()"
        />
      </div>
    </form>

    <p-dialog
      [visible]="confirmando()"
      (visibleChange)="confirmando.set($event)"
      [modal]="true"
      [style]="{ width: '32rem' }"
      header="Confirmar ordem"
    >
      <p class="resumo">{{ resumo() }}</p>
      <p class="secundario">
        Depois de enviada, a ordem só se cancela enquanto não sair — ou se o provedor suportar
        (RF-065).
      </p>

      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          [disabled]="enviando()"
          (onClick)="confirmando.set(false)"
        />
        <p-button
          label="Enviar ordem"
          icon="pi pi-check"
          [loading]="enviando()"
          [disabled]="enviando()"
          (onClick)="enviar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .vazio {
      margin: 0;
      font-size: 0.85rem;
      color: var(--p-text-muted-color);
    }
    .rodape {
      display: flex;
      justify-content: flex-end;
    }
    .resumo {
      margin-top: 0;
      font-size: 0.9rem;
    }
  `,
})
export class PaymentFormPage {
  private readonly api = inject(BankingApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly opcoesSentido = OPCOES_SENTIDO;
  protected readonly opcoesMetodo = OPCOES_METODO_ORDEM;

  protected readonly form = signal<FormOrdem>({ ...VAZIO });
  protected readonly contas = signal<CompanyBankAccount[]>([]);
  protected readonly erroContas = signal<unknown>(null);
  protected readonly tentou = signal(false);
  protected readonly confirmando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly erro = signal<unknown>(null);

  /** Chave desta ordem (RF-067). Só troca quando o servidor recusou de vez e o usuário mudou algo. */
  private chave = novaChaveIdempotencia();
  private recusada = false;

  /** Conta que paga para pagamento, conta que recebe para recebimento. */
  protected readonly opcoesConta = computed(() => {
    const direcao = this.form().direction;
    return this.contas()
      .filter((c) => (direcao === 'DEBITO' ? c.allowsPayment : c.allowsReceipt))
      .map(opcaoConta);
  });

  protected readonly dicaConta = computed(() =>
    this.form().direction === 'DEBITO'
      ? 'Contas ativas habilitadas a pagar'
      : 'Contas ativas habilitadas a receber',
  );

  protected readonly problema = computed(() => {
    const form = this.form();
    if (!form.bankAccountId) return 'Escolha a conta.';
    const conta = this.contas().find((c) => c.id === form.bankAccountId);
    if (conta && form.direction === 'DEBITO' && !conta.allowsPayment) {
      return 'A conta escolhida não está habilitada para pagamento.';
    }
    if (conta && form.direction === 'CREDITO' && !conta.allowsReceipt) {
      return 'A conta escolhida não está habilitada para recebimento.';
    }
    if (paraCentavos(form.amount) <= 0n) return 'Informe um valor maior que zero.';
    if (form.scheduledFor) {
      if (!dataValida(form.scheduledFor)) return 'Data de agendamento inválida.';
      if (form.scheduledFor < hoje()) return 'A data de agendamento não pode estar no passado.';
    }
    const documento = somenteDigitos(form.payeeDocument);
    if (documento && !/^(\d{11}|\d{14})$/.test(documento)) {
      return 'O documento do favorecido deve ser um CPF (11 dígitos) ou CNPJ (14 dígitos).';
    }
    return problemaFavorecido(form);
  });

  protected readonly resumo = computed(() => {
    const form = this.form();
    const conta = this.contas().find((c) => c.id === form.bankAccountId);
    const metodo = form.method ? ROTULO_METODO[form.method] : '';
    const destino = form.payeeName.trim() || form.pixKey.trim() || form.payeeAccount.trim();
    const quando = form.scheduledFor
      ? `agendada para ${formatDate(form.scheduledFor)}`
      : 'para execução assim que possível';
    return (
      `${ROTULO_SENTIDO[form.direction]} por ${metodo} de ${formatCurrency(form.amount ?? '0')}` +
      (conta ? ` na conta ${conta.description} (${identificacaoConta(conta)})` : '') +
      (destino ? `, ${form.direction === 'DEBITO' ? 'para' : 'de'} ${destino}` : '') +
      `, ${quando}.`
    );
  });

  constructor() {
    this.api
      .listAccounts({ pageSize: 100, isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => {
          this.contas.set(resultado.data);
          const padrao = resultado.data.find((c) => c.isDefault && c.allowsPayment);
          if (padrao && !this.form().bankAccountId) this.mudar('bankAccountId', padrao.id);
        },
        error: (falha: unknown) => this.erroContas.set(falha),
      });
  }

  protected mudar<K extends keyof FormOrdem>(campo: K, valor: FormOrdem[K]): void {
    if (this.recusada) {
      this.chave = novaChaveIdempotencia();
      this.recusada = false;
    }
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  /** Valida e abre o resumo — nada sai daqui sem a segunda confirmação. */
  protected revisar(): void {
    this.tentou.set(true);
    if (this.problema() !== null || this.enviando()) return;
    this.confirmando.set(true);
  }

  protected enviar(): void {
    if (this.enviando() || this.problema() !== null) return;
    this.enviando.set(true);
    this.erro.set(null);

    this.api
      .createPayment(this.paraDto(), this.chave)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ordem) => {
          this.enviando.set(false);
          this.confirmando.set(false);
          void this.router.navigate(['/bancos/ordens', ordem.id]);
        },
        error: (falha: unknown) => {
          this.enviando.set(false);
          this.confirmando.set(false);
          this.erro.set(falha);
          this.recusada = falha instanceof ApiError && RECUSAS_DEFINITIVAS.includes(falha.status);
        },
      });
  }

  /** Só os campos do destino da modalidade: sobra de outra modalidade não vai ao banco. */
  private paraDto(): PaymentInput {
    const form = this.form();
    const texto = (valor: string) => valor.trim() || undefined;
    const digitos = (valor: string) => somenteDigitos(valor) || undefined;
    const dto: PaymentInput = {
      bankAccountId: form.bankAccountId,
      direction: form.direction,
      method: form.method as PaymentMethodType,
      amount: form.amount ?? '0',
      description: texto(form.description),
      scheduledFor: form.scheduledFor || undefined,
      payeeName: texto(form.payeeName),
      payeeDocument: digitos(form.payeeDocument),
    };
    switch (form.method) {
      case 'PIX':
        dto.pixKey = texto(form.pixKey);
        break;
      case 'BOLETO':
        dto.barcode = digitos(form.barcode);
        break;
      case 'TED':
      case 'DOC':
        dto.payeeBankCode = digitos(form.payeeBankCode);
        dto.payeeAgency = digitos(form.payeeAgency);
        dto.payeeAccount = digitos(form.payeeAccount);
        break;
      case 'TRANSFERENCIA_INTERNA':
        dto.payeeAccount = digitos(form.payeeAccount);
        break;
    }
    return dto;
  }
}
