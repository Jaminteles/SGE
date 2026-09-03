import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { CompaniesApiService } from '../core/api/companies-api.service';
import type { Company, TaxRegime } from '../core/api/types';
import { formatCnpj } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar } from '../ui/filter-bar';
import { Alert } from '../ui/alert';
import { FILTRO_SITUACAO, consultaPadrao } from './filtros';

/** Rótulos dos regimes do enum `TaxRegime` do backend. */
const REGIMES: Record<TaxRegime, string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
  MEI: 'MEI',
  IMUNE_ISENTO: 'Imune / Isento',
};

/**
 * Empresas do grupo (RF-001 — UI-007).
 *
 * Rota de plataforma: `GET /companies` exige super admin e não é escopada pela
 * empresa ativa. O administrador de uma empresa usa a tela "Empresa"
 * (`companies/current`), que mostra só a dele.
 */
@Component({
  selector: 'sge-companies-page',
  imports: [RouterLink, ButtonModule, TagModule, Alert, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">Administração / Empresas</p>

    <div class="pagehead">
      <div>
        <h1>Empresas</h1>
        <p>Cadastro das empresas do grupo (RF-001).</p>
      </div>
      <div class="pagehead__actions">
        <p-button label="Nova empresa" icon="pi pi-plus" routerLink="nova" />
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar por razão social ou CNPJ"
      [valores]="lista.filtros()"
      [filtros]="[FILTRO_SITUACAO]"
      (mudou)="lista.aplicarFiltros($event)"
    />

    @if (lista.erro(); as erro) {
      <div class="espaco"><sge-error-alert [erro]="erro" /></div>
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
            ? 'Nenhuma empresa encontrada com esses filtros.'
            : 'Nenhuma empresa cadastrada.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-empresa>
          <tr>
            <td>
              <a [routerLink]="[empresa.id]">{{ empresa.legalName }}</a>
              @if (empresa.tradeName) {
                <span class="secundario">{{ empresa.tradeName }}</span>
              }
            </td>
            <td>{{ cnpj(empresa) }}</td>
            <td>{{ regime(empresa) }}</td>
            <td>
              <p-tag
                [value]="empresa.isActive ? 'Ativa' : 'Inativa'"
                [severity]="empresa.isActive ? 'success' : 'secondary'"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              <p-button
                [label]="empresa.isActive ? 'Inativar' : 'Ativar'"
                severity="secondary"
                [text]="true"
                size="small"
                [disabled]="salvandoId() === empresa.id"
                (onClick)="alternarSituacao(empresa)"
              />
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>
  `,
})
export class CompaniesPage {
  private readonly api = inject(CompaniesApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_SITUACAO = FILTRO_SITUACAO;

  protected readonly colunas: Coluna[] = [
    { campo: 'legalName', cabecalho: 'Razão social' },
    { campo: 'taxId', cabecalho: 'CNPJ', largura: '11rem' },
    { campo: 'taxRegime', cabecalho: 'Regime', largura: '11rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '7rem' },
  ];

  protected readonly lista = new ListState<Company>(
    (consulta) => this.api.list(consulta),
    consultaPadrao,
  );

  protected readonly salvandoId = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);

  constructor() {
    this.lista.carregar();
  }

  protected cnpj(empresa: Company): string {
    return formatCnpj(empresa.taxId) || '—';
  }

  protected regime(empresa: Company): string {
    return empresa.taxRegime ? REGIMES[empresa.taxRegime] : '—';
  }

  /** Ativa/inativa (RF-001). Recarrega a página para refletir o filtro em uso. */
  protected alternarSituacao(empresa: Company): void {
    this.salvandoId.set(empresa.id);
    this.aviso.set(null);
    this.api
      .setActive(empresa.id, !empresa.isActive)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.salvandoId.set(null);
          this.aviso.set(
            `Empresa ${empresa.legalName} ${empresa.isActive ? 'inativada' : 'ativada'}.`,
          );
          this.lista.carregar();
        },
        error: (erro: unknown) => {
          this.salvandoId.set(null);
          this.lista.erro.set(erro);
        },
      });
  }
}
