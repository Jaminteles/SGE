import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { BankingApiService } from '../core/api/banking-api.service';
import type {
  BankProvider,
  CompanyAccountType,
  CompanyBankAccount,
  CompanyBankAccountInput,
  CompanyBankAccountUpdateInput,
  IntegrationCredential,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  FILTRO_HABILITACAO,
  FILTRO_SITUACAO_CONTA,
  OPCOES_TIPO_CONTA,
  ROTULO_TIPO_CONTA,
  consultaConta,
  identificacaoConta,
  somenteDigitos,
} from './rotulos';

export interface FormConta {
  description: string;
  bankCode: string;
  bankName: string;
  agency: string;
  agencyDigit: string;
  account: string;
  accountDigit: string;
  accountType: CompanyAccountType;
  pixKey: string;
  providerId: string;
  credentialId: string;
  /** Decimal canônico em string (RN-012). */
  openingBalance: string | null;
  allowsPayment: boolean;
  allowsReceipt: boolean;
  isDefault: boolean;
  note: string;
}

const VAZIO: FormConta = {
  description: '',
  bankCode: '',
  bankName: '',
  agency: '',
  agencyDigit: '',
  account: '',
  accountDigit: '',
  accountType: 'CORRENTE',
  pixKey: '',
  providerId: '',
  credentialId: '',
  openingBalance: '0.00',
  allowsPayment: true,
  allowsReceipt: true,
  isDefault: false,
  note: '',
};

/**
 * O que dá para recusar antes da requisição, com as regras do
 * `CreateCompanyAccountDto`. Banco, agência e conta só contam na criação: são a
 * identidade da conta e não se alteram depois.
 */
export function problemaConta(form: FormConta, nova: boolean): string | null {
  if (!form.description.trim()) return 'Informe a descrição da conta.';
  if (nova) {
    if (!/^\d{3,5}$/.test(somenteDigitos(form.bankCode))) {
      return 'O código do banco deve ter de 3 a 5 dígitos.';
    }
    if (!/^\d{1,10}$/.test(somenteDigitos(form.agency))) return 'Informe a agência.';
    if (!/^\d{1,20}$/.test(somenteDigitos(form.account))) return 'Informe o número da conta.';
  }
  if (form.agencyDigit.trim() && !/^[0-9Xx]$/.test(form.agencyDigit.trim())) {
    return 'O dígito da agência deve ser um número ou X.';
  }
  if (form.accountDigit.trim() && !/^[0-9Xx]$/.test(form.accountDigit.trim())) {
    return 'O dígito da conta deve ser um número ou X.';
  }
  if (form.credentialId && !form.providerId) return 'Escolha o provedor da credencial.';
  return null;
}

/**
 * Contas bancárias da empresa (RF-059 — UI-042).
 *
 * O saldo exibido é o **informado pelo banco** no último extrato importado
 * (RF-060) — não é digitável nem recalculado aqui. Conta não se remove: ela é
 * referenciada por ordens, extratos e baixas; o que existe é desativar.
 */
@Component({
  selector: 'sge-bank-accounts-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    TagModule,
    Alert,
    DataTable,
    DecimalField,
    ErrorAlert,
    FilterBar,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Bancos / Contas</p>

    <div class="pagehead">
      <div>
        <h1>Contas bancárias</h1>
        <p>Contas da empresa, saldo informado pelo banco e situação (RF-059).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Nova conta" icon="pi pi-plus" (onClick)="abrir(null)" />
        }
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar por descrição, banco ou conta"
      [valores]="lista.filtros()"
      [filtros]="filtros"
      (mudou)="lista.aplicarFiltros($event)"
    />

    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    <section class="card table-card espaco">
      <sge-data-table
        [colunas]="colunas"
        [linhas]="lista.linhas()"
        [total]="lista.total()"
        [pagina]="lista.pagina()"
        [tamanhoPagina]="lista.tamanhoPagina()"
        [carregando]="lista.carregando()"
        [mensagemVazia]="
          lista.temFiltro() ? 'Nenhuma conta atende aos filtros.' : 'Nenhuma conta cadastrada.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-conta>
          <tr>
            <td>
              {{ conta.description }}
              @if (conta.isDefault) {
                <p-tag value="Padrão" severity="info" [rounded]="true" />
              }
              <span class="secundario">{{ identificacao(conta) }}</span>
            </td>
            <td>{{ tipo(conta.accountType) }}</td>
            <td class="numero">
              {{ moeda(conta.currentBalance) }}
              <span class="secundario">{{ dataSaldo(conta) }}</span>
            </td>
            <td>
              <span class="marcas">
                @if (conta.allowsPayment) {
                  <p-tag value="Paga" severity="secondary" [rounded]="true" />
                }
                @if (conta.allowsReceipt) {
                  <p-tag value="Recebe" severity="secondary" [rounded]="true" />
                }
              </span>
            </td>
            <td>
              <p-tag
                [value]="conta.isActive ? 'Ativa' : 'Inativa'"
                [severity]="conta.isActive ? 'success' : 'secondary'"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              @if (podeVerMovimentos()) {
                <p-button
                  label="Movimentos"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  routerLink="/bancos/movimentos"
                  [queryParams]="{ bankAccountId: conta.id }"
                />
              }
              @if (podeAlterar()) {
                <p-button
                  label="Editar"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  (onClick)="abrir(conta)"
                />
                <p-button
                  [label]="conta.isActive ? 'Desativar' : 'Ativar'"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  [disabled]="alternando() === conta.id"
                  (onClick)="alternarSituacao(conta)"
                />
              }
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>

    <p-dialog
      [visible]="aberto()"
      (visibleChange)="aberto.set($event)"
      [modal]="true"
      [style]="{ width: '44rem' }"
      [header]="editada() ? 'Editar conta bancária' : 'Nova conta bancária'"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      @if (tentou() && problema(); as texto) {
        <sge-alert tom="aviso" [titulo]="texto" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvar()">
        <sge-text-field
          rotulo="Descrição"
          name="description"
          dica="Como a conta aparece nas telas"
          [obrigatorio]="true"
          [ngModel]="form().description"
          (ngModelChange)="mudar('description', $event)"
        />
        <sge-select-field
          rotulo="Tipo"
          name="accountType"
          [opcoes]="opcoesTipo"
          [ngModel]="form().accountType"
          (ngModelChange)="mudar('accountType', $event ?? 'CORRENTE')"
        />

        @if (editada(); as conta) {
          <p class="identidade">
            {{ identificacao(conta) }}
            <span class="secundario">Banco, agência e conta não se alteram: abra outra conta.</span>
          </p>
        } @else {
          <sge-text-field
            rotulo="Código do banco"
            name="bankCode"
            dica="COMPE, ex.: 341"
            [obrigatorio]="true"
            [ngModel]="form().bankCode"
            (ngModelChange)="mudar('bankCode', $event)"
          />
          <sge-text-field
            rotulo="Agência"
            name="agency"
            [obrigatorio]="true"
            [ngModel]="form().agency"
            (ngModelChange)="mudar('agency', $event)"
          />
          <sge-text-field
            rotulo="Conta"
            name="account"
            [obrigatorio]="true"
            [ngModel]="form().account"
            (ngModelChange)="mudar('account', $event)"
          />
        }
        <sge-text-field
          rotulo="Nome do banco"
          name="bankName"
          [ngModel]="form().bankName"
          (ngModelChange)="mudar('bankName', $event)"
        />
        <sge-text-field
          rotulo="Dígito da agência"
          name="agencyDigit"
          [ngModel]="form().agencyDigit"
          (ngModelChange)="mudar('agencyDigit', $event)"
        />
        <sge-text-field
          rotulo="Dígito da conta"
          name="accountDigit"
          [ngModel]="form().accountDigit"
          (ngModelChange)="mudar('accountDigit', $event)"
        />
        <sge-text-field
          rotulo="Chave PIX de recebimento"
          name="pixKey"
          [ngModel]="form().pixKey"
          (ngModelChange)="mudar('pixKey', $event)"
        />
        <sge-decimal-field
          rotulo="Saldo de abertura"
          name="openingBalance"
          dica="Só para conferência — o saldo atual vem do extrato"
          [ngModel]="form().openingBalance"
          (ngModelChange)="mudar('openingBalance', $event)"
        />

        @if (podeVerProvedores()) {
          <sge-select-field
            rotulo="Provedor de integração"
            name="providerId"
            placeholder="Manual (sem integração)"
            dica="Vazio: as ordens ficam para confirmação manual"
            [opcoes]="opcoesProvedor()"
            [ngModel]="form().providerId"
            (ngModelChange)="mudarProvedor($event ?? '')"
          />
          <sge-select-field
            rotulo="Credencial"
            name="credentialId"
            placeholder="Sem credencial"
            [opcoes]="opcoesCredencial()"
            [ngModel]="form().credentialId"
            (ngModelChange)="mudar('credentialId', $event ?? '')"
          />
        }

        <div class="marcadores">
          <label>
            <input
              type="checkbox"
              name="allowsPayment"
              [ngModel]="form().allowsPayment"
              (ngModelChange)="mudar('allowsPayment', $event)"
            />
            Habilitada a pagar
          </label>
          <label>
            <input
              type="checkbox"
              name="allowsReceipt"
              [ngModel]="form().allowsReceipt"
              (ngModelChange)="mudar('allowsReceipt', $event)"
            />
            Habilitada a receber
          </label>
          <label>
            <input
              type="checkbox"
              name="isDefault"
              [ngModel]="form().isDefault"
              (ngModelChange)="mudar('isDefault', $event)"
            />
            Conta padrão da empresa
          </label>
        </div>

        <sge-text-field
          rotulo="Observação"
          name="note"
          [ngModel]="form().note"
          (ngModelChange)="mudar('note', $event)"
        />
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
          [disabled]="salvando()"
          (onClick)="salvar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .numero {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .marcas {
      display: inline-flex;
      gap: 0.3rem;
    }
    .formulario {
      padding-top: 0.5rem;
    }
    .identidade {
      grid-column: 1 / -1;
      margin: 0;
      font-size: 0.85rem;
    }
    .marcadores {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      gap: 1.25rem;
      font-size: 0.85rem;
    }
    .marcadores label {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
  `,
})
export class BankAccountsPage {
  private readonly api = inject(BankingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas: Coluna[] = [
    { campo: 'description', cabecalho: 'Conta' },
    { campo: 'accountType', cabecalho: 'Tipo', largura: '10rem' },
    { campo: 'currentBalance', cabecalho: 'Saldo informado pelo banco', largura: '12rem' },
    { campo: 'movimenta', cabecalho: 'Movimenta', largura: '9rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '7rem' },
    { campo: 'acoes', cabecalho: '', largura: '17rem' },
  ];

  protected readonly filtros = [FILTRO_SITUACAO_CONTA, FILTRO_HABILITACAO];
  protected readonly opcoesTipo = OPCOES_TIPO_CONTA;

  protected readonly lista = new ListState<CompanyBankAccount>(
    (consulta) => this.api.listAccounts(consulta),
    consultaConta,
  );

  protected readonly podeCriar = () => this.permissoes.pode('company-bank-accounts:CREATE');
  protected readonly podeAlterar = () => this.permissoes.pode('company-bank-accounts:UPDATE');
  protected readonly podeVerMovimentos = () => this.permissoes.pode('bank-statements:READ');
  /** Provedor e credencial só aparecem para quem pode ler o catálogo (RF-061). */
  protected readonly podeVerProvedores = () =>
    this.permissoes.pode('integration-credentials:READ');

  protected readonly aberto = signal(false);
  protected readonly editada = signal<CompanyBankAccount | null>(null);
  protected readonly form = signal<FormConta>({ ...VAZIO });
  protected readonly tentou = signal(false);
  protected readonly salvando = signal(false);
  protected readonly erroForm = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly alternando = signal<string | null>(null);

  private readonly provedores = signal<BankProvider[]>([]);
  private readonly credenciais = signal<IntegrationCredential[]>([]);
  private catalogoCarregado = false;

  protected readonly problema = computed(() => problemaConta(this.form(), !this.editada()));

  protected readonly opcoesProvedor = computed<OpcaoFiltro[]>(() =>
    this.provedores().map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
  );

  /** Só as credenciais do provedor escolhido: credencial de outro banco não autentica. */
  protected readonly opcoesCredencial = computed<OpcaoFiltro[]>(() => {
    const provedor = this.form().providerId;
    return this.credenciais()
      .filter((c) => c.isActive && (!provedor || c.provider.id === provedor))
      .map((c) => ({ value: c.id, label: `${c.name} · ${c.environment}` }));
  });

  constructor() {
    this.lista.carregar();
  }

  protected identificacao(conta: CompanyBankAccount): string {
    return identificacaoConta(conta);
  }

  protected tipo(valor: CompanyAccountType): string {
    return ROTULO_TIPO_CONTA[valor] ?? valor;
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected dataSaldo(conta: CompanyBankAccount): string {
    return conta.balanceDate
      ? `Extrato de ${formatDate(conta.balanceDate)}`
      : 'Sem extrato importado';
  }

  protected mudar<K extends keyof FormConta>(campo: K, valor: FormConta[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarProvedor(providerId: string): void {
    // Trocar de provedor invalida a credencial escolhida para o anterior.
    this.form.update((atual) => ({ ...atual, providerId, credentialId: '' }));
  }

  protected abrir(conta: CompanyBankAccount | null): void {
    this.editada.set(conta);
    this.erroForm.set(null);
    this.tentou.set(false);
    this.form.set(
      conta
        ? {
            description: conta.description,
            bankCode: conta.bankCode,
            bankName: conta.bankName ?? '',
            agency: conta.agency,
            agencyDigit: conta.agencyDigit ?? '',
            account: conta.account,
            accountDigit: conta.accountDigit ?? '',
            accountType: conta.accountType,
            pixKey: conta.pixKey ?? '',
            providerId: conta.providerId ?? '',
            credentialId: conta.credentialId ?? '',
            openingBalance: conta.openingBalance,
            allowsPayment: conta.allowsPayment,
            allowsReceipt: conta.allowsReceipt,
            isDefault: conta.isDefault,
            note: conta.note ?? '',
          }
        : { ...VAZIO },
    );
    this.carregarCatalogo();
    this.aberto.set(true);
  }

  protected salvar(): void {
    if (this.salvando()) return;
    this.tentou.set(true);
    if (this.problema() !== null) return;

    this.salvando.set(true);
    this.erroForm.set(null);
    const alvo = this.editada();
    const requisicao = alvo
      ? this.api.updateAccount(alvo.id, this.paraAlteracao())
      : this.api.createAccount(this.paraCriacao());

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvando.set(false);
        this.aberto.set(false);
        this.aviso.set(alvo ? 'Conta atualizada.' : 'Conta cadastrada.');
        this.lista.carregar();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroForm.set(falha);
      },
    });
  }

  protected alternarSituacao(conta: CompanyBankAccount): void {
    if (this.alternando()) return;
    this.alternando.set(conta.id);
    this.aviso.set(null);
    this.api
      .updateAccount(conta.id, { isActive: !conta.isActive })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.alternando.set(null);
          this.aviso.set(
            conta.isActive ? `Conta ${conta.description} desativada.` : `Conta ${conta.description} ativada.`,
          );
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.alternando.set(null);
          this.lista.erro.set(falha);
        },
      });
  }

  /** Campos alteráveis — nunca banco, agência e conta (`UpdateCompanyAccountDto`). */
  private paraAlteracao(): CompanyBankAccountUpdateInput {
    const form = this.form();
    const texto = (valor: string) => valor.trim() || undefined;
    return {
      description: form.description.trim(),
      bankName: texto(form.bankName),
      agencyDigit: texto(form.agencyDigit)?.toUpperCase(),
      accountDigit: texto(form.accountDigit)?.toUpperCase(),
      accountType: form.accountType,
      pixKey: texto(form.pixKey),
      providerId: form.providerId || undefined,
      credentialId: form.credentialId || undefined,
      openingBalance: form.openingBalance || undefined,
      allowsPayment: form.allowsPayment,
      allowsReceipt: form.allowsReceipt,
      isDefault: form.isDefault,
      note: texto(form.note),
    };
  }

  private paraCriacao(): CompanyBankAccountInput {
    const form = this.form();
    return {
      ...this.paraAlteracao(),
      description: form.description.trim(),
      bankCode: somenteDigitos(form.bankCode),
      agency: somenteDigitos(form.agency),
      account: somenteDigitos(form.account),
    };
  }

  private carregarCatalogo(): void {
    if (this.catalogoCarregado || !this.podeVerProvedores()) return;
    this.catalogoCarregado = true;
    this.api
      .listProviders()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (lista) => this.provedores.set(lista), error: () => this.provedores.set([]) });
    this.api
      .listCredentials()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lista) => this.credenciais.set(lista),
        error: () => this.credenciais.set([]),
      });
  }
}
