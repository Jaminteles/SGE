import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';

import { ApprovalsApiService } from '../core/api/approvals-api.service';
import { FinanceApiService } from '../core/api/finance-api.service';
import type { ApprovalThreshold, EntryType, FinancialEntry } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { PermissionsService } from '../core/authz/permissions.service';
import { CompanyService } from '../core/company/company.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDateTime } from '../core/lib/format';
import { ListState, type Consulta } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type ValoresFiltro } from '../ui/filter-bar';
import { TextField } from '../ui/text-field';
import { comparar } from './dinheiro';
import { FILTRO_TIPO, ROTULO_TIPO, contraparte } from './rotulos';

/** Operação da alçada por carteira — `ENTRY_OPERATION` do backend (RF-012/RF-056). */
export const OPERACAO_TITULO: Record<EntryType, string> = {
  PAGAR: 'TITULO_PAGAR',
  RECEBER: 'TITULO_RECEBER',
};

/** A fila é sempre a dos pendentes: o filtro de aprovação não é do usuário aqui. */
function consultaFila(filtros: ValoresFiltro): Consulta {
  return { q: filtros.q, type: filtros['type'] || undefined, approvalStatus: 'PENDENTE' };
}

/** Faixa de alçada ativa em que o valor cai (min ≤ valor ≤ max; max nulo = sem teto). */
export function faixaDaAlcada(
  faixas: ApprovalThreshold[],
  tipo: EntryType,
  valor: string,
): ApprovalThreshold | null {
  return (
    faixas.find(
      (faixa) =>
        faixa.isActive &&
        faixa.operation === OPERACAO_TITULO[tipo] &&
        comparar(valor, faixa.minAmount) >= 0 &&
        (faixa.maxAmount === null || comparar(valor, faixa.maxAmount) <= 0),
    ) ?? null
  );
}

type Decisao = { tipo: 'aprovar' | 'reprovar'; titulo: FinancialEntry };

/**
 * Fila de aprovação de títulos por alçada (RF-056 — UI-027).
 *
 * A tela indica a faixa de alçada do valor e se o perfil ativo está entre os
 * que a atendem, mas **quem decide é o servidor**: ele confere a alçada
 * (RN-003), recusa a aprovação por quem lançou o título e grava a decisão na
 * auditoria. Os botões travados aqui só evitam oferecer o que a API negaria.
 */
@Component({
  selector: 'sge-approvals-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    Alert,
    DataTable,
    ErrorAlert,
    FilterBar,
    TextField,
  ],
  template: `
    <p class="crumb">Financeiro / Aprovações</p>

    <div class="pagehead">
      <div>
        <h1>Aprovação de títulos</h1>
        <p>Títulos acima da alçada aguardando decisão; a baixa fica bloqueada até lá (RF-056).</p>
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar por número ou descrição"
      [valores]="lista.filtros()"
      [filtros]="[filtroTipo]"
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
        mensagemVazia="Nenhum título aguardando aprovação."
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-titulo>
          <tr>
            <td>{{ titulo.number }}</td>
            <td>{{ tipo(titulo) }}</td>
            <td>{{ nomeContraparte(titulo) }}</td>
            <td>{{ titulo.description }}</td>
            <td class="numero">{{ moeda(titulo.netAmount) }}</td>
            <td>
              {{ alcada(titulo) }}
              @if (semAlcada(titulo)) {
                <span class="secundario aviso">seu perfil não atende esta faixa</span>
              }
            </td>
            <td>{{ dataHora(titulo.createdAt) }}</td>
            <td class="acoes">
              <p-button
                label="Abrir"
                severity="secondary"
                [text]="true"
                size="small"
                [routerLink]="['/financeiro/titulos', titulo.id]"
              />
              <p-button
                label="Aprovar"
                size="small"
                [disabled]="agindo() || proprio(titulo)"
                [title]="proprio(titulo) ? 'Quem lançou o título não pode aprová-lo' : ''"
                (onClick)="abrir('aprovar', titulo)"
              />
              <p-button
                label="Reprovar"
                severity="danger"
                [outlined]="true"
                size="small"
                [disabled]="agindo() || proprio(titulo)"
                (onClick)="abrir('reprovar', titulo)"
              />
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>

    <p-dialog
      [visible]="decisao() !== null"
      (visibleChange)="$event ? null : decisao.set(null)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      [header]="decisao()?.tipo === 'aprovar' ? 'Aprovar título' : 'Reprovar título'"
    >
      @if (erroDecisao(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      @if (decisao(); as atual) {
        <p class="nota">
          {{ atual.titulo.number }} · {{ nomeContraparte(atual.titulo) }} ·
          <strong>{{ moeda(atual.titulo.netAmount) }}</strong>
        </p>
      }
      <form class="grade-campos formulario" (ngSubmit)="decidir()">
        <sge-text-field
          [rotulo]="decisao()?.tipo === 'aprovar' ? 'Observação' : 'Motivo'"
          name="motivo"
          [obrigatorio]="decisao()?.tipo === 'reprovar'"
          [dica]="
            decisao()?.tipo === 'reprovar' ? 'Obrigatório: a decisão sem razão não é auditável' : ''
          "
          [ngModel]="motivo()"
          (ngModelChange)="motivo.set($event)"
        />
      </form>
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          (onClick)="decisao.set(null)"
        />
        <p-button
          [label]="decisao()?.tipo === 'aprovar' ? 'Aprovar' : 'Reprovar'"
          [severity]="decisao()?.tipo === 'aprovar' ? 'primary' : 'danger'"
          [loading]="agindo()"
          [disabled]="!podeDecidir()"
          (onClick)="decidir()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.75rem;
    }
    .numero {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .secundario {
      display: block;
      font-size: 0.7rem;
    }
    .aviso {
      color: var(--p-orange-600, #c2410c);
    }
  `,
})
export class ApprovalsPage {
  private readonly api = inject(FinanceApiService);
  private readonly alcadas = inject(ApprovalsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly auth = inject(AuthService);
  private readonly empresa = inject(CompanyService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly filtroTipo = FILTRO_TIPO;

  protected readonly colunas: Coluna[] = [
    { campo: 'number', cabecalho: 'Número', largura: '9rem' },
    { campo: 'type', cabecalho: 'Carteira', largura: '7rem' },
    { campo: 'partner', cabecalho: 'Contraparte', largura: '13rem' },
    { campo: 'description', cabecalho: 'Descrição' },
    { campo: 'netAmount', cabecalho: 'Valor', largura: '9rem' },
    { campo: 'threshold', cabecalho: 'Alçada', largura: '13rem' },
    { campo: 'createdAt', cabecalho: 'Lançado em', largura: '9rem' },
    { campo: 'acoes', cabecalho: '', largura: '17rem' },
  ];

  protected readonly lista = new ListState<FinancialEntry>(
    (consulta) => this.api.listEntries(consulta),
    consultaFila,
  );

  /** `null` = sem permissão para ler as alçadas; a coluna mostra só o aviso genérico. */
  private readonly faixas = signal<ApprovalThreshold[] | null>(null);
  protected readonly decisao = signal<Decisao | null>(null);
  protected readonly motivo = signal('');
  protected readonly agindo = signal(false);
  protected readonly erroDecisao = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  private readonly perfilAtivo = computed(() => this.empresa.ativa()?.role.id ?? null);

  protected readonly podeDecidir = computed(() => {
    const atual = this.decisao();
    if (!atual || this.agindo()) return false;
    return atual.tipo === 'aprovar' || this.motivo().trim().length >= 3;
  });

  constructor() {
    this.lista.carregar();
    if (this.permissoes.pode('approval-thresholds:READ')) {
      this.alcadas
        .list({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (r) => this.faixas.set(r.data), error: () => this.faixas.set(null) });
    }
  }

  protected tipo(titulo: FinancialEntry): string {
    return ROTULO_TIPO[titulo.type];
  }

  protected nomeContraparte(titulo: FinancialEntry): string {
    return contraparte(titulo);
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }

  /** Segregação de funções: quem lançou não decide (o servidor também recusa). */
  protected proprio(titulo: FinancialEntry): boolean {
    const usuario = this.auth.usuario();
    return !!titulo.createdById && titulo.createdById === usuario?.id;
  }

  protected alcada(titulo: FinancialEntry): string {
    const faixas = this.faixas();
    if (faixas === null) return 'Conferida pelo servidor';
    const faixa = faixaDaAlcada(faixas, titulo.type, titulo.netAmount);
    if (!faixa) return 'Sem faixa cadastrada';
    const perfis = faixa.requiredRoles.map((p) => p.name).join(', ');
    return `${faixa.name} · nível ${faixa.level}${perfis ? ' · ' + perfis : ''}`;
  }

  /** Aviso, não bloqueio: o super admin e regras de nível são decididos no servidor. */
  protected semAlcada(titulo: FinancialEntry): boolean {
    const faixas = this.faixas();
    const perfil = this.perfilAtivo();
    if (faixas === null || perfil === null || this.auth.superAdmin()) return false;
    const faixa = faixaDaAlcada(faixas, titulo.type, titulo.netAmount);
    return (
      !!faixa && faixa.requiredRoles.length > 0 && !faixa.requiredRoles.some((p) => p.id === perfil)
    );
  }

  protected abrir(tipo: 'aprovar' | 'reprovar', titulo: FinancialEntry): void {
    this.motivo.set('');
    this.erroDecisao.set(null);
    this.decisao.set({ tipo, titulo });
  }

  protected decidir(): void {
    const atual = this.decisao();
    if (!atual || !this.podeDecidir()) return;
    const motivo = this.motivo().trim();
    this.agindo.set(true);
    this.erroDecisao.set(null);

    const requisicao =
      atual.tipo === 'aprovar'
        ? this.api.approveEntry(atual.titulo.id, motivo || undefined)
        : this.api.rejectEntry(atual.titulo.id, motivo);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (titulo) => {
        this.agindo.set(false);
        this.decisao.set(null);
        this.aviso.set(
          `Título ${titulo.number} ${atual.tipo === 'aprovar' ? 'aprovado' : 'reprovado'}.`,
        );
        this.lista.carregar();
      },
      error: (falha: unknown) => {
        this.agindo.set(false);
        this.erroDecisao.set(falha);
      },
    });
  }
}
