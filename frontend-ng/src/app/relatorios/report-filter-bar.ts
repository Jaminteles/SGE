import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';

import { BankingApiService } from '../core/api/banking-api.service';
import { BranchesApiService } from '../core/api/branches-api.service';
import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import { PartnersApiService } from '../core/api/partners-api.service';
import { PermissionsService } from '../core/authz/permissions.service';
import { Alert } from '../ui/alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  DIMENSOES,
  type Dimensao,
  type FiltroRelatorio,
  PERMISSAO_DIMENSAO,
  ROTULO_DIMENSAO,
  ReportFilterStore,
  dimensoesEmUso,
  problemaFiltro,
} from './filtros';

/** Teto das listas de apoio: são escolhas de filtro, não navegação de cadastro. */
const LIMITE_OPCOES = 100;

/**
 * Filtros combinados dos painéis e relatórios (RF-112 — UI-072).
 *
 * Um só recorte para o módulo inteiro: o `ReportFilterStore` vive na rota de
 * Relatórios, então trocar de painel mantém período e dimensões. Cada painel
 * usa as dimensões que a consulta dele entende e ignora as demais — filtro que
 * não faz sentido numa consulta é ignorado por ela, nunca aplicado a outra
 * coluna por semelhança de nome.
 *
 * As listas de apoio respeitam a permissão de cada cadastro: sem
 * `partners:READ` o select de parceiro não é desenhado, porque só devolveria
 * 403. Nada disso é controle de acesso — quem decide é o backend.
 *
 * Só "Aplicar" dispara consulta. Cada painel do M15 faz de três a cinco
 * consultas agregadas; recarregar a cada tecla digitada num campo de data
 * multiplicaria isso por engano de digitação.
 */
@Component({
  selector: 'sge-report-filter-bar',
  imports: [FormsModule, ButtonModule, Alert, SelectField, TextField],
  template: `
    <section class="card espaco barra">
      <sge-text-field
        rotulo="De"
        tipo="date"
        [obrigatorio]="true"
        [ngModel]="rascunho().from"
        (ngModelChange)="mudar('from', $event ?? '')"
      />
      <sge-text-field
        rotulo="Até"
        tipo="date"
        [obrigatorio]="true"
        [ngModel]="rascunho().to"
        (ngModelChange)="mudar('to', $event ?? '')"
      />

      @for (dimensao of dimensoesVisiveis(); track dimensao) {
        <sge-select-field
          [rotulo]="rotulo(dimensao)"
          [placeholder]="'Todos'"
          [opcoes]="opcoes()[dimensao] ?? []"
          [ngModel]="rascunho()[dimensao] || null"
          (ngModelChange)="mudar(dimensao, $event ?? '')"
        />
      }

      <div class="barra__acoes">
        <p-button
          label="Aplicar"
          icon="pi pi-filter"
          [disabled]="!!problema()"
          (onClick)="aplicar()"
        />
        @if (temRecorte()) {
          <p-button
            label="Limpar"
            severity="secondary"
            [text]="true"
            (onClick)="limpar()"
          />
        }
      </div>
    </section>

    @if (problema(); as texto) {
      <div class="espaco"><sge-alert tom="aviso" [titulo]="texto" /></div>
    }
  `,
  styles: `
    .barra {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 1rem;
      padding: 0.875rem;
    }
    .barra__acoes {
      display: flex;
      gap: 0.5rem;
      padding-bottom: 0.25rem;
    }
  `,
})
export class ReportFilterBar {
  private readonly store = inject(ReportFilterStore);
  private readonly permissoes = inject(PermissionsService);
  private readonly filiais = inject(BranchesApiService);
  private readonly configuracoes = inject(ConfigurationsApiService);
  private readonly bancos = inject(BankingApiService);
  private readonly parceiros = inject(PartnersApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** Edição local: o painel só recarrega quando o usuário aplica. */
  protected readonly rascunho = signal<FiltroRelatorio>({ ...this.store.filtro() });
  protected readonly opcoes = signal<Partial<Record<Dimensao, OpcaoFiltro[]>>>({});

  protected readonly problema = computed(() => problemaFiltro(this.rascunho()));
  protected readonly temRecorte = computed(() => dimensoesEmUso(this.rascunho()) > 0);

  protected readonly dimensoesVisiveis = computed(() =>
    DIMENSOES.filter((dimensao) => this.permissoes.pode(PERMISSAO_DIMENSAO[dimensao])),
  );

  constructor() {
    this.carregarOpcoes();
  }

  protected rotulo(dimensao: Dimensao): string {
    return ROTULO_DIMENSAO[dimensao];
  }

  protected mudar(campo: keyof FiltroRelatorio, valor: string): void {
    this.rascunho.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected aplicar(): void {
    if (this.problema()) return;
    this.store.aplicar({ ...this.rascunho() });
  }

  protected limpar(): void {
    this.store.limpar();
    this.rascunho.set({ ...this.store.filtro() });
  }

  private carregarOpcoes(): void {
    if (this.permissoes.pode(PERMISSAO_DIMENSAO.branchId)) {
      this.filiais
        .list({ pageSize: LIMITE_OPCOES, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (pagina) =>
            this.guardar(
              'branchId',
              pagina.data.map((item) => ({
                value: item.id,
                label: `${item.code} — ${item.name}`,
              })),
            ),
          error: () => this.guardar('branchId', []),
        });
    }

    if (this.permissoes.pode(PERMISSAO_DIMENSAO.categoryId)) {
      this.configuracoes
        .listCategories({ pageSize: LIMITE_OPCOES, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (pagina) =>
            this.guardar(
              'categoryId',
              pagina.data.map((item) => ({ value: item.id, label: item.name })),
            ),
          error: () => this.guardar('categoryId', []),
        });
    }

    if (this.permissoes.pode(PERMISSAO_DIMENSAO.costCenterId)) {
      this.configuracoes
        .listCostCenters({ pageSize: LIMITE_OPCOES, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (pagina) =>
            this.guardar(
              'costCenterId',
              pagina.data.map((item) => ({
                value: item.id,
                label: `${item.code} — ${item.name}`,
              })),
            ),
          error: () => this.guardar('costCenterId', []),
        });
    }

    if (this.permissoes.pode(PERMISSAO_DIMENSAO.bankAccountId)) {
      this.bancos
        .listAccounts({ pageSize: LIMITE_OPCOES, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (pagina) =>
            this.guardar(
              'bankAccountId',
              pagina.data.map((item) => ({
                value: item.id,
                label: `${item.description} — ag. ${item.agency} c. ${item.account}`,
              })),
            ),
          error: () => this.guardar('bankAccountId', []),
        });
    }

    if (this.permissoes.pode(PERMISSAO_DIMENSAO.partnerId)) {
      this.parceiros
        .list({ pageSize: LIMITE_OPCOES, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (pagina) =>
            this.guardar(
              'partnerId',
              pagina.data.map((item) => ({
                value: item.id,
                label: item.tradeName ?? item.legalName,
              })),
            ),
          error: () => this.guardar('partnerId', []),
        });
    }
  }

  private guardar(dimensao: Dimensao, lista: OpcaoFiltro[]): void {
    this.opcoes.update((atual) => ({ ...atual, [dimensao]: lista }));
  }
}
