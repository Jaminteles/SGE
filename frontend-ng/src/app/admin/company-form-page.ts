import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { CompaniesApiService } from '../core/api/companies-api.service';
import type { Company, CompanyInput, TaxRegime } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { CompanyService } from '../core/company/company.service';
import { formatCnpj } from '../core/lib/format';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import type { OpcaoFiltro } from '../ui/filter-bar';

const REGIMES: OpcaoFiltro[] = [
  { value: 'SIMPLES_NACIONAL', label: 'Simples Nacional' },
  { value: 'LUCRO_PRESUMIDO', label: 'Lucro Presumido' },
  { value: 'LUCRO_REAL', label: 'Lucro Real' },
  { value: 'MEI', label: 'MEI' },
  { value: 'IMUNE_ISENTO', label: 'Imune / Isento' },
];

/** Estado editável da tela: tudo string, como os DTOs do backend esperam. */
interface Formulario {
  legalName: string;
  tradeName: string;
  taxId: string;
  stateRegistration: string;
  municipalRegistration: string;
  taxRegime: string;
  mainCnae: string;
  email: string;
  phone: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  addressDistrict: string;
  addressCity: string;
  addressState: string;
  addressZipCode: string;
}

const VAZIO: Formulario = {
  legalName: '',
  tradeName: '',
  taxId: '',
  stateRegistration: '',
  municipalRegistration: '',
  taxRegime: '',
  mainCnae: '',
  email: '',
  phone: '',
  addressStreet: '',
  addressNumber: '',
  addressComplement: '',
  addressDistrict: '',
  addressCity: '',
  addressState: '',
  addressZipCode: '',
};

/**
 * Cadastro da empresa (RF-001 / RF-003 — UI-007).
 *
 * Serve três destinos com o mesmo formulário: a empresa ativa
 * (`companies/current`, para o administrador da empresa), uma empresa
 * específica e a criação — estes dois últimos são de super admin. Quem decide
 * é a rota, via `data.modo`.
 */
@Component({
  selector: 'sge-company-form-page',
  imports: [FormsModule, ButtonModule, TagModule, Alert, ErrorAlert, SelectField, TextField],
  template: `
    <p class="crumb">Administração / {{ modo() === 'atual' ? 'Empresa' : 'Empresas' }}</p>

    <div class="pagehead">
      <div>
        <h1>{{ titulo() }}</h1>
        <p>Dados cadastrais, fiscais e de endereço (RF-001/RF-003).</p>
      </div>
      <div class="pagehead__actions">
        @if (empresa(); as atual) {
          <p-tag
            [value]="atual.isActive ? 'Ativa' : 'Inativa'"
            [severity]="atual.isActive ? 'success' : 'secondary'"
            [rounded]="true"
          />
        }
        @if (modo() !== 'atual') {
          <p-button label="Voltar" severity="secondary" [outlined]="true" (onClick)="voltar()" />
        }
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [disabled]="!podeEditar() || salvando()"
          [loading]="salvando()"
          (onClick)="salvar()"
        />
      </div>
    </div>

    @if (erro(); as falha) {
      <sge-error-alert [erro]="falha" />
    }

    @if (salvo()) {
      <sge-alert tom="sucesso" titulo="Cadastro salvo." class="bloco" />
    }

    @if (!podeEditar()) {
      <sge-alert
        tom="info"
        titulo="Somente leitura"
        mensagem="Seu perfil pode consultar o cadastro, mas não alterá-lo."
        class="bloco"
      />
    }

    <form (ngSubmit)="salvar()">
      <section class="card secao">
        <h2 class="secao__titulo">Identificação</h2>
        <div class="grade-campos">
          <sge-text-field
            rotulo="Razão social"
            name="legalName"
            [obrigatorio]="true"
            [erro]="erroCampo('legalName')"
            [ngModel]="form().legalName"
            (ngModelChange)="mudar('legalName', $event)"
          />
          <sge-text-field
            rotulo="Nome fantasia"
            name="tradeName"
            [ngModel]="form().tradeName"
            (ngModelChange)="mudar('tradeName', $event)"
          />
          <sge-text-field
            rotulo="CNPJ"
            name="taxId"
            [dica]="modo() === 'novo' ? 'Com ou sem máscara' : 'Imutável após o cadastro'"
            [obrigatorio]="modo() === 'novo'"
            [erro]="erroCampo('taxId')"
            [ngModel]="form().taxId"
            (ngModelChange)="mudar('taxId', $event)"
          />
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
        </div>
      </section>

      <section class="card secao">
        <h2 class="secao__titulo">Regime e contabilidade</h2>
        <div class="grade-campos">
          <sge-select-field
            rotulo="Regime tributário"
            name="taxRegime"
            placeholder="Não informado"
            [opcoes]="regimes"
            [ngModel]="form().taxRegime"
            (ngModelChange)="mudar('taxRegime', $event ?? '')"
          />
          <sge-text-field
            rotulo="CNAE principal"
            name="mainCnae"
            [ngModel]="form().mainCnae"
            (ngModelChange)="mudar('mainCnae', $event)"
          />
          <!-- Moeda e fuso são definidos no provisionamento e não têm campo no
               DTO de atualização: exibir como leitura evita prometer edição. -->
          <div class="campo">
            <span class="campo__rotulo">Moeda</span>
            <strong class="leitura">{{ empresa()?.currency ?? 'BRL' }}</strong>
            <span class="campo__dica">Definida no provisionamento da empresa</span>
          </div>
        </div>
      </section>

      <section class="card secao">
        <h2 class="secao__titulo">Contato</h2>
        <div class="grade-campos">
          <sge-text-field
            rotulo="E-mail"
            tipo="email"
            name="email"
            [erro]="erroCampo('email')"
            [ngModel]="form().email"
            (ngModelChange)="mudar('email', $event)"
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
        <h2 class="secao__titulo">Endereço</h2>
        <div class="grade-campos">
          <sge-text-field
            rotulo="Logradouro"
            name="addressStreet"
            dica="Logradouro, cidade e UF vão juntos"
            [ngModel]="form().addressStreet"
            (ngModelChange)="mudar('addressStreet', $event)"
          />
          <sge-text-field
            rotulo="Número"
            name="addressNumber"
            [ngModel]="form().addressNumber"
            (ngModelChange)="mudar('addressNumber', $event)"
          />
          <sge-text-field
            rotulo="Complemento"
            name="addressComplement"
            [ngModel]="form().addressComplement"
            (ngModelChange)="mudar('addressComplement', $event)"
          />
          <sge-text-field
            rotulo="Bairro"
            name="addressDistrict"
            [ngModel]="form().addressDistrict"
            (ngModelChange)="mudar('addressDistrict', $event)"
          />
          <sge-text-field
            rotulo="Cidade"
            name="addressCity"
            [ngModel]="form().addressCity"
            (ngModelChange)="mudar('addressCity', $event)"
          />
          <sge-text-field
            rotulo="UF"
            name="addressState"
            dica="Duas letras"
            [erro]="erroCampo('addressState')"
            [ngModel]="form().addressState"
            (ngModelChange)="mudar('addressState', $event)"
          />
          <sge-text-field
            rotulo="CEP"
            name="addressZipCode"
            dica="8 dígitos"
            [erro]="erroCampo('addressZipCode')"
            [ngModel]="form().addressZipCode"
            (ngModelChange)="mudar('addressZipCode', $event)"
          />
        </div>
      </section>

      <p class="nota">Alterações neste cadastro são registradas na trilha de auditoria (RF-114).</p>
    </form>
  `,
  styles: `
    .bloco {
      display: block;
      margin-bottom: 1rem;
    }
    .leitura {
      padding: 0.4rem 0;
      font-size: 0.85rem;
      color: var(--p-text-color);
    }
  `,
})
export class CompanyFormPage {
  private readonly api = inject(CompaniesApiService);
  private readonly rota = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly permissoes = inject(PermissionsService);
  private readonly empresas = inject(CompanyService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly regimes = REGIMES;

  protected readonly modo = signal<'atual' | 'novo' | 'edicao'>('atual');
  protected readonly empresa = signal<Company | null>(null);
  protected readonly form = signal<Formulario>({ ...VAZIO });
  protected readonly salvando = signal(false);
  protected readonly salvo = signal(false);
  protected readonly erro = signal<unknown>(null);

  protected readonly titulo = computed(() => {
    if (this.modo() === 'novo') return 'Nova empresa';
    return this.empresa()?.legalName ?? 'Empresa';
  });

  /**
   * Conveniência de interface (RF-011): o super admin cria e edita qualquer
   * empresa; o administrador da empresa ativa precisa de `company:UPDATE`.
   * Quem autoriza de verdade é o backend a cada requisição.
   */
  protected readonly podeEditar = computed(() =>
    this.modo() === 'atual' ? this.permissoes.pode('company:UPDATE') : true,
  );

  constructor() {
    const id = this.rota.snapshot.paramMap.get('id');
    if (id === null) {
      this.modo.set('atual');
      this.carregarAtual();
    } else if (id === 'nova') {
      this.modo.set('novo');
    } else {
      this.modo.set('edicao');
      this.carregar(id);
    }
  }

  protected mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
    this.salvo.set(false);
  }

  /** Erro de validação vindo da API para um campo específico (400 detalhado). */
  protected erroCampo(campo: keyof Formulario): string | null {
    const falha = this.erro();
    if (!falha || typeof falha !== 'object' || !('details' in falha)) return null;
    const detalhes = (falha as { details?: string[] }).details ?? [];
    return detalhes.find((d) => d.startsWith(`${campo} `)) ?? null;
  }

  protected voltar(): void {
    void this.router.navigate(['/administracao/empresas']);
  }

  protected salvar(): void {
    if (this.salvando() || !this.podeEditar()) return;
    this.salvando.set(true);
    this.salvo.set(false);
    this.erro.set(null);

    const corpo = this.paraDto();
    const modo = this.modo();
    const atual = this.empresa();

    const requisicao =
      modo === 'atual'
        ? this.api.updateCurrent(corpo)
        : modo === 'novo'
          ? this.api.create(corpo as CompanyInput)
          : this.api.update(atual!.id, corpo);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (empresa) => {
        this.salvando.set(false);
        this.salvo.set(true);
        this.aplicar(empresa);
        if (modo === 'novo') {
          // "nova" e ":id" são a mesma configuração de rota: o Angular reusa o
          // componente e o construtor não roda de novo. Sem virar edição aqui,
          // um segundo Salvar mandaria outro POST e criaria empresa duplicada.
          this.modo.set('edicao');
          // A empresa recém-criada precisa entrar na lista de selecionáveis do
          // super admin — senão ele acabou de cadastrá-la e continua sem
          // nenhuma empresa ativa para operar.
          this.empresas.recarregarPlataforma();
          void this.router.navigate(['/administracao/empresas', empresa.id]);
        }
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erro.set(falha);
      },
    });
  }

  private carregarAtual(): void {
    this.api
      .current()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (empresa) => this.aplicar(empresa),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private carregar(id: string): void {
    this.api
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (empresa) => this.aplicar(empresa),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private aplicar(empresa: Company): void {
    this.empresa.set(empresa);
    const endereco = empresa.addresses?.[0];
    this.form.set({
      legalName: empresa.legalName,
      tradeName: empresa.tradeName ?? '',
      taxId: formatCnpj(empresa.taxId) || (empresa.taxId ?? ''),
      stateRegistration: empresa.stateRegistration ?? '',
      municipalRegistration: empresa.municipalRegistration ?? '',
      taxRegime: empresa.taxRegime ?? '',
      mainCnae: empresa.mainCnae ?? '',
      email: empresa.email ?? '',
      phone: empresa.phone ?? '',
      addressStreet: endereco?.street ?? '',
      addressNumber: endereco?.number ?? '',
      addressComplement: endereco?.complement ?? '',
      addressDistrict: endereco?.district ?? '',
      addressCity: endereco?.city ?? '',
      addressState: endereco?.state ?? '',
      addressZipCode: endereco?.zipCode ?? '',
    });
  }

  /**
   * Só envia o que foi preenchido: o backend usa `forbidNonWhitelisted` e
   * valida cada opcional, então mandar `""` num campo com `@MaxLength`/`@IsEmail`
   * viraria erro de validação em vez de "campo vazio".
   */
  private paraDto(): Partial<CompanyInput> {
    const form = this.form();
    const dto: Partial<CompanyInput> = { legalName: form.legalName.trim() };
    const opcionais: [keyof CompanyInput, string][] = [
      ['tradeName', form.tradeName],
      ['stateRegistration', form.stateRegistration],
      ['municipalRegistration', form.municipalRegistration],
      ['mainCnae', form.mainCnae],
      ['email', form.email],
      ['phone', form.phone],
      ['addressStreet', form.addressStreet],
      ['addressNumber', form.addressNumber],
      ['addressComplement', form.addressComplement],
      ['addressDistrict', form.addressDistrict],
      ['addressCity', form.addressCity],
      ['addressState', form.addressState],
      ['addressZipCode', form.addressZipCode.replace(/\D/g, '')],
    ];
    for (const [chave, valor] of opcionais) {
      const limpo = valor.trim();
      if (limpo !== '') Object.assign(dto, { [chave]: limpo });
    }
    if (form.taxRegime !== '') dto.taxRegime = form.taxRegime as TaxRegime;
    // O CNPJ é a identidade fiscal e o backend o omite do DTO de atualização:
    // mandá-lo numa edição seria recusado por `forbidNonWhitelisted`.
    if (this.modo() === 'novo') dto.taxId = form.taxId.replace(/\D/g, '');
    return dto;
  }
}
