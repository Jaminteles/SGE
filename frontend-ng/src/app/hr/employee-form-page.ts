import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { map } from 'rxjs/operators';

import { BranchesApiService } from '../core/api/branches-api.service';
import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import { EmployeesApiService } from '../core/api/employees-api.service';
import { HrStructureApiService } from '../core/api/hr-structure-api.service';
import type { BankAccount, Employee, EmployeeInput } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatDate } from '../core/lib/format';
import { Alert } from '../ui/alert';
import { ConfirmService } from '../ui/confirm.service';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { LIMITE_BUSCA, SearchSelect } from '../ui/search-select';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
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
import { OPCOES_CONTRATO, ROTULO_STATUS } from './rotulos';

interface Formulario {
  registration: string;
  name: string;
  taxId: string;
  rg: string;
  pis: string;
  birthDate: string;
  corporateEmail: string;
  phone: string;
  positionId: string;
  departmentId: string;
  costCenterId: string;
  managerId: string;
  branchId: string;
  hireDate: string;
  contractType: string;
  baseSalary: string;
}

const VAZIO: Formulario = {
  registration: '',
  name: '',
  taxId: '',
  rg: '',
  pis: '',
  birthDate: '',
  corporateEmail: '',
  phone: '',
  positionId: '',
  departmentId: '',
  costCenterId: '',
  managerId: '',
  branchId: '',
  hireDate: '',
  contractType: '',
  baseSalary: '',
};

/**
 * Cadastro do funcionário com dados profissionais e bancários (RF-013 —
 * UI-013).
 *
 * Admissão e salário base só existem na criação: depois viram evento do
 * histórico (RF-015/RF-017) e o backend os recusa no PATCH. Os campos ficam
 * desabilitados em edição em vez de sumirem, com a dica apontando para o
 * histórico — assim o usuário entende por onde alterar.
 *
 * Os dados bancários são um recurso à parte (`employees/:id/bank-accounts`),
 * com permissão própria: só aparecem depois que o funcionário existe.
 */
@Component({
  selector: 'sge-employee-form-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    TagModule,
    Alert,
    BankAccountFields,
    DecimalField,
    ErrorAlert,
    SearchSelect,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">RH / Funcionários / {{ titulo() }}</p>

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
          routerLink="/rh/funcionarios"
        />
        @if (registro(); as funcionario) {
          <p-button
            label="Histórico"
            severity="secondary"
            [outlined]="true"
            [routerLink]="['/rh/funcionarios', funcionario.id, 'historico']"
          />
        }
        @if (podeSalvar()) {
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

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    <section class="card secao">
      <h2 class="secao__titulo">Dados pessoais</h2>
      <div class="grade-campos">
        <sge-text-field
          rotulo="Matrícula"
          name="registration"
          [obrigatorio]="true"
          [ngModel]="form().registration"
          (ngModelChange)="mudar('registration', $event)"
        />
        <sge-text-field
          rotulo="Nome"
          name="name"
          [obrigatorio]="true"
          [ngModel]="form().name"
          (ngModelChange)="mudar('name', $event)"
        />
        <sge-text-field
          rotulo="CPF"
          name="taxId"
          dica="Com ou sem máscara"
          [obrigatorio]="true"
          [ngModel]="form().taxId"
          (ngModelChange)="mudar('taxId', $event)"
        />
        <sge-text-field
          rotulo="RG"
          name="rg"
          [ngModel]="form().rg"
          (ngModelChange)="mudar('rg', $event)"
        />
        <sge-text-field
          rotulo="PIS/PASEP"
          name="pis"
          dica="11 a 15 dígitos"
          [ngModel]="form().pis"
          (ngModelChange)="mudar('pis', $event)"
        />
        <sge-text-field
          rotulo="Nascimento"
          name="birthDate"
          tipo="date"
          [ngModel]="form().birthDate"
          (ngModelChange)="mudar('birthDate', $event)"
        />
        <sge-text-field
          rotulo="E-mail corporativo"
          name="corporateEmail"
          tipo="email"
          [ngModel]="form().corporateEmail"
          (ngModelChange)="mudar('corporateEmail', $event)"
        />
        <sge-text-field
          rotulo="Telefone"
          name="phone"
          [ngModel]="form().phone"
          (ngModelChange)="mudar('phone', $event)"
        />
      </div>
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Vínculo</h2>
      <div class="grade-campos">
        <sge-select-field
          rotulo="Cargo"
          name="positionId"
          [opcoes]="opcoesCargo()"
          [ngModel]="form().positionId"
          (ngModelChange)="mudar('positionId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Departamento"
          name="departmentId"
          [opcoes]="opcoesDepartamento()"
          [ngModel]="form().departmentId"
          (ngModelChange)="mudar('departmentId', $event ?? '')"
        />
        <sge-search-select
          rotulo="Gestor imediato"
          name="managerId"
          [buscar]="buscarGestor"
          [resolver]="resolverGestor"
          [ngModel]="form().managerId"
          (ngModelChange)="mudar('managerId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Regime"
          name="contractType"
          [opcoes]="OPCOES_CONTRATO"
          [ngModel]="form().contractType"
          (ngModelChange)="mudar('contractType', $event ?? '')"
        />
        <sge-text-field
          rotulo="Admissão"
          name="hireDate"
          tipo="date"
          [obrigatorio]="novo()"
          [dica]="novo() ? 'Gera o evento de admissão' : 'Alterada apenas pelo histórico funcional'"
          [ngModel]="form().hireDate"
          (ngModelChange)="mudar('hireDate', $event)"
          [disabled]="!novo()"
        />
        <sge-decimal-field
          rotulo="Salário base"
          name="baseSalary"
          [dica]="
            novo() ? 'Salário na admissão' : 'Alterado por evento de alteração salarial (RF-017)'
          "
          [ngModel]="form().baseSalary"
          (ngModelChange)="mudar('baseSalary', $event ?? '')"
          [disabled]="!novo()"
        />
      </div>
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Apropriação de custo</h2>
      <div class="grade-campos">
        <sge-select-field
          rotulo="Centro de custo"
          name="costCenterId"
          [opcoes]="opcoesCentroCusto()"
          [ngModel]="form().costCenterId"
          (ngModelChange)="mudar('costCenterId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Filial de lotação"
          name="branchId"
          [opcoes]="opcoesFilial()"
          [ngModel]="form().branchId"
          (ngModelChange)="mudar('branchId', $event ?? '')"
        />
      </div>
    </section>

    @if (registro(); as funcionario) {
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

        @if (!podeVerContas()) {
          <p class="nota">Sem permissão para ver os dados bancários deste funcionário.</p>
        } @else if (contas().length === 0) {
          <p class="nota">Nenhuma conta cadastrada.</p>
        } @else {
          <table class="contas">
            <thead>
              <tr>
                <th scope="col">Banco</th>
                <th scope="col">Agência</th>
                <th scope="col">Conta</th>
                <th scope="col">Tipo</th>
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
                  <td>{{ conta.accountType ?? '—' }}</td>
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

        <p class="nota">Alteração de dado bancário fica na trilha de auditoria (RF-013/RF-117).</p>
      </section>
    }

    <p-dialog
      [visible]="contaAberta()"
      (visibleChange)="contaAberta.set($event)"
      [modal]="true"
      [style]="{ width: '44rem' }"
      [header]="contaEmEdicao() ? 'Editar conta' : 'Nova conta'"
    >
      @if (erroConta(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="formulario" (ngSubmit)="salvarConta()">
        <sge-bank-account-fields [valor]="formConta()" (mudou)="formConta.set($event)" />
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
          [loading]="salvandoConta()"
          [disabled]="salvandoConta()"
          (onClick)="salvarConta()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.5rem;
    }
    .principal {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--p-text-color);
    }
    .contas {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .contas th,
    .contas td {
      padding: 0.5rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .contas th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
  `,
})
export class EmployeeFormPage {
  private readonly api = inject(EmployeesApiService);
  private readonly confirmacao = inject(ConfirmService);
  private readonly estrutura = inject(HrStructureApiService);
  private readonly configuracoes = inject(ConfigurationsApiService);
  private readonly filiais = inject(BranchesApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly OPCOES_CONTRATO = OPCOES_CONTRATO;

  protected readonly novo = signal(false);
  protected readonly registro = signal<Employee | null>(null);
  protected readonly form = signal<Formulario>({ ...VAZIO });
  protected readonly salvando = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly contas = signal<BankAccount[]>([]);
  protected readonly contaAberta = signal(false);
  protected readonly contaEmEdicao = signal<BankAccount | null>(null);
  protected readonly formConta = signal<FormularioConta>({ ...CONTA_VAZIA });
  protected readonly salvandoConta = signal(false);
  protected readonly erroConta = signal<unknown>(null);

  protected readonly opcoesCargo = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesDepartamento = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesCentroCusto = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesFilial = signal<OpcaoFiltro[]>([]);
  /** Gestor: busca no quadro ativo inteiro, nunca "os primeiros 100". */
  protected readonly buscarGestor = (termo: string) =>
    this.api
      .list({ q: termo, status: 'ATIVO', pageSize: LIMITE_BUSCA })
      .pipe(
        map((r) => r.data.map((e) => ({ value: e.id, label: `${e.registration} — ${e.name}` }))),
      );

  protected readonly resolverGestor = (id: string) =>
    this.api.get(id).pipe(map((e) => ({ value: e.id, label: `${e.registration} — ${e.name}` })));

  protected readonly titulo = computed(() => this.registro()?.name ?? 'Novo funcionário');

  protected readonly subtitulo = computed(() => {
    const funcionario = this.registro();
    if (!funcionario) return 'Cadastro funcional com dados profissionais e bancários (RF-013).';
    const partes = [
      `Matrícula ${funcionario.registration}`,
      funcionario.position?.name,
      `admitido em ${formatDate(funcionario.hireDate)}`,
      ROTULO_STATUS[funcionario.status],
    ].filter(Boolean);
    return `${partes.join(' · ')}.`;
  });

  protected readonly podeSalvar = () =>
    this.novo()
      ? this.permissoes.pode('employees:CREATE')
      : this.permissoes.pode('employees:UPDATE');
  protected readonly podeVerContas = () => this.permissoes.pode('employee-bank-accounts:READ');
  protected readonly podeCriarConta = () => this.permissoes.pode('employee-bank-accounts:CREATE');
  protected readonly podeEditarConta = () => this.permissoes.pode('employee-bank-accounts:UPDATE');
  protected readonly podeRemoverConta = () => this.permissoes.pode('employee-bank-accounts:DELETE');

  constructor() {
    const id = this.rota.snapshot.paramMap.get('id');
    if (id === 'novo' || id === null) {
      this.novo.set(true);
    } else {
      this.carregar(id);
    }
    this.carregarReferencias();
  }

  protected mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected banco = descricaoBanco;
  protected agencia = descricaoAgencia;
  protected numeroConta = descricaoConta;

  protected salvar(): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erro.set(null);
    this.aviso.set(null);

    const alvo = this.registro();
    const corpo = this.paraDto();
    const requisicao = alvo
      ? this.api.update(alvo.id, corpo)
      : this.api.create(corpo as EmployeeInput);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (funcionario) => {
        this.salvando.set(false);
        if (alvo) {
          this.aplicar(funcionario);
          this.aviso.set('Cadastro atualizado.');
        } else {
          // Passa a ser edição: os dados bancários só existem com o funcionário
          // já criado, e a rota precisa refletir o registro.
          void this.router.navigate(['/rh/funcionarios', funcionario.id]);
        }
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erro.set(falha);
      },
    });
  }

  protected abrirNovaConta(): void {
    this.contaEmEdicao.set(null);
    this.formConta.set({ ...CONTA_VAZIA });
    this.erroConta.set(null);
    this.contaAberta.set(true);
  }

  protected abrirEdicaoConta(conta: BankAccount): void {
    this.contaEmEdicao.set(conta);
    this.erroConta.set(null);
    this.formConta.set(contaParaFormulario(conta));
    this.contaAberta.set(true);
  }

  protected salvarConta(): void {
    const funcionario = this.registro();
    if (!funcionario || this.salvandoConta()) return;
    this.salvandoConta.set(true);
    this.erroConta.set(null);

    const alvo = this.contaEmEdicao();
    const corpo = contaParaDto(this.formConta());
    const requisicao = alvo
      ? this.api.updateBankAccount(funcionario.id, alvo.id, corpo)
      : this.api.createBankAccount(funcionario.id, corpo);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvandoConta.set(false);
        this.contaAberta.set(false);
        this.aviso.set(alvo ? 'Conta atualizada.' : 'Conta cadastrada.');
        this.carregarContas(funcionario.id);
      },
      error: (falha: unknown) => {
        this.salvandoConta.set(false);
        this.erroConta.set(falha);
      },
    });
  }

  protected async removerConta(conta: BankAccount): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Remover conta bancária do funcionário?',
      mensagem: 'A conta sai do cadastro e deixa de ser oferecida no pagamento da folha.',
      rotuloConfirmar: 'Remover',
      destrutivo: true,
    });
    if (!confirmado) return;

    const funcionario = this.registro();
    if (!funcionario) return;
    this.api
      .removeBankAccount(funcionario.id, conta.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set('Conta removida.');
          this.carregarContas(funcionario.id);
        },
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private carregar(id: string): void {
    this.api
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (funcionario) => {
          this.aplicar(funcionario);
          this.carregarContas(funcionario.id);
        },
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private carregarContas(id: string): void {
    if (!this.podeVerContas()) return;
    this.api
      .listBankAccounts(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (contas) => this.contas.set(contas),
        error: () => this.contas.set([]),
      });
  }

  private aplicar(funcionario: Employee): void {
    this.registro.set(funcionario);
    this.novo.set(false);
    this.form.set({
      registration: funcionario.registration,
      name: funcionario.name,
      taxId: funcionario.taxId,
      rg: funcionario.rg ?? '',
      pis: funcionario.pis ?? '',
      birthDate: (funcionario.birthDate ?? '').slice(0, 10),
      corporateEmail: funcionario.corporateEmail ?? '',
      phone: funcionario.phone ?? '',
      positionId: funcionario.positionId ?? '',
      departmentId: funcionario.departmentId ?? '',
      costCenterId: funcionario.costCenterId ?? '',
      managerId: funcionario.managerId ?? '',
      branchId: funcionario.branchId ?? '',
      hireDate: funcionario.hireDate.slice(0, 10),
      contractType: funcionario.contractType ?? '',
      baseSalary: funcionario.baseSalary ?? '',
    });
  }

  /**
   * Campo em branco não vai no corpo: o backend valida cada opcional, e mandar
   * `""` num UUID vira 400 em vez de "não informado".
   */
  private paraDto(): Partial<EmployeeInput> {
    const form = this.form();
    const dto: Partial<EmployeeInput> = {
      registration: form.registration.trim(),
      name: form.name.trim(),
      taxId: form.taxId.replace(/\D/g, ''),
    };

    const opcionais: [keyof EmployeeInput, string][] = [
      ['rg', form.rg],
      ['pis', form.pis.replace(/\D/g, '')],
      ['birthDate', form.birthDate],
      ['corporateEmail', form.corporateEmail],
      ['phone', form.phone],
      ['positionId', form.positionId],
      ['departmentId', form.departmentId],
      ['costCenterId', form.costCenterId],
      ['managerId', form.managerId],
      ['branchId', form.branchId],
      ['contractType', form.contractType],
    ];
    for (const [chave, valor] of opcionais) {
      const limpo = valor.trim();
      if (limpo !== '') Object.assign(dto, { [chave]: limpo });
    }

    // Admissão e salário base só na criação — no PATCH o backend recusa.
    if (this.novo()) {
      dto.hireDate = form.hireDate;
      if (form.baseSalary.trim() !== '') dto.baseSalary = form.baseSalary;
    }
    return dto;
  }

  /**
   * Listas de apoio dos selects. Cada uma depende da permissão do próprio
   * recurso: sem ela a requisição só voltaria 403 e sujaria a tela de erro.
   */
  private carregarReferencias(): void {
    if (this.permissoes.pode('positions:READ')) {
      this.estrutura
        .listPositions({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesCargo.set(
              r.data.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })),
            ),
          error: () => this.opcoesCargo.set([]),
        });
    }

    if (this.permissoes.pode('departments:READ')) {
      this.estrutura
        .listDepartments({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesDepartamento.set(
              r.data.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })),
            ),
          error: () => this.opcoesDepartamento.set([]),
        });
    }

    if (this.permissoes.pode('cost-centers:READ')) {
      this.configuracoes
        .listCostCenters({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesCentroCusto.set(
              r.data.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
            ),
          error: () => this.opcoesCentroCusto.set([]),
        });
    }

    if (this.permissoes.pode('branches:READ')) {
      this.filiais
        .list({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesFilial.set(
              r.data.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` })),
            ),
          error: () => this.opcoesFilial.set([]),
        });
    }
  }
}
