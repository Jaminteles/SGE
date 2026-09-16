import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import type {
  Category,
  CategoryInput,
  CompanySetting,
  CostCenter,
  CostCenterInput,
  EntryType,
  SettingScope,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { ConfirmService } from '../ui/confirm.service';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { FILTRO_SITUACAO, consultaPadrao } from './filtros';

type Aba = 'categorias' | 'centros' | 'parametros';

const TIPOS: OpcaoFiltro[] = [
  { value: 'PAGAR', label: 'Despesa (PAGAR)' },
  { value: 'RECEBER', label: 'Receita (RECEBER)' },
];

const ESCOPOS: OpcaoFiltro[] = [
  { value: 'GERAL', label: 'Geral' },
  { value: 'FINANCEIRO', label: 'Financeiro' },
  { value: 'FISCAL', label: 'Fiscal' },
];

interface FormCategoria {
  code: string;
  name: string;
  type: string;
  acceptsEntry: boolean;
}

interface FormCentro {
  code: string;
  name: string;
  description: string;
  acceptsEntry: boolean;
}

interface FormParametro {
  scope: string;
  key: string;
  value: string;
  description: string;
}

/**
 * Categorias, centros de custo e parâmetros da empresa (RF-006 — UI-008).
 *
 * O Figma desenha uma tabela só misturando categoria e centro de custo; aqui
 * são três coleções distintas, cada uma com seu endpoint e sua paginação
 * server-side. Juntá-las numa lista exigiria paginar no cliente — e a página 2
 * deixaria de bater com o total.
 */
@Component({
  selector: 'sge-configurations-page',
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
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Administração / Configurações</p>

    <div class="pagehead">
      <div>
        <h1>Categorias e centros de custo</h1>
        <p>Estruturas de classificação e parâmetros da empresa (RF-006).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriarAtual()) {
          <p-button [label]="rotuloNovo()" icon="pi pi-plus" (onClick)="abrirNovo()" />
        }
      </div>
    </div>

    <nav class="segmentos" aria-label="Coleções de configuração">
      @for (opcao of abas; track opcao.value) {
        <button
          type="button"
          class="segmentos__item"
          [class.segmentos__item--ativo]="aba() === opcao.value"
          [attr.aria-pressed]="aba() === opcao.value"
          (click)="trocarAba($any(opcao.value))"
        >
          {{ opcao.label }}
        </button>
      }
    </nav>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    @if (aba() === 'categorias') {
      <sge-filter-bar
        placeholderBusca="Buscar por código ou nome"
        [valores]="categorias.filtros()"
        [filtros]="[FILTRO_SITUACAO]"
        (mudou)="categorias.aplicarFiltros($event)"
      />

      @if (categorias.erro(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }

      <section class="card table-card espaco">
        <sge-data-table
          [colunas]="colunasCategoria"
          [linhas]="categorias.linhas()"
          [total]="categorias.total()"
          [pagina]="categorias.pagina()"
          [tamanhoPagina]="categorias.tamanhoPagina()"
          [carregando]="categorias.carregando()"
          mensagemVazia="Nenhuma categoria encontrada."
          (paginaMudou)="categorias.irParaPagina($event.page, $event.pageSize)"
        >
          <ng-template #linha let-item>
            <tr>
              <td>{{ item.code }}</td>
              <td>{{ item.name }}</td>
              <td>{{ item.type === 'PAGAR' ? 'Despesa' : 'Receita' }}</td>
              <td>{{ item.acceptsEntry ? 'Analítica' : 'Sintética' }}</td>
              <td>
                <p-tag
                  [value]="item.isActive ? 'Ativa' : 'Inativa'"
                  [severity]="item.isActive ? 'success' : 'secondary'"
                  [rounded]="true"
                />
              </td>
              <td class="acoes">
                @if (permissoes.pode('categories:UPDATE')) {
                  <p-button
                    label="Editar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="editarCategoria(item)"
                  />
                }
                @if (permissoes.pode('categories:DELETE') && item.isActive) {
                  <p-button
                    label="Inativar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="inativarCategoria(item)"
                  />
                }
              </td>
            </tr>
          </ng-template>
        </sge-data-table>
      </section>
    }

    @if (aba() === 'centros') {
      <sge-filter-bar
        placeholderBusca="Buscar por código ou nome"
        [valores]="centros.filtros()"
        [filtros]="[FILTRO_SITUACAO]"
        (mudou)="centros.aplicarFiltros($event)"
      />

      @if (centros.erro(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }

      <section class="card table-card espaco">
        <sge-data-table
          [colunas]="colunasCentro"
          [linhas]="centros.linhas()"
          [total]="centros.total()"
          [pagina]="centros.pagina()"
          [tamanhoPagina]="centros.tamanhoPagina()"
          [carregando]="centros.carregando()"
          mensagemVazia="Nenhum centro de custo encontrado."
          (paginaMudou)="centros.irParaPagina($event.page, $event.pageSize)"
        >
          <ng-template #linha let-item>
            <tr>
              <td>{{ item.code }}</td>
              <td>{{ item.name }}</td>
              <td>{{ item.description ?? '—' }}</td>
              <td>{{ item.acceptsEntry ? 'Aceita lançamento' : 'Só agrupa' }}</td>
              <td>
                <p-tag
                  [value]="item.isActive ? 'Ativo' : 'Inativo'"
                  [severity]="item.isActive ? 'success' : 'secondary'"
                  [rounded]="true"
                />
              </td>
              <td class="acoes">
                @if (permissoes.pode('cost-centers:UPDATE')) {
                  <p-button
                    label="Editar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="editarCentro(item)"
                  />
                }
                @if (permissoes.pode('cost-centers:DELETE') && item.isActive) {
                  <p-button
                    label="Inativar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="inativarCentro(item)"
                  />
                }
              </td>
            </tr>
          </ng-template>
        </sge-data-table>
      </section>
    }

    @if (aba() === 'parametros') {
      @if (erroParametros(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }

      <section class="card table-card espaco">
        <sge-data-table
          [colunas]="colunasParametro"
          [linhas]="parametros()"
          [total]="parametros().length"
          [tamanhoPagina]="parametros().length || 1"
          [carregando]="carregandoParametros()"
          mensagemVazia="Nenhum parâmetro definido."
          [virtual]="true"
        >
          <ng-template #linha let-item>
            <tr>
              <td>{{ item.scope }}</td>
              <td>{{ item.key }}</td>
              <td>
                <code>{{ valorTexto(item) }}</code>
              </td>
              <td>{{ item.description ?? '—' }}</td>
              <td class="acoes">
                @if (permissoes.pode('settings:UPDATE')) {
                  <p-button
                    label="Editar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="editarParametro(item)"
                  />
                  <p-button
                    label="Remover"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="removerParametro(item)"
                  />
                }
              </td>
            </tr>
          </ng-template>
        </sge-data-table>
      </section>
    }

    <p-dialog
      [visible]="aberto()"
      (visibleChange)="aberto.set($event)"
      [modal]="true"
      [style]="{ width: '38rem' }"
      [header]="rotuloDialogo()"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvar()">
        @if (aba() === 'categorias') {
          <sge-text-field
            rotulo="Código"
            name="code"
            [obrigatorio]="true"
            [ngModel]="formCategoria().code"
            (ngModelChange)="mudarCategoria('code', $event)"
          />
          <sge-text-field
            rotulo="Nome"
            name="name"
            [obrigatorio]="true"
            [ngModel]="formCategoria().name"
            (ngModelChange)="mudarCategoria('name', $event)"
          />
          <sge-select-field
            rotulo="Natureza"
            name="type"
            [obrigatorio]="true"
            [opcoes]="tipos"
            [ngModel]="formCategoria().type"
            (ngModelChange)="mudarCategoria('type', $event ?? '')"
          />
          <label class="marcador">
            <p-checkbox
              name="acceptsEntry"
              [binary]="true"
              [ngModel]="formCategoria().acceptsEntry"
              (ngModelChange)="mudarCategoria('acceptsEntry', $event)"
            />
            <span>Analítica (aceita lançamento)</span>
          </label>
        }

        @if (aba() === 'centros') {
          <sge-text-field
            rotulo="Código"
            name="code"
            [obrigatorio]="true"
            [ngModel]="formCentro().code"
            (ngModelChange)="mudarCentro('code', $event)"
          />
          <sge-text-field
            rotulo="Nome"
            name="name"
            [obrigatorio]="true"
            [ngModel]="formCentro().name"
            (ngModelChange)="mudarCentro('name', $event)"
          />
          <sge-text-field
            rotulo="Descrição"
            name="description"
            [ngModel]="formCentro().description"
            (ngModelChange)="mudarCentro('description', $event)"
          />
          <label class="marcador">
            <p-checkbox
              name="acceptsEntryCentro"
              [binary]="true"
              [ngModel]="formCentro().acceptsEntry"
              (ngModelChange)="mudarCentro('acceptsEntry', $event)"
            />
            <span>Aceita lançamento direto</span>
          </label>
        }

        @if (aba() === 'parametros') {
          <sge-select-field
            rotulo="Escopo"
            name="scope"
            [obrigatorio]="true"
            [opcoes]="escopos"
            [ngModel]="formParametro().scope"
            (ngModelChange)="mudarParametro('scope', $event ?? '')"
          />
          <sge-text-field
            rotulo="Chave"
            name="key"
            [obrigatorio]="true"
            [ngModel]="formParametro().key"
            (ngModelChange)="mudarParametro('key', $event)"
          />
          <sge-text-field
            rotulo="Valor"
            name="value"
            dica="JSON ou texto simples"
            [ngModel]="formParametro().value"
            (ngModelChange)="mudarParametro('value', $event)"
          />
          <sge-text-field
            rotulo="Descrição"
            name="descriptionParametro"
            [ngModel]="formParametro().description"
            (ngModelChange)="mudarParametro('description', $event)"
          />
        }
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
    .segmentos {
      display: flex;
      gap: 0.4rem;
      margin-bottom: 0.875rem;
    }
    .segmentos__item {
      padding: 0.4rem 0.8rem;
      font: inherit;
      font-size: 0.78rem;
      color: var(--p-text-muted-color);
      background: var(--p-content-background);
      border: 1px solid var(--p-content-border-color);
      border-radius: 999px;
      cursor: pointer;
    }
    .segmentos__item--ativo {
      color: var(--p-primary-contrast-color);
      background: var(--p-primary-color);
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
  `,
})
export class ConfigurationsPage {
  private readonly api = inject(ConfigurationsApiService);
  private readonly confirmacao = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly permissoes = inject(PermissionsService);

  protected readonly FILTRO_SITUACAO = FILTRO_SITUACAO;
  protected readonly tipos = TIPOS;
  protected readonly escopos = ESCOPOS;

  protected readonly abas = [
    { value: 'categorias', label: 'Categorias' },
    { value: 'centros', label: 'Centros de custo' },
    { value: 'parametros', label: 'Parâmetros' },
  ];

  protected readonly colunasCategoria: Coluna[] = [
    { campo: 'code', cabecalho: 'Código', largura: '9rem' },
    { campo: 'name', cabecalho: 'Descrição' },
    { campo: 'type', cabecalho: 'Natureza', largura: '9rem' },
    { campo: 'acceptsEntry', cabecalho: 'Nível', largura: '9rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly colunasCentro: Coluna[] = [
    { campo: 'code', cabecalho: 'Código', largura: '9rem' },
    { campo: 'name', cabecalho: 'Descrição' },
    { campo: 'description', cabecalho: 'Observação' },
    { campo: 'acceptsEntry', cabecalho: 'Uso', largura: '11rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly colunasParametro: Coluna[] = [
    { campo: 'scope', cabecalho: 'Escopo', largura: '9rem' },
    { campo: 'key', cabecalho: 'Chave', largura: '14rem' },
    { campo: 'value', cabecalho: 'Valor' },
    { campo: 'description', cabecalho: 'Descrição' },
    { campo: 'acoes', cabecalho: '', largura: '12rem' },
  ];

  protected readonly aba = signal<Aba>('categorias');

  protected readonly categorias = new ListState<Category>(
    (consulta) => this.api.listCategories(consulta),
    consultaPadrao,
  );

  protected readonly centros = new ListState<CostCenter>(
    (consulta) => this.api.listCostCenters(consulta),
    consultaPadrao,
  );

  protected readonly parametros = signal<CompanySetting[]>([]);
  protected readonly carregandoParametros = signal(false);
  protected readonly erroParametros = signal<unknown>(null);

  protected readonly aberto = signal(false);
  protected readonly editandoId = signal<string | null>(null);
  protected readonly salvando = signal(false);
  protected readonly erroForm = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly formCategoria = signal<FormCategoria>({
    code: '',
    name: '',
    type: 'PAGAR',
    acceptsEntry: true,
  });
  protected readonly formCentro = signal<FormCentro>({
    code: '',
    name: '',
    description: '',
    acceptsEntry: true,
  });
  protected readonly formParametro = signal<FormParametro>({
    scope: 'GERAL',
    key: '',
    value: '',
    description: '',
  });

  protected readonly rotuloNovo = computed(() =>
    this.aba() === 'categorias'
      ? 'Nova categoria'
      : this.aba() === 'centros'
        ? 'Novo centro de custo'
        : 'Novo parâmetro',
  );

  protected readonly rotuloDialogo = computed(() =>
    this.editandoId() ? 'Editar registro' : this.rotuloNovo(),
  );

  protected readonly podeCriarAtual = computed(() => {
    switch (this.aba()) {
      case 'categorias':
        return this.permissoes.pode('categories:CREATE');
      case 'centros':
        return this.permissoes.pode('cost-centers:CREATE');
      default:
        return this.permissoes.pode('settings:UPDATE');
    }
  });

  constructor() {
    this.categorias.carregar();
  }

  protected trocarAba(aba: Aba): void {
    this.aba.set(aba);
    this.aviso.set(null);
    if (aba === 'centros' && this.centros.linhas().length === 0) this.centros.carregar();
    if (aba === 'parametros') this.carregarParametros();
  }

  protected valorTexto(parametro: CompanySetting): string {
    const valor = parametro.value;
    return typeof valor === 'string' ? valor : JSON.stringify(valor);
  }

  protected mudarCategoria<K extends keyof FormCategoria>(campo: K, valor: FormCategoria[K]): void {
    this.formCategoria.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarCentro<K extends keyof FormCentro>(campo: K, valor: FormCentro[K]): void {
    this.formCentro.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarParametro<K extends keyof FormParametro>(campo: K, valor: FormParametro[K]): void {
    this.formParametro.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrirNovo(): void {
    this.editandoId.set(null);
    this.erroForm.set(null);
    this.formCategoria.set({ code: '', name: '', type: 'PAGAR', acceptsEntry: true });
    this.formCentro.set({ code: '', name: '', description: '', acceptsEntry: true });
    this.formParametro.set({ scope: 'GERAL', key: '', value: '', description: '' });
    this.aberto.set(true);
  }

  protected editarCategoria(item: Category): void {
    this.editandoId.set(item.id);
    this.erroForm.set(null);
    this.formCategoria.set({
      code: item.code,
      name: item.name,
      type: item.type,
      acceptsEntry: item.acceptsEntry,
    });
    this.aberto.set(true);
  }

  protected editarCentro(item: CostCenter): void {
    this.editandoId.set(item.id);
    this.erroForm.set(null);
    this.formCentro.set({
      code: item.code,
      name: item.name,
      description: item.description ?? '',
      acceptsEntry: item.acceptsEntry,
    });
    this.aberto.set(true);
  }

  protected editarParametro(item: CompanySetting): void {
    this.editandoId.set(item.id);
    this.erroForm.set(null);
    this.formParametro.set({
      scope: item.scope,
      key: item.key,
      value: this.valorTexto(item),
      description: item.description ?? '',
    });
    this.aberto.set(true);
  }

  protected salvar(): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erroForm.set(null);

    const id = this.editandoId();
    const aba = this.aba();

    // União de três respostas diferentes: a tela só precisa saber que terminou.
    const requisicao: Observable<unknown> =
      aba === 'categorias'
        ? id
          ? this.api.updateCategory(id, this.dtoCategoria())
          : this.api.createCategory(this.dtoCategoria() as CategoryInput)
        : aba === 'centros'
          ? id
            ? this.api.updateCostCenter(id, this.dtoCentro())
            : this.api.createCostCenter(this.dtoCentro() as CostCenterInput)
          : this.api.upsertSetting(this.dtoParametro());

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvando.set(false);
        this.aberto.set(false);
        this.aviso.set(id ? 'Registro atualizado.' : 'Registro cadastrado.');
        this.recarregarAtual();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroForm.set(falha);
      },
    });
  }

  protected async inativarCategoria(item: Category): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Inativar categoria?',
      mensagem:
        'A categoria deixa de ser oferecida em novos lançamentos. Os lançamentos já classificados nela não mudam.',
      rotuloConfirmar: 'Inativar',
      destrutivo: true,
    });
    if (!confirmado) return;

    this.api
      .inactivateCategory(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Categoria ${item.code} inativada.`);
          this.categorias.carregar();
        },
        error: (falha: unknown) => this.categorias.erro.set(falha),
      });
  }

  protected async inativarCentro(item: CostCenter): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Inativar centro de custo?',
      mensagem:
        'O centro de custo deixa de ser oferecido em novos lançamentos. O que já foi rateado nele não muda.',
      rotuloConfirmar: 'Inativar',
      destrutivo: true,
    });
    if (!confirmado) return;

    this.api
      .inactivateCostCenter(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Centro de custo ${item.code} inativado.`);
          this.centros.carregar();
        },
        error: (falha: unknown) => this.centros.erro.set(falha),
      });
  }

  protected async removerParametro(item: CompanySetting): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Remover parâmetro?',
      mensagem: 'O sistema volta a usar o valor padrão deste parâmetro na empresa ativa.',
      rotuloConfirmar: 'Remover',
      destrutivo: true,
    });
    if (!confirmado) return;

    this.api
      .removeSetting(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Parâmetro ${item.key} removido.`);
          this.carregarParametros();
        },
        error: (falha: unknown) => this.erroParametros.set(falha),
      });
  }

  private recarregarAtual(): void {
    switch (this.aba()) {
      case 'categorias':
        this.categorias.carregar();
        break;
      case 'centros':
        this.centros.carregar();
        break;
      default:
        this.carregarParametros();
    }
  }

  private carregarParametros(): void {
    this.carregandoParametros.set(true);
    this.erroParametros.set(null);
    this.api
      .listSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (linhas) => {
          this.parametros.set(linhas);
          this.carregandoParametros.set(false);
        },
        error: (falha: unknown) => {
          this.parametros.set([]);
          this.erroParametros.set(falha);
          this.carregandoParametros.set(false);
        },
      });
  }

  private dtoCategoria(): Partial<CategoryInput> {
    const form = this.formCategoria();
    return {
      code: form.code.trim(),
      name: form.name.trim(),
      type: form.type as EntryType,
      acceptsEntry: form.acceptsEntry,
    };
  }

  private dtoCentro(): Partial<CostCenterInput> {
    const form = this.formCentro();
    const dto: Partial<CostCenterInput> = {
      code: form.code.trim(),
      name: form.name.trim(),
      acceptsEntry: form.acceptsEntry,
    };
    const descricao = form.description.trim();
    if (descricao !== '') dto.description = descricao;
    return dto;
  }

  /**
   * `value` é `jsonb`: número, booleano e objeto vão tipados; o que não for
   * JSON válido segue como string, que é o caso mais comum de parâmetro.
   */
  private dtoParametro() {
    const form = this.formParametro();
    let valor: unknown = form.value;
    try {
      valor = JSON.parse(form.value) as unknown;
    } catch {
      valor = form.value;
    }
    const dto = {
      scope: form.scope as SettingScope,
      key: form.key.trim(),
      value: valor,
      ...(form.description.trim() !== '' ? { description: form.description.trim() } : {}),
    };
    return dto;
  }
}
