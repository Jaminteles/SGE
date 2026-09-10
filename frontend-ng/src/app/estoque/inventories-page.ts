import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { StockApiService } from '../core/api/stock-api.service';
import type { Inventory, InventoryStatus } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  FILTRO_STATUS_INVENTARIO,
  ROTULO_INVENTARIO,
  consultaInventario,
  severidadeInventario,
} from './rotulos';

interface Formulario {
  locationId: string;
  description: string;
}

const VAZIO: Formulario = { locationId: '', description: '' };

/**
 * Inventários (RF-033 — UI-023).
 *
 * A abertura fotografa o saldo do sistema no escopo escolhido; sem lista de
 * itens, o backend usa todos os que têm saldo no local. A contagem e a
 * conclusão ficam na tela de detalhe.
 */
@Component({
  selector: 'sge-inventories-page',
  imports: [
    FormsModule,
    RouterLink,
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
    <p class="crumb">Estoque / Inventário</p>

    <div class="pagehead">
      <div>
        <h1>Inventário</h1>
        <p>Contagem, divergências e conclusão com ajuste automático (RF-033).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Novo inventário" icon="pi pi-plus" (onClick)="abrirNovo()" />
        }
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar por número ou descrição"
      [valores]="lista.filtros()"
      [filtros]="[FILTRO_STATUS_INVENTARIO, filtroLocal()]"
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
        mensagemVazia="Nenhum inventário registrado."
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-inventario>
          <tr>
            <td>{{ inventario.number }}</td>
            <td>{{ inventario.location?.name ?? '—' }}</td>
            <td>{{ inventario.description ?? '—' }}</td>
            <td>{{ data(inventario.startedAt) }}</td>
            <td>{{ inventario.items.length }}</td>
            <td>
              <p-tag
                [value]="rotulo(inventario.status)"
                [severity]="severidade(inventario.status)"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              <p-button
                label="Abrir"
                severity="secondary"
                [text]="true"
                size="small"
                [routerLink]="[inventario.id]"
              />
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
      header="Novo inventário"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <sge-alert
        tom="info"
        titulo="A abertura fotografa o saldo atual"
        mensagem="Sem escopo informado, entram todos os itens com saldo no local escolhido."
      />

      <form class="grade-campos formulario" (ngSubmit)="salvar()">
        <sge-select-field
          rotulo="Local"
          name="locationId"
          [opcoes]="opcoesLocal()"
          [obrigatorio]="true"
          [ngModel]="form().locationId"
          (ngModelChange)="mudar('locationId', $event ?? '')"
        />
        <sge-text-field
          rotulo="Descrição"
          name="description"
          [ngModel]="form().description"
          (ngModelChange)="mudar('description', $event)"
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
          label="Abrir inventário"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando() || form().locationId === ''"
          (onClick)="salvar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.75rem;
    }
  `,
})
export class InventoriesPage {
  private readonly api = inject(StockApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_STATUS_INVENTARIO = FILTRO_STATUS_INVENTARIO;

  protected readonly colunas: Coluna[] = [
    { campo: 'number', cabecalho: 'Número', largura: '11rem' },
    { campo: 'location', cabecalho: 'Local', largura: '14rem' },
    { campo: 'description', cabecalho: 'Descrição' },
    { campo: 'startedAt', cabecalho: 'Aberto em', largura: '9rem' },
    { campo: 'items', cabecalho: 'Itens', largura: '7rem' },
    { campo: 'status', cabecalho: 'Situação', largura: '9rem' },
    { campo: 'acoes', cabecalho: '', largura: '7rem' },
  ];

  protected readonly lista = new ListState<Inventory>(
    (consulta) => this.api.listInventories(consulta),
    consultaInventario,
  );

  protected readonly aberto = signal(false);
  protected readonly form = signal<Formulario>({ ...VAZIO });
  protected readonly salvando = signal(false);
  protected readonly erroForm = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly opcoesLocal = signal<OpcaoFiltro[]>([]);

  protected readonly podeCriar = () => this.permissoes.pode('inventories:CREATE');

  constructor() {
    this.lista.carregar();
    this.carregarLocais();
  }

  protected filtroLocal() {
    return {
      name: 'locationId',
      label: 'Local',
      placeholder: 'Local',
      options: this.opcoesLocal(),
    };
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected rotulo(status: InventoryStatus): string {
    return ROTULO_INVENTARIO[status] ?? status;
  }

  protected severidade(status: InventoryStatus) {
    return severidadeInventario(status);
  }

  protected mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrirNovo(): void {
    this.form.set({ ...VAZIO });
    this.erroForm.set(null);
    this.aberto.set(true);
  }

  protected salvar(): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erroForm.set(null);

    const form = this.form();
    this.api
      .createInventory({
        locationId: form.locationId,
        ...(form.description.trim() !== '' ? { description: form.description.trim() } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (inventario) => {
          this.salvando.set(false);
          this.aberto.set(false);
          this.aviso.set(`Inventário ${inventario.number} aberto.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erroForm.set(falha);
        },
      });
  }

  private carregarLocais(): void {
    if (!this.permissoes.pode('stock-locations:READ')) return;
    this.api
      .listLocations({ pageSize: 100, isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) =>
          this.opcoesLocal.set(
            r.data.map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` })),
          ),
        error: () => this.opcoesLocal.set([]),
      });
  }
}
