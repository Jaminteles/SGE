import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import { PartnersApiService } from '../core/api/partners-api.service';
import { PaymentConditionsApiService } from '../core/api/payment-conditions-api.service';
import type {
  BankAccount,
  Partner,
  PartnerAddress,
  PartnerAddressInput,
  PartnerContact,
  PartnerContactInput,
  PartnerHistory,
  PartnerInput,
  PersonType,
  CustomerProfileInput,
  SupplierProfileInput,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatCnpj, formatDate } from '../core/lib/format';
import { Alert } from '../ui/alert';
import {
  BankAccountFields,
  CONTA_VAZIA,
  type FormularioConta,
  contaParaDto,
  contaParaFormulario,
  descricaoAgencia,
  descricaoBanco,
  descricaoConta,
} from '../ui/bank-account-fields';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { OPCOES_ENDERECO, OPCOES_PESSOA, ROTULO_ENDERECO, rotuloPapel } from './rotulos';

type Secao = 'identificacao' | 'enderecos' | 'contatos' | 'bancarios' | 'historico';

interface Formulario {
  personType: string;
  code: string;
  legalName: string;
  tradeName: string;
  cnpj: string;
  cpf: string;
  foreignDocument: string;
  stateRegistration: string;
  municipalRegistration: string;
  icmsTaxpayer: boolean;
  email: string;
  phone: string;
  website: string;
  isCustomer: boolean;
  isSupplier: boolean;
  note: string;
  creditLimit: string;
  customerPaymentTermId: string;
  customerPaymentMethodId: string;
  supplierPaymentTermId: string;
  supplierPaymentMethodId: string;
  supplierDefaultCategoryId: string;
  supplierDeliveryDays: string;
}

const VAZIO: Formulario = {
  personType: 'PJ',
  code: '',
  legalName: '',
  tradeName: '',
  cnpj: '',
  cpf: '',
  foreignDocument: '',
  stateRegistration: '',
  municipalRegistration: '',
  icmsTaxpayer: false,
  email: '',
  phone: '',
  website: '',
  isCustomer: false,
  isSupplier: false,
  note: '',
  creditLimit: '',
  customerPaymentTermId: '',
  customerPaymentMethodId: '',
  supplierPaymentTermId: '',
  supplierPaymentMethodId: '',
  supplierDefaultCategoryId: '',
  supplierDeliveryDays: '',
};

interface FormularioEndereco {
  type: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  zipCode: string;
  isPrimary: boolean;
}

const ENDERECO_VAZIO: FormularioEndereco = {
  type: 'PRINCIPAL',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
  zipCode: '',
  isPrimary: false,
};

interface FormularioContato {
  name: string;
  role: string;
  email: string;
  phone: string;
  mobile: string;
  isPrimary: boolean;
}

const CONTATO_VAZIO: FormularioContato = {
  name: '',
  role: '',
  email: '',
  phone: '',
  mobile: '',
  isPrimary: false,
};

/**
 * Cadastro do parceiro com contatos, endereços e dados bancários (RF-022 a
 * RF-026 — UI-018).
 *
 * As seções do Figma são abas de uma tela só. Cada uma é um recurso próprio do
 * backend, com permissão própria: só é consultada quando o usuário abre a aba,
 * e só aparece depois que o parceiro existe.
 *
 * Papel e perfil andam juntos: marcar cliente ou fornecedor cria a linha de
 * perfil no backend. Desmarcar **não apaga** o perfil — limite de crédito e
 * condição negociada continuam guardados para quando o papel voltar.
 */
@Component({
  selector: 'sge-partner-form-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    TagModule,
    Alert,
    BankAccountFields,
    DecimalField,
    ErrorAlert,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Cadastros / Parceiros / {{ titulo() }}</p>

    <div class="pagehead">
      <div>
        <h1>{{ titulo() }}</h1>
        <p>{{ subtitulo() }}</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          routerLink="/cadastros/parceiros"
        />
        @if (secao() === 'identificacao' && podeSalvar()) {
          <p-button
            label="Salvar"
            icon="pi pi-check"
            [loading]="salvando()"
            [disabled]="salvando()"
            (onClick)="salvar()"
          />
        }
      </div>
    </div>

    @if (registro()) {
      <nav class="secoes" aria-label="Seções do parceiro">
        @for (aba of abas(); track aba.path) {
          <button
            type="button"
            class="secoes__item"
            [class.secoes__item--ativa]="secao() === aba.path"
            (click)="trocar(aba.path)"
          >
            {{ aba.label }}
          </button>
        }
      </nav>
    }

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    @if (secao() === 'identificacao') {
      <section class="card secao">
        <h2 class="secao__titulo">Identificação</h2>
        <div class="grade-campos">
          <sge-select-field
            rotulo="Tipo de pessoa"
            name="personType"
            [opcoes]="OPCOES_PESSOA"
            [obrigatorio]="true"
            [ngModel]="form().personType"
            (ngModelChange)="mudar('personType', $event ?? '')"
          />
          <sge-text-field
            rotulo="Código interno"
            name="code"
            [ngModel]="form().code"
            (ngModelChange)="mudar('code', $event)"
          />
          <sge-text-field
            rotulo="Razão social / nome"
            name="legalName"
            [obrigatorio]="true"
            [ngModel]="form().legalName"
            (ngModelChange)="mudar('legalName', $event)"
          />
          <sge-text-field
            rotulo="Nome fantasia"
            name="tradeName"
            [ngModel]="form().tradeName"
            (ngModelChange)="mudar('tradeName', $event)"
          />
          @if (form().personType === 'PJ') {
            <sge-text-field
              rotulo="CNPJ"
              name="cnpj"
              dica="Com ou sem máscara"
              [ngModel]="form().cnpj"
              (ngModelChange)="mudar('cnpj', $event)"
            />
          } @else if (form().personType === 'PF') {
            <sge-text-field
              rotulo="CPF"
              name="cpf"
              dica="Com ou sem máscara"
              [ngModel]="form().cpf"
              (ngModelChange)="mudar('cpf', $event)"
            />
          } @else {
            <sge-text-field
              rotulo="Documento estrangeiro"
              name="foreignDocument"
              [ngModel]="form().foreignDocument"
              (ngModelChange)="mudar('foreignDocument', $event)"
            />
          }
          <sge-text-field
            rotulo="Inscrição estadual"
            name="stateRegistration"
            [ngModel]="form().stateRegistration"
            (ngModelChange)="mudar('stateRegistration', $event)"
          />
          <sge-text-field
            rotulo="Inscrição municipal"
            name="municipalRegistration"
            [ngModel]="form().municipalRegistration"
            (ngModelChange)="mudar('municipalRegistration', $event)"
          />
          <sge-text-field
            rotulo="E-mail"
            name="email"
            tipo="email"
            [ngModel]="form().email"
            (ngModelChange)="mudar('email', $event)"
          />
          <sge-text-field
            rotulo="Telefone"
            name="phone"
            [ngModel]="form().phone"
            (ngModelChange)="mudar('phone', $event)"
          />
          <sge-text-field
            rotulo="Site"
            name="website"
            dica="Com protocolo (https://)"
            [ngModel]="form().website"
            (ngModelChange)="mudar('website', $event)"
          />
          <label class="marcador">
            <p-checkbox
              name="icmsTaxpayer"
              [binary]="true"
              [ngModel]="form().icmsTaxpayer"
              (ngModelChange)="mudar('icmsTaxpayer', $event)"
            />
            <span>Contribuinte de ICMS</span>
          </label>
        </div>
      </section>

      <section class="card secao">
        <h2 class="secao__titulo">Papéis</h2>
        <div class="grade-campos">
          <label class="marcador">
            <p-checkbox
              name="isCustomer"
              [binary]="true"
              [ngModel]="form().isCustomer"
              (ngModelChange)="mudar('isCustomer', $event)"
            />
            <span>Exerce o papel de cliente (RF-022)</span>
          </label>
          <label class="marcador">
            <p-checkbox
              name="isSupplier"
              [binary]="true"
              [ngModel]="form().isSupplier"
              (ngModelChange)="mudar('isSupplier', $event)"
            />
            <span>Exerce o papel de fornecedor (RF-023)</span>
          </label>
        </div>
        <p class="nota">
          Desmarcar um papel não apaga o perfil: limite de crédito e condição negociada continuam
          guardados para quando o papel voltar.
        </p>
      </section>

      @if (form().isCustomer) {
        <section class="card secao">
          <h2 class="secao__titulo">Condições comerciais — cliente</h2>
          <div class="grade-campos">
            <sge-decimal-field
              rotulo="Limite de crédito"
              name="creditLimit"
              [ngModel]="form().creditLimit"
              (ngModelChange)="mudar('creditLimit', $event ?? '')"
            />
            <sge-select-field
              rotulo="Condição de pagamento"
              name="customerPaymentTermId"
              [opcoes]="opcoesCondicao()"
              [ngModel]="form().customerPaymentTermId"
              (ngModelChange)="mudar('customerPaymentTermId', $event ?? '')"
            />
            <sge-select-field
              rotulo="Forma de pagamento"
              name="customerPaymentMethodId"
              [opcoes]="opcoesForma()"
              [ngModel]="form().customerPaymentMethodId"
              (ngModelChange)="mudar('customerPaymentMethodId', $event ?? '')"
            />
          </div>
          @if (registro()?.customer?.isBlocked) {
            <sge-alert
              tom="aviso"
              titulo="Cliente bloqueado"
              [mensagem]="registro()?.customer?.blockReason ?? 'Sem motivo registrado.'"
            />
          }
        </section>
      }

      @if (form().isSupplier) {
        <section class="card secao">
          <h2 class="secao__titulo">Condições comerciais — fornecedor</h2>
          <div class="grade-campos">
            <sge-select-field
              rotulo="Condição de pagamento"
              name="supplierPaymentTermId"
              [opcoes]="opcoesCondicao()"
              [ngModel]="form().supplierPaymentTermId"
              (ngModelChange)="mudar('supplierPaymentTermId', $event ?? '')"
            />
            <sge-select-field
              rotulo="Forma de pagamento"
              name="supplierPaymentMethodId"
              [opcoes]="opcoesForma()"
              [ngModel]="form().supplierPaymentMethodId"
              (ngModelChange)="mudar('supplierPaymentMethodId', $event ?? '')"
            />
            <sge-select-field
              rotulo="Categoria financeira padrão"
              name="supplierDefaultCategoryId"
              [opcoes]="opcoesCategoria()"
              [ngModel]="form().supplierDefaultCategoryId"
              (ngModelChange)="mudar('supplierDefaultCategoryId', $event ?? '')"
            />
            <sge-text-field
              rotulo="Prazo médio de entrega"
              name="supplierDeliveryDays"
              tipo="number"
              dica="Em dias"
              [ngModel]="form().supplierDeliveryDays"
              (ngModelChange)="mudar('supplierDeliveryDays', $event)"
            />
          </div>
          @if (registro()?.supplier?.isBlocked) {
            <sge-alert
              tom="aviso"
              titulo="Fornecedor bloqueado"
              [mensagem]="registro()?.supplier?.blockReason ?? 'Sem motivo registrado.'"
            />
          }
        </section>
      }
    }

    @if (secao() === 'enderecos') {
      <section class="card secao">
        <div class="table-card__head">
          <h2 class="secao__titulo">Endereços</h2>
          @if (podeCriarFilho()) {
            <p-button
              label="Novo endereço"
              icon="pi pi-plus"
              size="small"
              [outlined]="true"
              (onClick)="abrirNovoEndereco()"
            />
          }
        </div>
        @if (enderecos().length === 0) {
          <p class="nota">Nenhum endereço cadastrado.</p>
        } @else {
          <table class="filhos">
            <thead>
              <tr>
                <th scope="col">Tipo</th>
                <th scope="col">Logradouro</th>
                <th scope="col">Cidade / UF</th>
                <th scope="col">CEP</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              @for (endereco of enderecos(); track endereco.id) {
                <tr>
                  <td>
                    <p-tag
                      [value]="tipoEndereco(endereco)"
                      [severity]="endereco.isPrimary ? 'success' : 'secondary'"
                      [rounded]="true"
                    />
                  </td>
                  <td>{{ logradouro(endereco) }}</td>
                  <td>{{ endereco.city }} / {{ endereco.state }}</td>
                  <td>{{ endereco.zipCode ?? '—' }}</td>
                  <td class="acoes">
                    @if (podeEditarFilho()) {
                      <p-button
                        label="Editar"
                        severity="secondary"
                        [text]="true"
                        size="small"
                        (onClick)="abrirEdicaoEndereco(endereco)"
                      />
                    }
                    @if (podeRemoverFilho()) {
                      <p-button
                        label="Remover"
                        severity="secondary"
                        [text]="true"
                        size="small"
                        (onClick)="removerEndereco(endereco)"
                      />
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }

    @if (secao() === 'contatos') {
      <section class="card secao">
        <div class="table-card__head">
          <h2 class="secao__titulo">Contatos</h2>
          @if (podeCriarFilho()) {
            <p-button
              label="Novo contato"
              icon="pi pi-plus"
              size="small"
              [outlined]="true"
              (onClick)="abrirNovoContato()"
            />
          }
        </div>
        @if (contatos().length === 0) {
          <p class="nota">Nenhum contato cadastrado.</p>
        } @else {
          <table class="filhos">
            <thead>
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Função</th>
                <th scope="col">E-mail</th>
                <th scope="col">Telefone</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              @for (contato of contatos(); track contato.id) {
                <tr>
                  <td>
                    {{ contato.name }}
                    @if (contato.isPrimary) {
                      <span class="secundario">principal</span>
                    }
                  </td>
                  <td>{{ contato.role ?? '—' }}</td>
                  <td>{{ contato.email ?? '—' }}</td>
                  <td>{{ contato.mobile ?? contato.phone ?? '—' }}</td>
                  <td class="acoes">
                    @if (podeEditarFilho()) {
                      <p-button
                        label="Editar"
                        severity="secondary"
                        [text]="true"
                        size="small"
                        (onClick)="abrirEdicaoContato(contato)"
                      />
                    }
                    @if (podeRemoverFilho()) {
                      <p-button
                        label="Remover"
                        severity="secondary"
                        [text]="true"
                        size="small"
                        (onClick)="removerContato(contato)"
                      />
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }

    @if (secao() === 'bancarios') {
      <section class="card secao">
        <div class="table-card__head">
          <h2 class="secao__titulo">Dados bancários</h2>
          @if (podeCriarConta()) {
            <p-button
              label="Nova conta"
              icon="pi pi-plus"
              size="small"
              [outlined]="true"
              (onClick)="abrirNovaConta()"
            />
          }
        </div>
        @if (contas().length === 0) {
          <p class="nota">Nenhuma conta cadastrada.</p>
        } @else {
          <table class="filhos">
            <thead>
              <tr>
                <th scope="col">Banco</th>
                <th scope="col">Agência</th>
                <th scope="col">Conta</th>
                <th scope="col">Chave PIX</th>
                <th scope="col">Situação</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              @for (conta of contas(); track conta.id) {
                <tr>
                  <td>{{ banco(conta) }}</td>
                  <td>{{ agencia(conta) }}</td>
                  <td>{{ numeroConta(conta) }}</td>
                  <td>{{ conta.pixKey ?? '—' }}</td>
                  <td>
                    <p-tag
                      [value]="conta.isPrimary ? 'Principal' : 'Secundária'"
                      [severity]="conta.isPrimary ? 'success' : 'secondary'"
                      [rounded]="true"
                    />
                  </td>
                  <td class="acoes">
                    @if (podeEditarConta()) {
                      <p-button
                        label="Editar"
                        severity="secondary"
                        [text]="true"
                        size="small"
                        (onClick)="abrirEdicaoConta(conta)"
                      />
                    }
                    @if (podeRemoverConta()) {
                      <p-button
                        label="Remover"
                        severity="secondary"
                        [text]="true"
                        size="small"
                        (onClick)="removerConta(conta)"
                      />
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
        <p class="nota">
          É por aqui que o dinheiro sai da empresa: toda alteração fica na trilha de auditoria
          (RF-024/RF-117).
        </p>
      </section>
    }

    @if (secao() === 'historico') {
      <section class="card secao">
        <h2 class="secao__titulo">Histórico comercial e financeiro (RF-025)</h2>
        @if (historico(); as resumo) {
          <div class="kpis">
            <div class="kpi">
              <p class="kpi__label">A receber em aberto</p>
              <p class="kpi__value">{{ moeda(resumo.financial.receivable.openBalance) }}</p>
              <p class="kpi__detail">{{ resumo.financial.receivable.count }} título(s)</p>
            </div>
            <div class="kpi">
              <p class="kpi__label">A pagar em aberto</p>
              <p class="kpi__value">{{ moeda(resumo.financial.payable.openBalance) }}</p>
              <p class="kpi__detail">{{ resumo.financial.payable.count }} título(s)</p>
            </div>
            <div class="kpi">
              <p class="kpi__label">Exposição líquida</p>
              <p class="kpi__value">{{ moeda(resumo.financial.netExposure) }}</p>
              <p class="kpi__detail">a receber menos a pagar</p>
            </div>
            <div class="kpi">
              <p class="kpi__label">Pedidos de compra</p>
              <p class="kpi__value">{{ resumo.commercial.purchaseOrders.count }}</p>
              <p class="kpi__detail">
                {{ moeda(resumo.commercial.purchaseOrders.totalAmount) }}
              </p>
            </div>
          </div>

          @if (resumo.recentEntries.length === 0) {
            <p class="nota">Nenhum título movimentado no período.</p>
          } @else {
            <table class="filhos">
              <thead>
                <tr>
                  <th scope="col">Título</th>
                  <th scope="col">Emissão</th>
                  <th scope="col">Descrição</th>
                  <th scope="col" class="coluna--numerica">Valor</th>
                  <th scope="col" class="coluna--numerica">Saldo</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                @for (titulo of resumo.recentEntries; track titulo.id) {
                  <tr>
                    <td>{{ titulo.number }}</td>
                    <td>{{ data(titulo.issueDate) }}</td>
                    <td>{{ titulo.description }}</td>
                    <td class="coluna--numerica">{{ moeda(titulo.netAmount) }}</td>
                    <td class="coluna--numerica">{{ moeda(titulo.balance) }}</td>
                    <td>{{ titulo.status }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        } @else {
          <p class="nota">Carregando o histórico…</p>
        }
      </section>
    }

    <p-dialog
      [visible]="enderecoAberto()"
      (visibleChange)="enderecoAberto.set($event)"
      [modal]="true"
      [style]="{ width: '44rem' }"
      [header]="enderecoEmEdicao() ? 'Editar endereço' : 'Novo endereço'"
    >
      @if (erroFilho(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <form class="grade-campos formulario" (ngSubmit)="salvarEndereco()">
        <sge-select-field
          rotulo="Tipo"
          name="type"
          [opcoes]="OPCOES_ENDERECO"
          [ngModel]="formEndereco().type"
          (ngModelChange)="mudarEndereco('type', $event ?? '')"
        />
        <sge-text-field
          rotulo="Logradouro"
          name="street"
          [obrigatorio]="true"
          [ngModel]="formEndereco().street"
          (ngModelChange)="mudarEndereco('street', $event)"
        />
        <sge-text-field
          rotulo="Número"
          name="number"
          [ngModel]="formEndereco().number"
          (ngModelChange)="mudarEndereco('number', $event)"
        />
        <sge-text-field
          rotulo="Complemento"
          name="complement"
          [ngModel]="formEndereco().complement"
          (ngModelChange)="mudarEndereco('complement', $event)"
        />
        <sge-text-field
          rotulo="Bairro"
          name="district"
          [ngModel]="formEndereco().district"
          (ngModelChange)="mudarEndereco('district', $event)"
        />
        <sge-text-field
          rotulo="Cidade"
          name="city"
          [obrigatorio]="true"
          [ngModel]="formEndereco().city"
          (ngModelChange)="mudarEndereco('city', $event)"
        />
        <sge-text-field
          rotulo="UF"
          name="state"
          dica="Duas letras"
          [obrigatorio]="true"
          [ngModel]="formEndereco().state"
          (ngModelChange)="mudarEndereco('state', $event)"
        />
        <sge-text-field
          rotulo="CEP"
          name="zipCode"
          dica="8 dígitos"
          [ngModel]="formEndereco().zipCode"
          (ngModelChange)="mudarEndereco('zipCode', $event)"
        />
        <label class="marcador">
          <p-checkbox
            name="enderecoPrimary"
            [binary]="true"
            [ngModel]="formEndereco().isPrimary"
            (ngModelChange)="mudarEndereco('isPrimary', $event)"
          />
          <span>Endereço principal</span>
        </label>
      </form>
      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="enderecoAberto.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvandoFilho()"
          [disabled]="salvandoFilho()"
          (onClick)="salvarEndereco()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="contatoAberto()"
      (visibleChange)="contatoAberto.set($event)"
      [modal]="true"
      [style]="{ width: '40rem' }"
      [header]="contatoEmEdicao() ? 'Editar contato' : 'Novo contato'"
    >
      @if (erroFilho(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <form class="grade-campos formulario" (ngSubmit)="salvarContato()">
        <sge-text-field
          rotulo="Nome"
          name="contactName"
          [obrigatorio]="true"
          [ngModel]="formContato().name"
          (ngModelChange)="mudarContato('name', $event)"
        />
        <sge-text-field
          rotulo="Função"
          name="contactRole"
          [ngModel]="formContato().role"
          (ngModelChange)="mudarContato('role', $event)"
        />
        <sge-text-field
          rotulo="E-mail"
          name="contactEmail"
          tipo="email"
          [ngModel]="formContato().email"
          (ngModelChange)="mudarContato('email', $event)"
        />
        <sge-text-field
          rotulo="Telefone"
          name="contactPhone"
          [ngModel]="formContato().phone"
          (ngModelChange)="mudarContato('phone', $event)"
        />
        <sge-text-field
          rotulo="Celular"
          name="contactMobile"
          [ngModel]="formContato().mobile"
          (ngModelChange)="mudarContato('mobile', $event)"
        />
        <label class="marcador">
          <p-checkbox
            name="contactPrimary"
            [binary]="true"
            [ngModel]="formContato().isPrimary"
            (ngModelChange)="mudarContato('isPrimary', $event)"
          />
          <span>Contato principal</span>
        </label>
      </form>
      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="contatoAberto.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvandoFilho()"
          [disabled]="salvandoFilho()"
          (onClick)="salvarContato()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="contaAberta()"
      (visibleChange)="contaAberta.set($event)"
      [modal]="true"
      [style]="{ width: '44rem' }"
      [header]="contaEmEdicao() ? 'Editar conta' : 'Nova conta'"
    >
      @if (erroFilho(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <form class="formulario" (ngSubmit)="salvarConta()">
        <sge-bank-account-fields
          [valor]="formConta()"
          dicaTitular="Preencha quando diferente do parceiro"
          (mudou)="formConta.set($event)"
        />
      </form>
      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="contaAberta.set(false)"
        />
        <p-button
          label="Salvar conta"
          icon="pi pi-check"
          [loading]="salvandoFilho()"
          [disabled]="salvandoFilho()"
          (onClick)="salvarConta()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .secoes {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-bottom: 0.75rem;
    }
    .secoes__item {
      padding: 0.35rem 0.75rem;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--p-text-muted-color);
      background: transparent;
      border: 1px solid var(--p-content-border-color);
      border-radius: var(--p-content-border-radius);
      cursor: pointer;
    }
    .secoes__item--ativa {
      color: var(--p-primary-color);
      border-color: var(--p-primary-color);
    }
    .formulario {
      padding-top: 0.5rem;
    }
    .marcador {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--p-text-color);
    }
    .filhos {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .filhos th,
    .filhos td {
      padding: 0.5rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .filhos th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .filhos .coluna--numerica {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class PartnerFormPage {
  private readonly api = inject(PartnersApiService);
  private readonly condicoes = inject(PaymentConditionsApiService);
  private readonly configuracoes = inject(ConfigurationsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly OPCOES_PESSOA = OPCOES_PESSOA;
  protected readonly OPCOES_ENDERECO = OPCOES_ENDERECO;

  protected readonly banco = descricaoBanco;
  protected readonly agencia = descricaoAgencia;
  protected readonly numeroConta = descricaoConta;

  protected readonly novo = signal(false);
  protected readonly registro = signal<Partner | null>(null);
  protected readonly secao = signal<Secao>('identificacao');
  protected readonly form = signal<Formulario>({ ...VAZIO });
  protected readonly salvando = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly enderecos = signal<PartnerAddress[]>([]);
  protected readonly contatos = signal<PartnerContact[]>([]);
  protected readonly contas = signal<BankAccount[]>([]);
  protected readonly historico = signal<PartnerHistory | null>(null);

  protected readonly salvandoFilho = signal(false);
  protected readonly erroFilho = signal<unknown>(null);

  protected readonly enderecoAberto = signal(false);
  protected readonly enderecoEmEdicao = signal<PartnerAddress | null>(null);
  protected readonly formEndereco = signal<FormularioEndereco>({ ...ENDERECO_VAZIO });

  protected readonly contatoAberto = signal(false);
  protected readonly contatoEmEdicao = signal<PartnerContact | null>(null);
  protected readonly formContato = signal<FormularioContato>({ ...CONTATO_VAZIO });

  protected readonly contaAberta = signal(false);
  protected readonly contaEmEdicao = signal<BankAccount | null>(null);
  protected readonly formConta = signal<FormularioConta>({ ...CONTA_VAZIA });

  protected readonly opcoesCondicao = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesForma = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesCategoria = signal<OpcaoFiltro[]>([]);

  protected readonly titulo = computed(() => this.registro()?.legalName ?? 'Novo parceiro');

  protected readonly subtitulo = computed(() => {
    const parceiro = this.registro();
    if (!parceiro) return 'Cadastro PF/PJ com papéis de cliente e fornecedor (RF-022 a RF-024).';
    const documento = parceiro.cnpj
      ? `CNPJ ${formatCnpj(parceiro.cnpj)}`
      : (parceiro.cpf ?? parceiro.foreignDocument ?? 'sem documento');
    return `${documento} · ${rotuloPapel(parceiro)}.`;
  });

  protected readonly abas = computed(() => {
    const abas: { path: Secao; label: string }[] = [
      { path: 'identificacao', label: 'Identificação' },
    ];
    if (this.permissoes.pode('partner-contacts:READ')) {
      abas.push({ path: 'enderecos', label: 'Endereços' }, { path: 'contatos', label: 'Contatos' });
    }
    if (this.permissoes.pode('partner-bank-accounts:READ')) {
      abas.push({ path: 'bancarios', label: 'Dados bancários' });
    }
    if (this.permissoes.pode('partner-history:READ')) {
      abas.push({ path: 'historico', label: 'Histórico' });
    }
    return abas;
  });

  protected readonly podeSalvar = () =>
    this.novo() ? this.permissoes.pode('partners:CREATE') : this.permissoes.pode('partners:UPDATE');
  protected readonly podeCriarFilho = () => this.permissoes.pode('partner-contacts:CREATE');
  protected readonly podeEditarFilho = () => this.permissoes.pode('partner-contacts:UPDATE');
  protected readonly podeRemoverFilho = () => this.permissoes.pode('partner-contacts:DELETE');
  protected readonly podeCriarConta = () => this.permissoes.pode('partner-bank-accounts:CREATE');
  protected readonly podeEditarConta = () => this.permissoes.pode('partner-bank-accounts:UPDATE');
  protected readonly podeRemoverConta = () => this.permissoes.pode('partner-bank-accounts:DELETE');

  constructor() {
    const id = this.rota.snapshot.paramMap.get('id');
    if (id === 'novo' || id === null) {
      this.novo.set(true);
    } else {
      this.carregar(id);
    }
    this.carregarReferencias();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected tipoEndereco(endereco: PartnerAddress): string {
    return ROTULO_ENDERECO[endereco.type] ?? endereco.type;
  }

  protected logradouro(endereco: PartnerAddress): string {
    return [endereco.street, endereco.number, endereco.district].filter(Boolean).join(', ');
  }

  protected mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarEndereco<K extends keyof FormularioEndereco>(
    campo: K,
    valor: FormularioEndereco[K],
  ): void {
    this.formEndereco.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarContato<K extends keyof FormularioContato>(
    campo: K,
    valor: FormularioContato[K],
  ): void {
    this.formContato.update((atual) => ({ ...atual, [campo]: valor }));
  }

  /** Cada aba consulta seu recurso na primeira abertura. */
  protected trocar(secao: Secao): void {
    if (this.secao() === secao) return;
    this.secao.set(secao);
    this.aviso.set(null);
    const parceiro = this.registro();
    if (!parceiro) return;
    if (secao === 'enderecos' && this.enderecos().length === 0) this.carregarEnderecos(parceiro.id);
    if (secao === 'contatos' && this.contatos().length === 0) this.carregarContatos(parceiro.id);
    if (secao === 'bancarios' && this.contas().length === 0) this.carregarContas(parceiro.id);
    if (secao === 'historico' && this.historico() === null) this.carregarHistorico(parceiro.id);
  }

  protected salvar(): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erro.set(null);
    this.aviso.set(null);

    const alvo = this.registro();
    const corpo = this.paraDto();
    const requisicao = alvo
      ? this.api.update(alvo.id, corpo)
      : this.api.create(corpo as PartnerInput);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (parceiro) => {
        this.salvando.set(false);
        if (alvo) {
          this.aplicar(parceiro);
          this.aviso.set('Cadastro atualizado.');
        } else {
          // Passa a ser edição: endereços, contatos e contas só existem com o
          // parceiro já criado, e a rota precisa refletir o registro.
          void this.router.navigate(['/cadastros/parceiros', parceiro.id]);
        }
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erro.set(falha);
      },
    });
  }

  protected abrirNovoEndereco(): void {
    this.enderecoEmEdicao.set(null);
    this.formEndereco.set({ ...ENDERECO_VAZIO });
    this.erroFilho.set(null);
    this.enderecoAberto.set(true);
  }

  protected abrirEdicaoEndereco(endereco: PartnerAddress): void {
    this.enderecoEmEdicao.set(endereco);
    this.erroFilho.set(null);
    this.formEndereco.set({
      type: endereco.type,
      street: endereco.street,
      number: endereco.number ?? '',
      complement: endereco.complement ?? '',
      district: endereco.district ?? '',
      city: endereco.city,
      state: endereco.state,
      zipCode: endereco.zipCode ?? '',
      isPrimary: endereco.isPrimary,
    });
    this.enderecoAberto.set(true);
  }

  protected salvarEndereco(): void {
    const parceiro = this.registro();
    if (!parceiro || this.salvandoFilho()) return;
    this.salvandoFilho.set(true);
    this.erroFilho.set(null);

    const form = this.formEndereco();
    const corpo: PartnerAddressInput = {
      street: form.street.trim(),
      city: form.city.trim(),
      state: form.state.trim().toUpperCase(),
      isPrimary: form.isPrimary,
      ...(form.type !== '' ? { type: form.type as PartnerAddressInput['type'] } : {}),
    };
    const opcionais: [keyof PartnerAddressInput, string][] = [
      ['number', form.number],
      ['complement', form.complement],
      ['district', form.district],
      ['zipCode', form.zipCode.replace(/\D/g, '')],
    ];
    for (const [chave, valor] of opcionais) {
      const limpo = valor.trim();
      if (limpo !== '') Object.assign(corpo, { [chave]: limpo });
    }

    const alvo = this.enderecoEmEdicao();
    const requisicao = alvo
      ? this.api.updateAddress(parceiro.id, alvo.id, corpo)
      : this.api.createAddress(parceiro.id, corpo);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvandoFilho.set(false);
        this.enderecoAberto.set(false);
        this.aviso.set(alvo ? 'Endereço atualizado.' : 'Endereço cadastrado.');
        this.carregarEnderecos(parceiro.id);
      },
      error: (falha: unknown) => {
        this.salvandoFilho.set(false);
        this.erroFilho.set(falha);
      },
    });
  }

  protected removerEndereco(endereco: PartnerAddress): void {
    const parceiro = this.registro();
    if (!parceiro) return;
    this.api
      .removeAddress(parceiro.id, endereco.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set('Endereço removido.');
          this.carregarEnderecos(parceiro.id);
        },
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  protected abrirNovoContato(): void {
    this.contatoEmEdicao.set(null);
    this.formContato.set({ ...CONTATO_VAZIO });
    this.erroFilho.set(null);
    this.contatoAberto.set(true);
  }

  protected abrirEdicaoContato(contato: PartnerContact): void {
    this.contatoEmEdicao.set(contato);
    this.erroFilho.set(null);
    this.formContato.set({
      name: contato.name,
      role: contato.role ?? '',
      email: contato.email ?? '',
      phone: contato.phone ?? '',
      mobile: contato.mobile ?? '',
      isPrimary: contato.isPrimary,
    });
    this.contatoAberto.set(true);
  }

  protected salvarContato(): void {
    const parceiro = this.registro();
    if (!parceiro || this.salvandoFilho()) return;
    this.salvandoFilho.set(true);
    this.erroFilho.set(null);

    const form = this.formContato();
    const corpo: PartnerContactInput = { name: form.name.trim(), isPrimary: form.isPrimary };
    const opcionais: [keyof PartnerContactInput, string][] = [
      ['role', form.role],
      ['email', form.email],
      ['phone', form.phone],
      ['mobile', form.mobile],
    ];
    for (const [chave, valor] of opcionais) {
      const limpo = valor.trim();
      if (limpo !== '') Object.assign(corpo, { [chave]: limpo });
    }

    const alvo = this.contatoEmEdicao();
    const requisicao = alvo
      ? this.api.updateContact(parceiro.id, alvo.id, corpo)
      : this.api.createContact(parceiro.id, corpo);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvandoFilho.set(false);
        this.contatoAberto.set(false);
        this.aviso.set(alvo ? 'Contato atualizado.' : 'Contato cadastrado.');
        this.carregarContatos(parceiro.id);
      },
      error: (falha: unknown) => {
        this.salvandoFilho.set(false);
        this.erroFilho.set(falha);
      },
    });
  }

  protected removerContato(contato: PartnerContact): void {
    const parceiro = this.registro();
    if (!parceiro) return;
    this.api
      .removeContact(parceiro.id, contato.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set('Contato removido.');
          this.carregarContatos(parceiro.id);
        },
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  protected abrirNovaConta(): void {
    this.contaEmEdicao.set(null);
    this.formConta.set({ ...CONTA_VAZIA });
    this.erroFilho.set(null);
    this.contaAberta.set(true);
  }

  protected abrirEdicaoConta(conta: BankAccount): void {
    this.contaEmEdicao.set(conta);
    this.erroFilho.set(null);
    this.formConta.set(contaParaFormulario(conta));
    this.contaAberta.set(true);
  }

  protected salvarConta(): void {
    const parceiro = this.registro();
    if (!parceiro || this.salvandoFilho()) return;
    this.salvandoFilho.set(true);
    this.erroFilho.set(null);

    const alvo = this.contaEmEdicao();
    const corpo = contaParaDto(this.formConta());
    const requisicao = alvo
      ? this.api.updateBankAccount(parceiro.id, alvo.id, corpo)
      : this.api.createBankAccount(parceiro.id, corpo);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvandoFilho.set(false);
        this.contaAberta.set(false);
        this.aviso.set(alvo ? 'Conta atualizada.' : 'Conta cadastrada.');
        this.carregarContas(parceiro.id);
      },
      error: (falha: unknown) => {
        this.salvandoFilho.set(false);
        this.erroFilho.set(falha);
      },
    });
  }

  protected removerConta(conta: BankAccount): void {
    const parceiro = this.registro();
    if (!parceiro) return;
    this.api
      .removeBankAccount(parceiro.id, conta.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set('Conta removida.');
          this.carregarContas(parceiro.id);
        },
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private carregar(id: string): void {
    this.api
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (parceiro) => this.aplicar(parceiro),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private carregarEnderecos(id: string): void {
    this.api
      .listAddresses(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (linhas) => this.enderecos.set(linhas),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private carregarContatos(id: string): void {
    this.api
      .listContacts(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (linhas) => this.contatos.set(linhas),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private carregarContas(id: string): void {
    this.api
      .listBankAccounts(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (linhas) => this.contas.set(linhas),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private carregarHistorico(id: string): void {
    this.api
      .history(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resumo) => this.historico.set(resumo),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private aplicar(parceiro: Partner): void {
    this.registro.set(parceiro);
    this.novo.set(false);
    this.form.set({
      personType: parceiro.personType,
      code: parceiro.code ?? '',
      legalName: parceiro.legalName,
      tradeName: parceiro.tradeName ?? '',
      cnpj: parceiro.cnpj ?? '',
      cpf: parceiro.cpf ?? '',
      foreignDocument: parceiro.foreignDocument ?? '',
      stateRegistration: parceiro.stateRegistration ?? '',
      municipalRegistration: parceiro.municipalRegistration ?? '',
      icmsTaxpayer: parceiro.icmsTaxpayer,
      email: parceiro.email ?? '',
      phone: parceiro.phone ?? '',
      website: parceiro.website ?? '',
      isCustomer: parceiro.isCustomer,
      isSupplier: parceiro.isSupplier,
      note: parceiro.note ?? '',
      creditLimit: parceiro.customer?.creditLimit ?? '',
      customerPaymentTermId: parceiro.customer?.paymentTermId ?? '',
      customerPaymentMethodId: parceiro.customer?.paymentMethodId ?? '',
      supplierPaymentTermId: parceiro.supplier?.paymentTermId ?? '',
      supplierPaymentMethodId: parceiro.supplier?.paymentMethodId ?? '',
      supplierDefaultCategoryId: parceiro.supplier?.defaultCategoryId ?? '',
      supplierDeliveryDays:
        parceiro.supplier?.deliveryDays != null ? String(parceiro.supplier.deliveryDays) : '',
    });
  }

  /**
   * Campo em branco não vai no corpo: o backend valida cada opcional, e mandar
   * `""` num UUID ou num CNPJ vira 400 em vez de "não informado".
   *
   * O perfil só é enviado quando o papel está marcado — mandar `customer` com o
   * papel desligado criaria o perfil sem o papel correspondente.
   */
  private paraDto(): Partial<PartnerInput> {
    const form = this.form();
    const dto: Partial<PartnerInput> = {
      personType: form.personType as PersonType,
      legalName: form.legalName.trim(),
      icmsTaxpayer: form.icmsTaxpayer,
      isCustomer: form.isCustomer,
      isSupplier: form.isSupplier,
    };

    const opcionais: [keyof PartnerInput, string][] = [
      ['code', form.code],
      ['tradeName', form.tradeName],
      ['cnpj', form.cnpj.replace(/\D/g, '')],
      ['cpf', form.cpf.replace(/\D/g, '')],
      ['foreignDocument', form.foreignDocument],
      ['stateRegistration', form.stateRegistration],
      ['municipalRegistration', form.municipalRegistration],
      ['email', form.email],
      ['phone', form.phone],
      ['website', form.website],
      ['note', form.note],
    ];
    for (const [chave, valor] of opcionais) {
      const limpo = valor.trim();
      if (limpo !== '') Object.assign(dto, { [chave]: limpo });
    }

    if (form.isCustomer) {
      const cliente: CustomerProfileInput = {};
      if (form.creditLimit.trim() !== '') cliente.creditLimit = form.creditLimit;
      if (form.customerPaymentTermId !== '') cliente.paymentTermId = form.customerPaymentTermId;
      if (form.customerPaymentMethodId !== '') {
        cliente.paymentMethodId = form.customerPaymentMethodId;
      }
      if (Object.keys(cliente).length > 0) dto.customer = cliente;
    }

    if (form.isSupplier) {
      const fornecedor: SupplierProfileInput = {};
      if (form.supplierPaymentTermId !== '') fornecedor.paymentTermId = form.supplierPaymentTermId;
      if (form.supplierPaymentMethodId !== '') {
        fornecedor.paymentMethodId = form.supplierPaymentMethodId;
      }
      if (form.supplierDefaultCategoryId !== '') {
        fornecedor.defaultCategoryId = form.supplierDefaultCategoryId;
      }
      const prazo = form.supplierDeliveryDays.trim();
      if (prazo !== '' && /^\d+$/.test(prazo)) fornecedor.deliveryDays = Number(prazo);
      if (Object.keys(fornecedor).length > 0) dto.supplier = fornecedor;
    }

    return dto;
  }

  /** Listas de apoio dos selects, cada uma sob a permissão do próprio recurso. */
  private carregarReferencias(): void {
    if (this.permissoes.pode('payment-terms:READ')) {
      this.condicoes
        .listTerms({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesCondicao.set(
              r.data.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
            ),
          error: () => this.opcoesCondicao.set([]),
        });
    }

    if (this.permissoes.pode('payment-methods:READ')) {
      this.condicoes
        .listMethods({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesForma.set(
              r.data.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` })),
            ),
          error: () => this.opcoesForma.set([]),
        });
    }

    if (this.permissoes.pode('categories:READ')) {
      this.configuracoes
        .listCategories({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesCategoria.set(
              r.data.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
            ),
          error: () => this.opcoesCategoria.set([]),
        });
    }
  }
}
