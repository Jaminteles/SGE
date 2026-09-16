import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { BranchesApiService } from '../core/api/branches-api.service';
import { StockApiService } from '../core/api/stock-api.service';
import type { StockLocation, StockLocationInput } from '../core/api/types';
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

interface Formulario {
  branchId: string;
  code: string;
  name: string;
  isDefault: boolean;
}

const VAZIO: Formulario = { branchId: '', code: '', name: '', isDefault: false };

/**
 * Locais de estoque (RF-031 — UI-021).
 *
 * Todo local pertence a uma filial: é por ela que a movimentação encontra o
 * estoque certo e que a RLS confere o alcance do usuário. Por isso a filial é
 * obrigatória e não muda depois — trocá-la moveria o saldo de lugar sem
 * movimento no razão.
 */
@Component({
  selector: 'sge-stock-locations-page',
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
    <p class="crumb">Estoque / Locais</p>

    <div class="pagehead">
      <div>
        <h1>Locais de estoque</h1>
        <p>Almoxarifados e depósitos por filial (RF-031).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Novo local" icon="pi pi-plus" (onClick)="abrirNovo()" />
        }
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar local por nome ou código"
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
        mensagemVazia="Nenhum local cadastrado."
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-local>
          <tr>
            <td>{{ local.code }}</td>
            <td>{{ local.name }}</td>
            <td>{{ local.branch?.name ?? '—' }}</td>
            <td>
              @if (local.isDefault) {
                <p-tag value="Padrão" severity="info" [rounded]="true" />
              }
            </td>
            <td>
              <p-tag
                [value]="local.isActive ? 'Ativo' : 'Inativo'"
                [severity]="local.isActive ? 'success' : 'secondary'"
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
                  (onClick)="abrirEdicao(local)"
                />
              }
              @if (podeInativar() && local.isActive) {
                <p-button
                  label="Inativar"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  (onClick)="inativar(local)"
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
      [style]="{ width: '38rem' }"
      [header]="emEdicao() ? 'Editar local' : 'Novo local'"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvar()">
        <sge-select-field
          rotulo="Filial"
          name="branchId"
          [opcoes]="opcoesFilial()"
          [obrigatorio]="true"
          [disabled]="emEdicao() !== null"
          dica="Não muda depois: o saldo pertence à filial"
          [ngModel]="form().branchId"
          (ngModelChange)="mudar('branchId', $event ?? '')"
        />
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
        <label class="marcador">
          <p-checkbox
            name="isDefault"
            [binary]="true"
            [ngModel]="form().isDefault"
            (ngModelChange)="mudar('isDefault', $event)"
          />
          <span>Local padrão da filial</span>
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
    .marcador {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--p-text-color);
    }
  `,
})
export class StockLocationsPage {
  private readonly api = inject(StockApiService);
  private readonly confirmacao = inject(ConfirmService);
  private readonly filiais = inject(BranchesApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_SITUACAO = FILTRO_SITUACAO;

  protected readonly colunas: Coluna[] = [
    { campo: 'code', cabecalho: 'Código', largura: '9rem' },
    { campo: 'name', cabecalho: 'Local' },
    { campo: 'branch', cabecalho: 'Filial', largura: '14rem' },
    { campo: 'isDefault', cabecalho: '', largura: '7rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly lista = new ListState<StockLocation>(
    (consulta) => this.api.listLocations(consulta),
    consultaPadrao,
  );

  protected readonly aberto = signal(false);
  protected readonly emEdicao = signal<StockLocation | null>(null);
  protected readonly form = signal<Formulario>({ ...VAZIO });
  protected readonly salvando = signal(false);
  protected readonly erroForm = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly opcoesFilial = signal<OpcaoFiltro[]>([]);

  protected readonly podeCriar = () => this.permissoes.pode('stock-locations:CREATE');
  protected readonly podeEditar = () => this.permissoes.pode('stock-locations:UPDATE');
  protected readonly podeInativar = () => this.permissoes.pode('stock-locations:DELETE');

  constructor() {
    this.lista.carregar();
    this.carregarFiliais();
  }

  protected mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrirNovo(): void {
    this.emEdicao.set(null);
    this.form.set({ ...VAZIO });
    this.erroForm.set(null);
    this.aberto.set(true);
  }

  protected abrirEdicao(local: StockLocation): void {
    this.emEdicao.set(local);
    this.erroForm.set(null);
    this.form.set({
      branchId: local.branchId,
      code: local.code,
      name: local.name,
      isDefault: local.isDefault,
    });
    this.aberto.set(true);
  }

  protected salvar(): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erroForm.set(null);

    const form = this.form();
    const alvo = this.emEdicao();
    // Na edição a filial fica de fora: mover o local trocaria a dona do saldo
    // sem nenhum movimento no razão.
    const corpo: Partial<StockLocationInput> = {
      code: form.code.trim(),
      name: form.name.trim(),
      isDefault: form.isDefault,
      ...(alvo ? {} : { branchId: form.branchId }),
    };

    const requisicao = alvo
      ? this.api.updateLocation(alvo.id, corpo)
      : this.api.createLocation(corpo as StockLocationInput);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvando.set(false);
        this.aberto.set(false);
        this.aviso.set(alvo ? 'Local atualizado.' : 'Local cadastrado.');
        this.lista.carregar();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroForm.set(falha);
      },
    });
  }

  protected async inativar(local: StockLocation): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Inativar local de estoque?',
      mensagem:
        'O local deixa de ser oferecido em novas movimentações. O saldo já registrado nele é preservado.',
      rotuloConfirmar: 'Inativar',
      destrutivo: true,
    });
    if (!confirmado) return;

    this.api
      .inactivateLocation(local.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Local ${local.name} inativado.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => this.lista.erro.set(falha),
      });
  }

  private carregarFiliais(): void {
    if (!this.permissoes.pode('branches:READ')) return;
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
