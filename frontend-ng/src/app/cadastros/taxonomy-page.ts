import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { CatalogApiService } from '../core/api/catalog-api.service';
import type {
  ProductCategory,
  ProductCategoryInput,
  UnitOfMeasure,
  UnitOfMeasureInput,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { ListState } from '../core/lib/list-state';
import { FILTRO_SITUACAO, consultaPadrao } from '../admin/filtros';
import { Alert } from '../ui/alert';
import { ConfirmService } from '../ui/confirm.service';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';

type Secao = 'categorias' | 'unidades';

interface FormularioCategoria {
  code: string;
  name: string;
  parentId: string;
}

const CATEGORIA_VAZIA: FormularioCategoria = { code: '', name: '', parentId: '' };

interface FormularioUnidade {
  symbol: string;
  description: string;
}

const UNIDADE_VAZIA: FormularioUnidade = { symbol: '', description: '' };

/**
 * Categorias e unidades do catálogo (RF-029 — UI-020).
 *
 * São os dois recursos que alimentam os selects do item; ficam fora da tela do
 * catálogo porque têm permissão própria e ciclo de vida próprio — quem cadastra
 * item nem sempre pode criar categoria.
 */
@Component({
  selector: 'sge-taxonomy-page',
  imports: [
    FormsModule,
    ButtonModule,
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
    <p class="crumb">Cadastros / Categorias e unidades</p>

    <div class="pagehead">
      <div>
        <h1>Categorias e unidades</h1>
        <p>Classificação e unidade de medida dos itens do catálogo (RF-029).</p>
      </div>
      <div class="pagehead__actions">
        @if (secao() === 'categorias' && podeCriarCategoria()) {
          <p-button label="Nova categoria" icon="pi pi-plus" (onClick)="abrirNovaCategoria()" />
        }
        @if (secao() === 'unidades' && podeCriarUnidade()) {
          <p-button label="Nova unidade" icon="pi pi-plus" (onClick)="abrirNovaUnidade()" />
        }
      </div>
    </div>

    <nav class="secoes" aria-label="Recurso de classificação">
      @if (podeVerCategorias()) {
        <button
          type="button"
          class="secoes__item"
          [class.secoes__item--ativa]="secao() === 'categorias'"
          (click)="trocar('categorias')"
        >
          Categorias
        </button>
      }
      @if (podeVerUnidades()) {
        <button
          type="button"
          class="secoes__item"
          [class.secoes__item--ativa]="secao() === 'unidades'"
          (click)="trocar('unidades')"
        >
          Unidades de medida
        </button>
      }
    </nav>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    @if (secao() === 'categorias') {
      <sge-filter-bar
        placeholderBusca="Buscar categoria por nome ou código"
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
          mensagemVazia="Nenhuma categoria cadastrada."
          (paginaMudou)="categorias.irParaPagina($event.page, $event.pageSize)"
        >
          <ng-template #linha let-categoria>
            <tr>
              <td>{{ categoria.code }}</td>
              <td>{{ categoria.name }}</td>
              <td>{{ superior(categoria) }}</td>
              <td>
                <p-tag
                  [value]="categoria.isActive ? 'Ativa' : 'Inativa'"
                  [severity]="categoria.isActive ? 'success' : 'secondary'"
                  [rounded]="true"
                />
              </td>
              <td class="acoes">
                @if (podeEditarCategoria()) {
                  <p-button
                    label="Editar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="abrirEdicaoCategoria(categoria)"
                  />
                }
                @if (podeInativarCategoria() && categoria.isActive) {
                  <p-button
                    label="Inativar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="inativarCategoria(categoria)"
                  />
                }
              </td>
            </tr>
          </ng-template>
        </sge-data-table>
      </section>
    } @else {
      <sge-filter-bar
        placeholderBusca="Buscar unidade por símbolo ou descrição"
        [valores]="unidades.filtros()"
        [filtros]="[FILTRO_SITUACAO]"
        (mudou)="unidades.aplicarFiltros($event)"
      />

      @if (unidades.erro(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }

      <section class="card table-card espaco">
        <sge-data-table
          [colunas]="colunasUnidade"
          [linhas]="unidades.linhas()"
          [total]="unidades.total()"
          [pagina]="unidades.pagina()"
          [tamanhoPagina]="unidades.tamanhoPagina()"
          [carregando]="unidades.carregando()"
          mensagemVazia="Nenhuma unidade cadastrada."
          (paginaMudou)="unidades.irParaPagina($event.page, $event.pageSize)"
        >
          <ng-template #linha let-unidade>
            <tr>
              <td>{{ unidade.symbol }}</td>
              <td>{{ unidade.description }}</td>
              <td>
                <p-tag
                  [value]="unidade.isActive ? 'Ativa' : 'Inativa'"
                  [severity]="unidade.isActive ? 'success' : 'secondary'"
                  [rounded]="true"
                />
              </td>
              <td class="acoes">
                @if (podeEditarUnidade()) {
                  <p-button
                    label="Editar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="abrirEdicaoUnidade(unidade)"
                  />
                }
                @if (podeInativarUnidade() && unidade.isActive) {
                  <p-button
                    label="Inativar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="inativarUnidade(unidade)"
                  />
                }
              </td>
            </tr>
          </ng-template>
        </sge-data-table>
      </section>
    }

    <p-dialog
      [visible]="categoriaAberta()"
      (visibleChange)="categoriaAberta.set($event)"
      [modal]="true"
      [style]="{ width: '38rem' }"
      [header]="categoriaEmEdicao() ? 'Editar categoria' : 'Nova categoria'"
    >
      @if (erroCategoria(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvarCategoria()">
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
          rotulo="Categoria superior"
          name="parentId"
          [opcoes]="opcoesSuperior()"
          [ngModel]="formCategoria().parentId"
          (ngModelChange)="mudarCategoria('parentId', $event ?? '')"
        />
      </form>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="categoriaAberta.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvandoCategoria()"
          [disabled]="salvandoCategoria()"
          (onClick)="salvarCategoria()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="unidadeAberta()"
      (visibleChange)="unidadeAberta.set($event)"
      [modal]="true"
      [style]="{ width: '34rem' }"
      [header]="unidadeEmEdicao() ? 'Editar unidade' : 'Nova unidade'"
    >
      @if (erroUnidade(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvarUnidade()">
        <sge-text-field
          rotulo="Símbolo"
          name="symbol"
          dica="Ex.: UN, KG, M3"
          [obrigatorio]="true"
          [ngModel]="formUnidade().symbol"
          (ngModelChange)="mudarUnidade('symbol', $event)"
        />
        <sge-text-field
          rotulo="Descrição"
          name="unitDescription"
          [obrigatorio]="true"
          [ngModel]="formUnidade().description"
          (ngModelChange)="mudarUnidade('description', $event)"
        />
      </form>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="unidadeAberta.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvandoUnidade()"
          [disabled]="salvandoUnidade()"
          (onClick)="salvarUnidade()"
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
export class TaxonomyPage {
  private readonly api = inject(CatalogApiService);
  private readonly confirmacao = inject(ConfirmService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_SITUACAO = FILTRO_SITUACAO;

  protected readonly colunasCategoria: Coluna[] = [
    { campo: 'code', cabecalho: 'Código', largura: '9rem' },
    { campo: 'name', cabecalho: 'Categoria' },
    { campo: 'parentId', cabecalho: 'Superior' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly colunasUnidade: Coluna[] = [
    { campo: 'symbol', cabecalho: 'Símbolo', largura: '8rem' },
    { campo: 'description', cabecalho: 'Descrição' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly categorias = new ListState<ProductCategory>(
    (consulta) => this.api.listCategories(consulta),
    consultaPadrao,
  );

  protected readonly unidades = new ListState<UnitOfMeasure>(
    (consulta) => this.api.listUnits(consulta),
    consultaPadrao,
  );

  protected readonly secao = signal<Secao>('categorias');
  protected readonly aviso = signal<string | null>(null);
  protected readonly opcoesSuperior = signal<OpcaoFiltro[]>([]);

  protected readonly categoriaAberta = signal(false);
  protected readonly categoriaEmEdicao = signal<ProductCategory | null>(null);
  protected readonly formCategoria = signal<FormularioCategoria>({ ...CATEGORIA_VAZIA });
  protected readonly salvandoCategoria = signal(false);
  protected readonly erroCategoria = signal<unknown>(null);

  protected readonly unidadeAberta = signal(false);
  protected readonly unidadeEmEdicao = signal<UnitOfMeasure | null>(null);
  protected readonly formUnidade = signal<FormularioUnidade>({ ...UNIDADE_VAZIA });
  protected readonly salvandoUnidade = signal(false);
  protected readonly erroUnidade = signal<unknown>(null);

  protected readonly podeVerCategorias = () => this.permissoes.pode('product-categories:READ');
  protected readonly podeCriarCategoria = () => this.permissoes.pode('product-categories:CREATE');
  protected readonly podeEditarCategoria = () => this.permissoes.pode('product-categories:UPDATE');
  protected readonly podeInativarCategoria = () =>
    this.permissoes.pode('product-categories:DELETE');
  protected readonly podeVerUnidades = () => this.permissoes.pode('units-of-measure:READ');
  protected readonly podeCriarUnidade = () => this.permissoes.pode('units-of-measure:CREATE');
  protected readonly podeEditarUnidade = () => this.permissoes.pode('units-of-measure:UPDATE');
  protected readonly podeInativarUnidade = () => this.permissoes.pode('units-of-measure:DELETE');

  constructor() {
    if (!this.podeVerCategorias()) this.secao.set('unidades');
    this.carregarSecao();
    this.carregarSuperiores();
  }

  protected trocar(secao: Secao): void {
    if (this.secao() === secao) return;
    this.secao.set(secao);
    this.aviso.set(null);
    this.carregarSecao();
  }

  protected superior(categoria: ProductCategory): string {
    if (!categoria.parentId) return '—';
    return (
      this.opcoesSuperior().find((o) => o.value === categoria.parentId)?.label ?? categoria.parentId
    );
  }

  protected mudarCategoria<K extends keyof FormularioCategoria>(
    campo: K,
    valor: FormularioCategoria[K],
  ): void {
    this.formCategoria.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarUnidade<K extends keyof FormularioUnidade>(
    campo: K,
    valor: FormularioUnidade[K],
  ): void {
    this.formUnidade.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrirNovaCategoria(): void {
    this.categoriaEmEdicao.set(null);
    this.formCategoria.set({ ...CATEGORIA_VAZIA });
    this.erroCategoria.set(null);
    this.categoriaAberta.set(true);
  }

  protected abrirEdicaoCategoria(categoria: ProductCategory): void {
    this.categoriaEmEdicao.set(categoria);
    this.erroCategoria.set(null);
    this.formCategoria.set({
      code: categoria.code,
      name: categoria.name,
      parentId: categoria.parentId ?? '',
    });
    this.categoriaAberta.set(true);
  }

  protected salvarCategoria(): void {
    if (this.salvandoCategoria()) return;
    this.salvandoCategoria.set(true);
    this.erroCategoria.set(null);

    const form = this.formCategoria();
    const corpo: ProductCategoryInput = {
      code: form.code.trim(),
      name: form.name.trim(),
      ...(form.parentId !== '' ? { parentId: form.parentId } : {}),
    };

    const alvo = this.categoriaEmEdicao();
    const requisicao = alvo
      ? this.api.updateCategory(alvo.id, corpo)
      : this.api.createCategory(corpo);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvandoCategoria.set(false);
        this.categoriaAberta.set(false);
        this.aviso.set(alvo ? 'Categoria atualizada.' : 'Categoria cadastrada.');
        this.categorias.carregar();
        this.carregarSuperiores();
      },
      error: (falha: unknown) => {
        this.salvandoCategoria.set(false);
        this.erroCategoria.set(falha);
      },
    });
  }

  protected async inativarCategoria(categoria: ProductCategory): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Inativar categoria de produto?',
      mensagem:
        'A categoria deixa de ser oferecida em novos produtos. Os produtos já classificados nela não mudam.',
      rotuloConfirmar: 'Inativar',
      destrutivo: true,
    });
    if (!confirmado) return;

    this.api
      .inactivateCategory(categoria.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Categoria ${categoria.name} inativada.`);
          this.categorias.carregar();
        },
        error: (falha: unknown) => this.categorias.erro.set(falha),
      });
  }

  protected abrirNovaUnidade(): void {
    this.unidadeEmEdicao.set(null);
    this.formUnidade.set({ ...UNIDADE_VAZIA });
    this.erroUnidade.set(null);
    this.unidadeAberta.set(true);
  }

  protected abrirEdicaoUnidade(unidade: UnitOfMeasure): void {
    this.unidadeEmEdicao.set(unidade);
    this.erroUnidade.set(null);
    this.formUnidade.set({ symbol: unidade.symbol, description: unidade.description });
    this.unidadeAberta.set(true);
  }

  protected salvarUnidade(): void {
    if (this.salvandoUnidade()) return;
    this.salvandoUnidade.set(true);
    this.erroUnidade.set(null);

    const form = this.formUnidade();
    const corpo: UnitOfMeasureInput = {
      symbol: form.symbol.trim().toUpperCase(),
      description: form.description.trim(),
    };

    const alvo = this.unidadeEmEdicao();
    const requisicao = alvo ? this.api.updateUnit(alvo.id, corpo) : this.api.createUnit(corpo);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvandoUnidade.set(false);
        this.unidadeAberta.set(false);
        this.aviso.set(alvo ? 'Unidade atualizada.' : 'Unidade cadastrada.');
        this.unidades.carregar();
      },
      error: (falha: unknown) => {
        this.salvandoUnidade.set(false);
        this.erroUnidade.set(falha);
      },
    });
  }

  protected async inativarUnidade(unidade: UnitOfMeasure): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Inativar unidade de medida?',
      mensagem:
        'A unidade deixa de ser oferecida em novos produtos. Os produtos que já a usam não mudam.',
      rotuloConfirmar: 'Inativar',
      destrutivo: true,
    });
    if (!confirmado) return;

    this.api
      .inactivateUnit(unidade.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Unidade ${unidade.symbol} inativada.`);
          this.unidades.carregar();
        },
        error: (falha: unknown) => this.unidades.erro.set(falha),
      });
  }

  /** Só a listagem visível é consultada — a outra espera o clique na seção. */
  private carregarSecao(): void {
    if (this.secao() === 'categorias') this.categorias.carregar();
    else this.unidades.carregar();
  }

  private carregarSuperiores(): void {
    if (!this.podeVerCategorias()) return;
    this.api
      .listCategories({ pageSize: 100, isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) =>
          this.opcoesSuperior.set(
            r.data.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
          ),
        error: () => this.opcoesSuperior.set([]),
      });
  }
}
