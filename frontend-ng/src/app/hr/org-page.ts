import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import { HrStructureApiService } from '../core/api/hr-structure-api.service';
import type { Department, Position, PositionInput } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { ListState } from '../core/lib/list-state';
import { FILTRO_SITUACAO, consultaPadrao } from '../admin/filtros';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';

type Secao = 'cargos' | 'departamentos';

interface FormularioCargo {
  code: string;
  name: string;
  cbo: string;
  description: string;
  minSalary: string;
  maxSalary: string;
}

const CARGO_VAZIO: FormularioCargo = {
  code: '',
  name: '',
  cbo: '',
  description: '',
  minSalary: '',
  maxSalary: '',
};

interface FormularioDepartamento {
  code: string;
  name: string;
  parentId: string;
  costCenterId: string;
}

const DEPARTAMENTO_VAZIO: FormularioDepartamento = {
  code: '',
  name: '',
  parentId: '',
  costCenterId: '',
};

/**
 * Cargos, departamentos e gestores (RF-014 — UI-014).
 *
 * Duas listagens no mesmo lugar, como no Figma: os dois recursos têm o mesmo
 * contrato de paginação e são editados na mesma tarefa — separá-los em telas
 * obrigaria a ir e voltar para montar a estrutura.
 *
 * O gestor imediato é atributo do funcionário (RF-014), não do departamento:
 * ele é definido no cadastro funcional (UI-013).
 */
@Component({
  selector: 'sge-org-page',
  imports: [
    FormsModule,
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
    <p class="crumb">RH / Estrutura organizacional</p>

    <div class="pagehead">
      <div>
        <h1>Cargos e departamentos</h1>
        <p>Estrutura de cargos, departamentos e gestores (RF-014).</p>
      </div>
      <div class="pagehead__actions">
        @if (secao() === 'cargos' && podeCriarCargo()) {
          <p-button label="Novo cargo" icon="pi pi-plus" (onClick)="abrirNovoCargo()" />
        }
        @if (secao() === 'departamentos' && podeCriarDepartamento()) {
          <p-button
            label="Novo departamento"
            icon="pi pi-plus"
            (onClick)="abrirNovoDepartamento()"
          />
        }
      </div>
    </div>

    <nav class="secoes" aria-label="Recurso da estrutura">
      @if (podeVerCargos()) {
        <button
          type="button"
          class="secoes__item"
          [class.secoes__item--ativa]="secao() === 'cargos'"
          (click)="trocar('cargos')"
        >
          Cargos
        </button>
      }
      @if (podeVerDepartamentos()) {
        <button
          type="button"
          class="secoes__item"
          [class.secoes__item--ativa]="secao() === 'departamentos'"
          (click)="trocar('departamentos')"
        >
          Departamentos
        </button>
      }
    </nav>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    @if (secao() === 'cargos') {
      <sge-filter-bar
        placeholderBusca="Buscar cargo por nome ou código"
        [valores]="cargos.filtros()"
        [filtros]="[FILTRO_SITUACAO]"
        (mudou)="cargos.aplicarFiltros($event)"
      />

      @if (cargos.erro(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }

      <section class="card table-card espaco">
        <sge-data-table
          [colunas]="colunasCargo"
          [linhas]="cargos.linhas()"
          [total]="cargos.total()"
          [pagina]="cargos.pagina()"
          [tamanhoPagina]="cargos.tamanhoPagina()"
          [carregando]="cargos.carregando()"
          mensagemVazia="Nenhum cargo cadastrado."
          (paginaMudou)="cargos.irParaPagina($event.page, $event.pageSize)"
        >
          <ng-template #linha let-cargo>
            <tr>
              <td>{{ cargo.code }}</td>
              <td>{{ cargo.name }}</td>
              <td>{{ cargo.cbo ?? '—' }}</td>
              <td class="coluna--numerica">{{ faixa(cargo) }}</td>
              <td>
                <p-tag
                  [value]="cargo.isActive ? 'Ativo' : 'Inativo'"
                  [severity]="cargo.isActive ? 'success' : 'secondary'"
                  [rounded]="true"
                />
              </td>
              <td class="acoes">
                @if (podeEditarCargo()) {
                  <p-button
                    label="Editar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="abrirEdicaoCargo(cargo)"
                  />
                }
                @if (podeInativarCargo() && cargo.isActive) {
                  <p-button
                    label="Inativar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="inativarCargo(cargo)"
                  />
                }
              </td>
            </tr>
          </ng-template>
        </sge-data-table>
      </section>
    } @else {
      <sge-filter-bar
        placeholderBusca="Buscar departamento por nome ou código"
        [valores]="departamentos.filtros()"
        [filtros]="[FILTRO_SITUACAO]"
        (mudou)="departamentos.aplicarFiltros($event)"
      />

      @if (departamentos.erro(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }

      <section class="card table-card espaco">
        <sge-data-table
          [colunas]="colunasDepartamento"
          [linhas]="departamentos.linhas()"
          [total]="departamentos.total()"
          [pagina]="departamentos.pagina()"
          [tamanhoPagina]="departamentos.tamanhoPagina()"
          [carregando]="departamentos.carregando()"
          mensagemVazia="Nenhum departamento cadastrado."
          (paginaMudou)="departamentos.irParaPagina($event.page, $event.pageSize)"
        >
          <ng-template #linha let-departamento>
            <tr>
              <td>{{ departamento.code }}</td>
              <td>{{ departamento.name }}</td>
              <td>{{ superior(departamento) }}</td>
              <td>
                <p-tag
                  [value]="departamento.isActive ? 'Ativo' : 'Inativo'"
                  [severity]="departamento.isActive ? 'success' : 'secondary'"
                  [rounded]="true"
                />
              </td>
              <td class="acoes">
                @if (podeEditarDepartamento()) {
                  <p-button
                    label="Editar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="abrirEdicaoDepartamento(departamento)"
                  />
                }
                @if (podeInativarDepartamento() && departamento.isActive) {
                  <p-button
                    label="Inativar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="inativarDepartamento(departamento)"
                  />
                }
              </td>
            </tr>
          </ng-template>
        </sge-data-table>
      </section>
    }

    <p-dialog
      [visible]="cargoAberto()"
      (visibleChange)="cargoAberto.set($event)"
      [modal]="true"
      [style]="{ width: '42rem' }"
      [header]="cargoEmEdicao() ? 'Editar cargo' : 'Novo cargo'"
    >
      @if (erroCargo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvarCargo()">
        <sge-text-field
          rotulo="Código"
          name="code"
          [obrigatorio]="true"
          [ngModel]="formCargo().code"
          (ngModelChange)="mudarCargo('code', $event)"
        />
        <sge-text-field
          rotulo="Cargo"
          name="name"
          [obrigatorio]="true"
          [ngModel]="formCargo().name"
          (ngModelChange)="mudarCargo('name', $event)"
        />
        <sge-text-field
          rotulo="CBO"
          name="cbo"
          dica="Somente dígitos"
          [ngModel]="formCargo().cbo"
          (ngModelChange)="mudarCargo('cbo', $event)"
        />
        <sge-text-field
          rotulo="Descrição"
          name="description"
          [ngModel]="formCargo().description"
          (ngModelChange)="mudarCargo('description', $event)"
        />
        <sge-decimal-field
          rotulo="Piso salarial"
          name="minSalary"
          [ngModel]="formCargo().minSalary"
          (ngModelChange)="mudarCargo('minSalary', $event ?? '')"
        />
        <sge-decimal-field
          rotulo="Teto salarial"
          name="maxSalary"
          [ngModel]="formCargo().maxSalary"
          (ngModelChange)="mudarCargo('maxSalary', $event ?? '')"
        />
      </form>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="cargoAberto.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvandoCargo()"
          [disabled]="salvandoCargo()"
          (onClick)="salvarCargo()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="departamentoAberto()"
      (visibleChange)="departamentoAberto.set($event)"
      [modal]="true"
      [style]="{ width: '40rem' }"
      [header]="departamentoEmEdicao() ? 'Editar departamento' : 'Novo departamento'"
    >
      @if (erroDepartamento(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvarDepartamento()">
        <sge-text-field
          rotulo="Código"
          name="code"
          [obrigatorio]="true"
          [ngModel]="formDepartamento().code"
          (ngModelChange)="mudarDepartamento('code', $event)"
        />
        <sge-text-field
          rotulo="Departamento"
          name="name"
          [obrigatorio]="true"
          [ngModel]="formDepartamento().name"
          (ngModelChange)="mudarDepartamento('name', $event)"
        />
        <sge-select-field
          rotulo="Departamento superior"
          name="parentId"
          [opcoes]="opcoesSuperior()"
          [ngModel]="formDepartamento().parentId"
          (ngModelChange)="mudarDepartamento('parentId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Centro de custo padrão"
          name="costCenterId"
          [opcoes]="opcoesCentroCusto()"
          [ngModel]="formDepartamento().costCenterId"
          (ngModelChange)="mudarDepartamento('costCenterId', $event ?? '')"
        />
      </form>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="departamentoAberto.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvandoDepartamento()"
          [disabled]="salvandoDepartamento()"
          (onClick)="salvarDepartamento()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .secoes {
      display: flex;
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
  `,
})
export class OrgPage {
  private readonly api = inject(HrStructureApiService);
  private readonly configuracoes = inject(ConfigurationsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_SITUACAO = FILTRO_SITUACAO;

  protected readonly colunasCargo: Coluna[] = [
    { campo: 'code', cabecalho: 'Código', largura: '8rem' },
    { campo: 'name', cabecalho: 'Cargo' },
    { campo: 'cbo', cabecalho: 'CBO', largura: '8rem' },
    { campo: 'faixa', cabecalho: 'Faixa salarial', numerica: true, largura: '15rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly colunasDepartamento: Coluna[] = [
    { campo: 'code', cabecalho: 'Código', largura: '8rem' },
    { campo: 'name', cabecalho: 'Departamento' },
    { campo: 'parentId', cabecalho: 'Superior' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly cargos = new ListState<Position>(
    (consulta) => this.api.listPositions(consulta),
    consultaPadrao,
  );

  protected readonly departamentos = new ListState<Department>(
    (consulta) => this.api.listDepartments(consulta),
    consultaPadrao,
  );

  protected readonly secao = signal<Secao>('cargos');
  protected readonly aviso = signal<string | null>(null);

  protected readonly cargoAberto = signal(false);
  protected readonly cargoEmEdicao = signal<Position | null>(null);
  protected readonly formCargo = signal<FormularioCargo>({ ...CARGO_VAZIO });
  protected readonly salvandoCargo = signal(false);
  protected readonly erroCargo = signal<unknown>(null);

  protected readonly departamentoAberto = signal(false);
  protected readonly departamentoEmEdicao = signal<Department | null>(null);
  protected readonly formDepartamento = signal<FormularioDepartamento>({ ...DEPARTAMENTO_VAZIO });
  protected readonly salvandoDepartamento = signal(false);
  protected readonly erroDepartamento = signal<unknown>(null);

  protected readonly opcoesSuperior = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesCentroCusto = signal<OpcaoFiltro[]>([]);

  protected readonly podeVerCargos = () => this.permissoes.pode('positions:READ');
  protected readonly podeCriarCargo = () => this.permissoes.pode('positions:CREATE');
  protected readonly podeEditarCargo = () => this.permissoes.pode('positions:UPDATE');
  protected readonly podeInativarCargo = () => this.permissoes.pode('positions:DELETE');
  protected readonly podeVerDepartamentos = () => this.permissoes.pode('departments:READ');
  protected readonly podeCriarDepartamento = () => this.permissoes.pode('departments:CREATE');
  protected readonly podeEditarDepartamento = () => this.permissoes.pode('departments:UPDATE');
  protected readonly podeInativarDepartamento = () => this.permissoes.pode('departments:DELETE');

  constructor() {
    // Abre na seção que o perfil consegue ler: quem só tem departamentos não
    // pode cair numa listagem de cargos que só devolveria 403.
    if (!this.podeVerCargos()) this.secao.set('departamentos');
    this.carregarSecao();
    this.carregarReferencias();
  }

  protected trocar(secao: Secao): void {
    if (this.secao() === secao) return;
    this.secao.set(secao);
    this.aviso.set(null);
    this.carregarSecao();
  }

  protected faixa(cargo: Position): string {
    const piso = cargo.minSalary ? formatCurrency(cargo.minSalary) : '';
    const teto = cargo.maxSalary ? formatCurrency(cargo.maxSalary) : '';
    if (piso && teto) return `${piso} – ${teto}`;
    return piso || teto || '—';
  }

  protected superior(departamento: Department): string {
    if (!departamento.parentId) return '—';
    const encontrado = this.opcoesSuperior().find((o) => o.value === departamento.parentId);
    return encontrado?.label ?? departamento.parentId;
  }

  protected mudarCargo<K extends keyof FormularioCargo>(campo: K, valor: FormularioCargo[K]): void {
    this.formCargo.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarDepartamento<K extends keyof FormularioDepartamento>(
    campo: K,
    valor: FormularioDepartamento[K],
  ): void {
    this.formDepartamento.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrirNovoCargo(): void {
    this.cargoEmEdicao.set(null);
    this.formCargo.set({ ...CARGO_VAZIO });
    this.erroCargo.set(null);
    this.cargoAberto.set(true);
  }

  protected abrirEdicaoCargo(cargo: Position): void {
    this.cargoEmEdicao.set(cargo);
    this.erroCargo.set(null);
    this.formCargo.set({
      code: cargo.code,
      name: cargo.name,
      cbo: cargo.cbo ?? '',
      description: cargo.description ?? '',
      minSalary: cargo.minSalary ?? '',
      maxSalary: cargo.maxSalary ?? '',
    });
    this.cargoAberto.set(true);
  }

  protected salvarCargo(): void {
    if (this.salvandoCargo()) return;
    this.salvandoCargo.set(true);
    this.erroCargo.set(null);

    const alvo = this.cargoEmEdicao();
    const corpo = this.cargoParaDto();
    const requisicao = alvo
      ? this.api.updatePosition(alvo.id, corpo)
      : this.api.createPosition(corpo as PositionInput);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvandoCargo.set(false);
        this.cargoAberto.set(false);
        this.aviso.set(alvo ? 'Cargo atualizado.' : 'Cargo cadastrado.');
        this.cargos.carregar();
      },
      error: (falha: unknown) => {
        this.salvandoCargo.set(false);
        this.erroCargo.set(falha);
      },
    });
  }

  protected inativarCargo(cargo: Position): void {
    this.api
      .inactivatePosition(cargo.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Cargo ${cargo.name} inativado.`);
          this.cargos.carregar();
        },
        error: (falha: unknown) => this.cargos.erro.set(falha),
      });
  }

  protected abrirNovoDepartamento(): void {
    this.departamentoEmEdicao.set(null);
    this.formDepartamento.set({ ...DEPARTAMENTO_VAZIO });
    this.erroDepartamento.set(null);
    this.departamentoAberto.set(true);
  }

  protected abrirEdicaoDepartamento(departamento: Department): void {
    this.departamentoEmEdicao.set(departamento);
    this.erroDepartamento.set(null);
    this.formDepartamento.set({
      code: departamento.code,
      name: departamento.name,
      parentId: departamento.parentId ?? '',
      costCenterId: departamento.costCenterId ?? '',
    });
    this.departamentoAberto.set(true);
  }

  protected salvarDepartamento(): void {
    if (this.salvandoDepartamento()) return;
    this.salvandoDepartamento.set(true);
    this.erroDepartamento.set(null);

    const alvo = this.departamentoEmEdicao();
    const form = this.formDepartamento();
    const corpo = {
      code: form.code.trim(),
      name: form.name.trim(),
      ...(form.parentId !== '' ? { parentId: form.parentId } : {}),
      ...(form.costCenterId !== '' ? { costCenterId: form.costCenterId } : {}),
    };

    const requisicao = alvo
      ? this.api.updateDepartment(alvo.id, corpo)
      : this.api.createDepartment(corpo);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvandoDepartamento.set(false);
        this.departamentoAberto.set(false);
        this.aviso.set(alvo ? 'Departamento atualizado.' : 'Departamento cadastrado.');
        this.departamentos.carregar();
        this.carregarReferencias();
      },
      error: (falha: unknown) => {
        this.salvandoDepartamento.set(false);
        this.erroDepartamento.set(falha);
      },
    });
  }

  protected inativarDepartamento(departamento: Department): void {
    this.api
      .inactivateDepartment(departamento.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Departamento ${departamento.name} inativado.`);
          this.departamentos.carregar();
        },
        error: (falha: unknown) => this.departamentos.erro.set(falha),
      });
  }

  /** Só a listagem visível é consultada — a outra espera o clique na seção. */
  private carregarSecao(): void {
    if (this.secao() === 'cargos') this.cargos.carregar();
    else this.departamentos.carregar();
  }

  private cargoParaDto(): Partial<PositionInput> {
    const form = this.formCargo();
    const dto: Partial<PositionInput> = { code: form.code.trim(), name: form.name.trim() };
    const opcionais: [keyof PositionInput, string][] = [
      ['cbo', form.cbo.replace(/\D/g, '')],
      ['description', form.description],
      ['minSalary', form.minSalary],
      ['maxSalary', form.maxSalary],
    ];
    for (const [chave, valor] of opcionais) {
      const limpo = valor.trim();
      if (limpo !== '') Object.assign(dto, { [chave]: limpo });
    }
    return dto;
  }

  private carregarReferencias(): void {
    if (this.podeVerDepartamentos()) {
      this.api
        .listDepartments({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesSuperior.set(
              r.data.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })),
            ),
          error: () => this.opcoesSuperior.set([]),
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
  }
}
