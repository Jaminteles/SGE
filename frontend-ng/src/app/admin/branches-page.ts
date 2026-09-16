import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { BranchesApiService } from '../core/api/branches-api.service';
import type { Branch, BranchInput } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCnpj } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { ConfirmService } from '../ui/confirm.service';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar } from '../ui/filter-bar';
import { TextField } from '../ui/text-field';
import { FILTRO_SITUACAO, consultaPadrao } from './filtros';

interface Formulario {
  code: string;
  name: string;
  taxId: string;
  stateRegistration: string;
  municipalRegistration: string;
  isHeadquarters: boolean;
  addressStreet: string;
  addressNumber: string;
  addressDistrict: string;
  addressCity: string;
  addressState: string;
  addressZipCode: string;
}

const VAZIO: Formulario = {
  code: '',
  name: '',
  taxId: '',
  stateRegistration: '',
  municipalRegistration: '',
  isHeadquarters: false,
  addressStreet: '',
  addressNumber: '',
  addressDistrict: '',
  addressCity: '',
  addressState: '',
  addressZipCode: '',
};

/**
 * Filiais da empresa ativa (RF-002 / RF-003 — UI-007).
 *
 * A listagem do backend não traz o endereço (é uma tabela à parte); cidade e UF
 * aparecem no formulário, que consulta o registro completo. Inventar a coluna
 * na lista exigiria uma consulta por linha — o N+1 que a paginação evita.
 */
@Component({
  selector: 'sge-branches-page',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    TagModule,
    Alert,
    DataTable,
    ErrorAlert,
    FilterBar,
    TextField,
  ],
  template: `
    <p class="crumb">Administração / Filiais</p>

    <div class="pagehead">
      <div>
        <h1>Filiais</h1>
        <p>Filiais vinculadas à empresa ativa (RF-002/RF-003).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Nova filial" icon="pi pi-plus" (onClick)="abrirNova()" />
        }
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar por nome ou código"
      [valores]="lista.filtros()"
      [filtros]="[FILTRO_SITUACAO]"
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
          lista.temFiltro()
            ? 'Nenhuma filial encontrada com esses filtros.'
            : 'Nenhuma filial cadastrada.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-filial>
          <tr>
            <td>{{ filial.code }}</td>
            <td>{{ filial.name }}</td>
            <td>{{ cnpj(filial) }}</td>
            <td>{{ filial.isHeadquarters ? 'Matriz' : 'Filial' }}</td>
            <td>
              <p-tag
                [value]="filial.isActive ? 'Ativa' : 'Inativa'"
                [severity]="filial.isActive ? 'success' : 'secondary'"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              @if (podeEditar()) {
                <p-button
                  label="Editar"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  (onClick)="abrirEdicao(filial)"
                />
              }
              @if (podeInativar() && filial.isActive) {
                <p-button
                  label="Inativar"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  (onClick)="inativar(filial)"
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
      [style]="{ width: '46rem' }"
      [header]="emEdicao() ? 'Editar filial' : 'Nova filial'"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvar()">
        <sge-text-field
          rotulo="Código"
          name="code"
          [obrigatorio]="true"
          [ngModel]="form().code"
          (ngModelChange)="mudar('code', $event)"
        />
        <sge-text-field
          rotulo="Nome"
          name="name"
          [obrigatorio]="true"
          [ngModel]="form().name"
          (ngModelChange)="mudar('name', $event)"
        />
        <sge-text-field
          rotulo="CNPJ"
          name="taxId"
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
          [ngModel]="form().addressState"
          (ngModelChange)="mudar('addressState', $event)"
        />
        <sge-text-field
          rotulo="CEP"
          name="addressZipCode"
          dica="8 dígitos"
          [ngModel]="form().addressZipCode"
          (ngModelChange)="mudar('addressZipCode', $event)"
        />
        <label class="matriz">
          <p-checkbox
            name="isHeadquarters"
            [binary]="true"
            [ngModel]="form().isHeadquarters"
            (ngModelChange)="mudar('isHeadquarters', $event)"
          />
          <span>Matriz da empresa</span>
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
          [disabled]="salvando()"
          (onClick)="salvar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.5rem;
    }
    .matriz {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--p-text-color);
    }
  `,
})
export class BranchesPage {
  private readonly api = inject(BranchesApiService);
  private readonly confirmacao = inject(ConfirmService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_SITUACAO = FILTRO_SITUACAO;

  protected readonly colunas: Coluna[] = [
    { campo: 'code', cabecalho: 'Código', largura: '7rem' },
    { campo: 'name', cabecalho: 'Filial' },
    { campo: 'taxId', cabecalho: 'CNPJ', largura: '11rem' },
    { campo: 'isHeadquarters', cabecalho: 'Tipo', largura: '7rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly lista = new ListState<Branch>(
    (consulta) => this.api.list(consulta),
    consultaPadrao,
  );

  protected readonly aberto = signal(false);
  protected readonly emEdicao = signal<Branch | null>(null);
  protected readonly form = signal<Formulario>({ ...VAZIO });
  protected readonly salvando = signal(false);
  protected readonly erroForm = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly podeCriar = () => this.permissoes.pode('branches:CREATE');
  protected readonly podeEditar = () => this.permissoes.pode('branches:UPDATE');
  protected readonly podeInativar = () => this.permissoes.pode('branches:DELETE');

  constructor() {
    this.lista.carregar();
  }

  protected cnpj(filial: Branch): string {
    return formatCnpj(filial.taxId) || '—';
  }

  protected mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrirNova(): void {
    this.emEdicao.set(null);
    this.form.set({ ...VAZIO });
    this.erroForm.set(null);
    this.aberto.set(true);
  }

  /** Busca o registro completo: a listagem não traz endereço. */
  protected abrirEdicao(filial: Branch): void {
    this.emEdicao.set(filial);
    this.erroForm.set(null);
    this.form.set({ ...VAZIO, code: filial.code, name: filial.name });
    this.aberto.set(true);

    this.api
      .get(filial.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (completo) => this.aplicar(completo),
        error: (falha: unknown) => this.erroForm.set(falha),
      });
  }

  protected salvar(): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erroForm.set(null);

    const alvo = this.emEdicao();
    const corpo = this.paraDto();
    const requisicao = alvo
      ? this.api.update(alvo.id, corpo)
      : this.api.create(corpo as BranchInput);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvando.set(false);
        this.aberto.set(false);
        this.aviso.set(alvo ? 'Filial atualizada.' : 'Filial cadastrada.');
        this.lista.carregar();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroForm.set(falha);
      },
    });
  }

  protected async inativar(filial: Branch): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Inativar filial?',
      mensagem:
        'A filial deixa de aparecer nas listagens e não pode receber novos lançamentos. O registro e o histórico são preservados.',
      rotuloConfirmar: 'Inativar',
      destrutivo: true,
    });
    if (!confirmado) return;

    this.aviso.set(null);
    this.api
      .inactivate(filial.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Filial ${filial.name} inativada.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => this.lista.erro.set(falha),
      });
  }

  private aplicar(filial: Branch): void {
    const endereco = filial.addresses?.[0];
    this.form.set({
      code: filial.code,
      name: filial.name,
      taxId: formatCnpj(filial.taxId) || (filial.taxId ?? ''),
      stateRegistration: filial.stateRegistration ?? '',
      municipalRegistration: filial.municipalRegistration ?? '',
      isHeadquarters: filial.isHeadquarters,
      addressStreet: endereco?.street ?? '',
      addressNumber: endereco?.number ?? '',
      addressDistrict: endereco?.district ?? '',
      addressCity: endereco?.city ?? '',
      addressState: endereco?.state ?? '',
      addressZipCode: endereco?.zipCode ?? '',
    });
  }

  /** Campo em branco não vai no corpo: o backend valida cada opcional. */
  private paraDto(): Partial<BranchInput> {
    const form = this.form();
    const dto: Partial<BranchInput> = {
      code: form.code.trim(),
      name: form.name.trim(),
      isHeadquarters: form.isHeadquarters,
    };
    const opcionais: [keyof BranchInput, string][] = [
      ['taxId', form.taxId.replace(/\D/g, '')],
      ['stateRegistration', form.stateRegistration],
      ['municipalRegistration', form.municipalRegistration],
      ['addressStreet', form.addressStreet],
      ['addressNumber', form.addressNumber],
      ['addressDistrict', form.addressDistrict],
      ['addressCity', form.addressCity],
      ['addressState', form.addressState],
      ['addressZipCode', form.addressZipCode.replace(/\D/g, '')],
    ];
    for (const [chave, valor] of opcionais) {
      const limpo = valor.trim();
      if (limpo !== '') Object.assign(dto, { [chave]: limpo });
    }
    return dto;
  }
}
