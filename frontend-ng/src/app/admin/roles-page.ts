import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { RolesApiService } from '../core/api/roles-api.service';
import type { PermissionCatalogItem, Role } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro, type ValoresFiltro } from '../ui/filter-bar';
import { StateScreen } from '../ui/state-screen';
import { TextField } from '../ui/text-field';

/** Ordem das colunas da matriz, no vocabulário do catálogo do backend. */
const ACOES = [
  { code: 'READ', label: 'Ler' },
  { code: 'CREATE', label: 'Criar' },
  { code: 'UPDATE', label: 'Editar' },
  { code: 'DELETE', label: 'Excluir' },
  { code: 'APPROVE', label: 'Aprovar' },
  { code: 'EXPORT', label: 'Exportar' },
];

interface LinhaMatriz {
  resource: string;
  module: string;
  /** Código `recurso:AÇÃO` por ação, ou `null` quando a ação não existe. */
  celulas: (string | null)[];
}

/**
 * Perfis e permissões por módulo (RF-010 / RF-011 — UI-010).
 *
 * A matriz é montada a partir do catálogo global (`GET /permissions`), não de
 * uma lista fixa no cliente: permissão nova no backend aparece aqui sozinha, e
 * uma permissão que só existe na tela nunca é oferecida.
 *
 * Marcar a caixa não concede nada: o `PATCH` substitui a lista do perfil e o
 * backend recusa código que não existe no catálogo.
 */
@Component({
  selector: 'sge-roles-page',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    TableModule,
    TagModule,
    Alert,
    ErrorAlert,
    FilterBar,
    StateScreen,
    TextField,
  ],
  template: `
    <p class="crumb">Administração / Perfis</p>

    <div class="pagehead">
      <div>
        <h1>Perfis e permissões</h1>
        <p>Permissões por módulo, no formato recurso:AÇÃO (RF-010/RF-011).</p>
      </div>
      <div class="pagehead__actions">
        @if (permissoes.pode('roles:CREATE')) {
          <p-button label="Novo perfil" icon="pi pi-plus" (onClick)="abrirNovo()" />
        }
        @if (selecionado() && permissoes.pode('roles:UPDATE')) {
          <p-button
            label="Salvar permissões"
            icon="pi pi-check"
            [loading]="salvando()"
            [disabled]="salvando() || !alterado()"
            (onClick)="salvarPermissoes()"
          />
        }
      </div>
    </div>

    @if (erro(); as falha) {
      <sge-error-alert [erro]="falha" />
    }

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    <nav class="perfis" aria-label="Perfis da empresa">
      @for (perfil of perfis(); track perfil.id) {
        <button
          type="button"
          class="perfis__item"
          [class.perfis__item--ativo]="perfil.id === selecionado()?.id"
          [attr.aria-pressed]="perfil.id === selecionado()?.id"
          (click)="selecionar(perfil)"
        >
          {{ perfil.name }}
          @if (perfil.isSystem) {
            <span class="perfis__marca">sistema</span>
          }
        </button>
      }
    </nav>

    @if (selecionado(); as perfil) {
      <sge-filter-bar
        placeholderBusca="Buscar recurso"
        [valores]="filtros()"
        [filtros]="[filtroModulo()]"
        (mudou)="filtros.set($event)"
      />

      <section class="card table-card espaco">
        <header class="table-card__head">
          <h2>{{ perfil.name }}</h2>
          <span class="table-card__count">
            {{ linhas().length }} de {{ matriz().length }} recursos ·
            {{ concedidas().size }} permissões concedidas
          </span>
        </header>

        @if (perfil.isSystem) {
          <p class="nota nota--recuo">Perfil de sistema: a alteração pode ser recusada pela API.</p>
        }

        <p-table [value]="linhas()" [tableStyle]="{ 'min-width': '100%' }">
          <ng-template #header>
            <tr>
              <th scope="col">Recurso</th>
              @for (acao of acoes; track acao.code) {
                <th scope="col" class="col-acao">{{ acao.label }}</th>
              }
            </tr>
          </ng-template>

          <ng-template #body let-linha>
            <tr>
              <td>
                <code>{{ linha.resource }}</code>
                <span class="secundario">{{ linha.module }}</span>
              </td>
              @for (celula of linha.celulas; track $index) {
                <td class="col-acao">
                  @if (celula) {
                    <p-checkbox
                      [binary]="true"
                      [ngModel]="concedidas().has(celula)"
                      [disabled]="!podeEditar()"
                      [ariaLabel]="celula"
                      (ngModelChange)="alternar(celula, $event)"
                    />
                  } @else {
                    <span class="vazio" aria-hidden="true">—</span>
                  }
                </td>
              }
            </tr>
          </ng-template>

          <ng-template #emptymessage>
            <tr>
              <td [attr.colspan]="acoes.length + 1" class="sem-linhas">
                Nenhum recurso encontrado com esses filtros.
              </td>
            </tr>
          </ng-template>
        </p-table>
      </section>
    } @else if (!carregando()) {
      <section class="card espaco">
        <sge-state-screen
          icone="pi-users"
          titulo="Nenhum perfil nesta empresa"
          mensagem="Crie um perfil para distribuir permissões por módulo."
        />
      </section>
    }

    <p-dialog
      [visible]="dialogo()"
      (visibleChange)="dialogo.set($event)"
      [modal]="true"
      [style]="{ width: '32rem' }"
      header="Novo perfil"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="criar()">
        <sge-text-field
          rotulo="Nome"
          name="name"
          [obrigatorio]="true"
          [ngModel]="nome()"
          (ngModelChange)="nome.set($event)"
        />
        <sge-text-field
          rotulo="Descrição"
          name="description"
          [ngModel]="descricao()"
          (ngModelChange)="descricao.set($event)"
        />
      </form>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="dialogo.set(false)"
        />
        <p-button
          label="Criar"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando()"
          (onClick)="criar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .perfis {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-bottom: 0.875rem;
    }
    .perfis__item {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.4rem 0.8rem;
      font: inherit;
      font-size: 0.78rem;
      color: var(--p-text-muted-color);
      background: var(--p-content-background);
      border: 1px solid var(--p-content-border-color);
      border-radius: 999px;
      cursor: pointer;
    }
    .perfis__item--ativo {
      color: var(--p-primary-contrast-color);
      background: var(--p-primary-color);
      border-color: var(--p-primary-color);
    }
    .perfis__marca {
      font-size: 0.65rem;
      opacity: 0.75;
    }
    .col-acao {
      width: 6rem;
      text-align: center;
    }
    .vazio {
      color: var(--p-text-muted-color);
    }
    .sem-linhas {
      padding: 2.5rem 1rem;
      text-align: center;
      color: var(--p-text-muted-color);
    }
    .nota--recuo {
      padding: 0 1.125rem;
    }
  `,
})
export class RolesPage {
  private readonly api = inject(RolesApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly permissoes = inject(PermissionsService);
  protected readonly acoes = ACOES;

  protected readonly perfis = signal<Role[]>([]);
  protected readonly selecionado = signal<Role | null>(null);
  protected readonly catalogo = signal<PermissionCatalogItem[]>([]);
  protected readonly concedidas = signal<Set<string>>(new Set());
  protected readonly filtros = signal<ValoresFiltro>({ q: '', modulo: '' });

  protected readonly carregando = signal(true);
  protected readonly salvando = signal(false);
  protected readonly alterado = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly erroForm = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly dialogo = signal(false);
  protected readonly nome = signal('');
  protected readonly descricao = signal('');

  protected readonly podeEditar = computed(() => this.permissoes.pode('roles:UPDATE'));

  /** Uma linha por recurso; cada coluna vira o código da ação, se existir. */
  protected readonly matriz = computed<LinhaMatriz[]>(() => {
    const porRecurso = new Map<string, LinhaMatriz>();
    for (const item of this.catalogo()) {
      const linha = porRecurso.get(item.resource) ?? {
        resource: item.resource,
        module: item.module,
        celulas: ACOES.map(() => null),
      };
      const indice = ACOES.findIndex((acao) => acao.code === item.action);
      if (indice >= 0) linha.celulas[indice] = item.code;
      porRecurso.set(item.resource, linha);
    }
    return [...porRecurso.values()].sort((a, b) => a.resource.localeCompare(b.resource));
  });

  protected readonly filtroModulo = computed<DefinicaoFiltro>(() => ({
    name: 'modulo',
    label: 'Módulo',
    options: [...new Set(this.catalogo().map((item) => item.module))]
      .sort()
      .map((modulo) => ({ value: modulo, label: modulo })),
  }));

  /**
   * A busca é local de propósito: o catálogo de permissões vem inteiro numa
   * resposta, não é uma coleção paginada — filtrar no servidor exigiria uma
   * requisição por tecla sem nenhum ganho.
   */
  protected readonly linhas = computed(() => {
    const termo = this.filtros().q.trim().toLowerCase();
    const modulo = this.filtros()['modulo'] ?? '';
    return this.matriz().filter(
      (linha) =>
        (termo === '' || linha.resource.toLowerCase().includes(termo)) &&
        (modulo === '' || linha.module === modulo),
    );
  });

  constructor() {
    this.carregarCatalogo();
    this.carregarPerfis();
  }

  protected selecionar(perfil: Role): void {
    this.selecionado.set(perfil);
    this.concedidas.set(new Set(perfil.permissions));
    this.alterado.set(false);
    this.aviso.set(null);
  }

  protected alternar(codigo: string, marcado: boolean): void {
    this.concedidas.update((atual) => {
      const proximo = new Set(atual);
      if (marcado) proximo.add(codigo);
      else proximo.delete(codigo);
      return proximo;
    });
    this.alterado.set(true);
    this.aviso.set(null);
  }

  protected salvarPermissoes(): void {
    const perfil = this.selecionado();
    if (!perfil || this.salvando()) return;

    this.salvando.set(true);
    this.erro.set(null);

    this.api
      .update(perfil.id, { permissions: [...this.concedidas()] })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (atualizado) => {
          this.salvando.set(false);
          this.alterado.set(false);
          this.aviso.set(`Permissões do perfil ${atualizado.name} atualizadas.`);
          this.substituir(atualizado);
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erro.set(falha);
        },
      });
  }

  protected abrirNovo(): void {
    this.nome.set('');
    this.descricao.set('');
    this.erroForm.set(null);
    this.dialogo.set(true);
  }

  protected criar(): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erroForm.set(null);

    const descricao = this.descricao().trim();
    this.api
      .create({
        name: this.nome().trim(),
        permissions: [],
        ...(descricao !== '' ? { description: descricao } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (perfil) => {
          this.salvando.set(false);
          this.dialogo.set(false);
          this.perfis.update((atual) => [...atual, perfil]);
          this.selecionar(perfil);
          this.aviso.set(`Perfil ${perfil.name} criado. Marque as permissões e salve.`);
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erroForm.set(falha);
        },
      });
  }

  private substituir(perfil: Role): void {
    this.perfis.update((atual) => atual.map((p) => (p.id === perfil.id ? perfil : p)));
    this.selecionado.set(perfil);
    this.concedidas.set(new Set(perfil.permissions));
  }

  private carregarPerfis(): void {
    this.api
      .list({ pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => {
          this.carregando.set(false);
          this.perfis.set(resultado.data);
          const primeiro = resultado.data[0];
          if (primeiro) this.selecionar(primeiro);
        },
        error: (falha: unknown) => {
          this.carregando.set(false);
          this.erro.set(falha);
        },
      });
  }

  private carregarCatalogo(): void {
    this.api
      .permissionCatalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (itens) => this.catalogo.set(itens),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }
}
