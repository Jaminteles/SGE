import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CheckboxModule } from 'primeng/checkbox';

import type { BankAccount, BankAccountInput } from '../core/api/types';
import type { OpcaoFiltro } from './filter-bar';
import { SelectField } from './select-field';
import { TextField } from './text-field';

export const OPCOES_TIPO_CONTA: OpcaoFiltro[] = [
  { value: 'CORRENTE', label: 'Conta corrente' },
  { value: 'POUPANCA', label: 'Poupança' },
  { value: 'PAGAMENTO', label: 'Conta de pagamento' },
];

export const OPCOES_CHAVE_PIX: OpcaoFiltro[] = [
  { value: 'CPF', label: 'CPF' },
  { value: 'CNPJ', label: 'CNPJ' },
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'TELEFONE', label: 'Telefone' },
  { value: 'ALEATORIA', label: 'Aleatória' },
];

/** Estado do formulário: tudo string, como o usuário digita. */
export interface FormularioConta {
  bankCode: string;
  bankName: string;
  agency: string;
  agencyDigit: string;
  account: string;
  accountDigit: string;
  accountType: string;
  holderName: string;
  holderDocument: string;
  pixKey: string;
  pixKeyType: string;
  isPrimary: boolean;
}

export const CONTA_VAZIA: FormularioConta = {
  bankCode: '',
  bankName: '',
  agency: '',
  agencyDigit: '',
  account: '',
  accountDigit: '',
  accountType: '',
  holderName: '',
  holderDocument: '',
  pixKey: '',
  pixKeyType: '',
  isPrimary: false,
};

/** Preenche o formulário a partir da conta devolvida pela API. */
export function contaParaFormulario(conta: BankAccount): FormularioConta {
  return {
    bankCode: conta.bankCode ?? '',
    bankName: conta.bankName ?? '',
    agency: conta.agency ?? '',
    agencyDigit: conta.agencyDigit ?? '',
    account: conta.account ?? '',
    accountDigit: conta.accountDigit ?? '',
    accountType: conta.accountType ?? '',
    holderName: conta.holderName ?? '',
    holderDocument: conta.holderDocument ?? '',
    pixKey: conta.pixKey ?? '',
    pixKeyType: conta.pixKeyType ?? '',
    isPrimary: conta.isPrimary,
  };
}

/**
 * Monta o corpo da requisição. Campo em branco não vai: o backend valida cada
 * opcional, e mandar `""` num campo com `@Matches` vira 400 em vez de "não
 * informado".
 */
export function contaParaDto(form: FormularioConta): BankAccountInput {
  const dto: BankAccountInput = { isPrimary: form.isPrimary };
  const opcionais: [keyof BankAccountInput, string][] = [
    ['bankCode', form.bankCode.replace(/\D/g, '')],
    ['bankName', form.bankName],
    ['agency', form.agency.replace(/\D/g, '')],
    ['agencyDigit', form.agencyDigit],
    ['account', form.account.replace(/\D/g, '')],
    ['accountDigit', form.accountDigit],
    ['accountType', form.accountType],
    ['holderName', form.holderName],
    ['holderDocument', form.holderDocument.replace(/\D/g, '')],
    ['pixKey', form.pixKey],
    ['pixKeyType', form.pixKeyType],
  ];
  for (const [chave, valor] of opcionais) {
    const limpo = valor.trim();
    if (limpo !== '') Object.assign(dto, { [chave]: limpo });
  }
  return dto;
}

/** Banco e agência formatados para a listagem. */
export function descricaoBanco(conta: BankAccount): string {
  return [conta.bankCode, conta.bankName].filter(Boolean).join(' — ') || '—';
}

export function descricaoAgencia(conta: BankAccount): string {
  if (!conta.agency) return '—';
  return conta.agencyDigit ? `${conta.agency}-${conta.agencyDigit}` : conta.agency;
}

export function descricaoConta(conta: BankAccount): string {
  if (!conta.account) return '—';
  return conta.accountDigit ? `${conta.account}-${conta.accountDigit}` : conta.account;
}

/**
 * Campos de dado bancário (`gestao.dado_bancario`).
 *
 * O contrato é o mesmo para funcionário (RF-013) e parceiro (RF-024) — muda só
 * o dono da conta e a permissão exigida —, então os campos vivem aqui em vez de
 * serem redigitados em cada módulo.
 *
 * É por aqui que o dinheiro sai da empresa: toda alteração fica na trilha de
 * auditoria do backend.
 */
@Component({
  selector: 'sge-bank-account-fields',
  imports: [FormsModule, CheckboxModule, SelectField, TextField],
  template: `
    <div class="grade-campos">
      <sge-text-field
        rotulo="Código do banco"
        name="bankCode"
        dica="COMPE, 3 a 5 dígitos"
        [ngModel]="valor().bankCode"
        (ngModelChange)="mudar('bankCode', $event)"
      />
      <sge-text-field
        rotulo="Nome do banco"
        name="bankName"
        [ngModel]="valor().bankName"
        (ngModelChange)="mudar('bankName', $event)"
      />
      <sge-text-field
        rotulo="Agência"
        name="agency"
        [ngModel]="valor().agency"
        (ngModelChange)="mudar('agency', $event)"
      />
      <sge-text-field
        rotulo="Dígito da agência"
        name="agencyDigit"
        [ngModel]="valor().agencyDigit"
        (ngModelChange)="mudar('agencyDigit', $event)"
      />
      <sge-text-field
        rotulo="Conta"
        name="account"
        [ngModel]="valor().account"
        (ngModelChange)="mudar('account', $event)"
      />
      <sge-text-field
        rotulo="Dígito da conta"
        name="accountDigit"
        [ngModel]="valor().accountDigit"
        (ngModelChange)="mudar('accountDigit', $event)"
      />
      <sge-select-field
        rotulo="Tipo de conta"
        name="accountType"
        [opcoes]="OPCOES_TIPO_CONTA"
        [ngModel]="valor().accountType"
        (ngModelChange)="mudar('accountType', $event ?? '')"
      />
      <sge-text-field
        rotulo="Titular"
        name="holderName"
        [dica]="dicaTitular()"
        [ngModel]="valor().holderName"
        (ngModelChange)="mudar('holderName', $event)"
      />
      <sge-text-field
        rotulo="CPF/CNPJ do titular"
        name="holderDocument"
        [ngModel]="valor().holderDocument"
        (ngModelChange)="mudar('holderDocument', $event)"
      />
      <sge-text-field
        rotulo="Chave PIX"
        name="pixKey"
        [ngModel]="valor().pixKey"
        (ngModelChange)="mudar('pixKey', $event)"
      />
      <sge-select-field
        rotulo="Tipo da chave"
        name="pixKeyType"
        [opcoes]="OPCOES_CHAVE_PIX"
        [ngModel]="valor().pixKeyType"
        (ngModelChange)="mudar('pixKeyType', $event ?? '')"
      />
      <label class="principal">
        <p-checkbox
          name="isPrimary"
          [binary]="true"
          [ngModel]="valor().isPrimary"
          (ngModelChange)="mudar('isPrimary', $event)"
        />
        <span>Conta principal para crédito</span>
      </label>
    </div>
  `,
  styles: `
    .principal {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--p-text-color);
    }
  `,
})
export class BankAccountFields {
  readonly valor = input.required<FormularioConta>();
  /** Texto de apoio do titular — muda entre funcionário e parceiro. */
  readonly dicaTitular = input('Preencha quando diferente do dono da conta');

  readonly mudou = output<FormularioConta>();

  protected readonly OPCOES_TIPO_CONTA = OPCOES_TIPO_CONTA;
  protected readonly OPCOES_CHAVE_PIX = OPCOES_CHAVE_PIX;

  protected mudar<K extends keyof FormularioConta>(campo: K, novo: FormularioConta[K]): void {
    this.mudou.emit({ ...this.valor(), [campo]: novo });
  }
}
