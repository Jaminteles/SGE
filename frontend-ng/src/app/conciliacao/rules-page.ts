import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { BankingApiService } from '../core/api/banking-api.service';
import { ReconciliationApiService } from '../core/api/reconciliation-api.service';
import type {
  AutoReconciliationJob,
  CompanyBankAccount,
  ReconciliationRule,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { ListState, type Consulta } from '../core/lib/list-state';
import { OPCOES_SENTIDO, opcaoConta } from '../bancos/rotulos';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro, type ValoresFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  OPCOES_ACAO,
  formDeRegra,
  formRegraVazio,
  montarRegra,
  problemaExecucao,
  problemaRegra,
  resumoAcao,
  resumoCondicoes,
  type FormRegra,
} from './rotulos';

export const FILTRO_SITUACAO_REGRA: DefinicaoFiltro = {
  name: 'situacao',
  label: 'Situação',
  placeholder: 'Situação',
  options: [
    { value: 'true', label: 'Ativas' },
    { value: 'false', label: 'Inativas' },
  ],
};

export function consultaRegra(filtros: ValoresFiltro): Consulta {
  const situacao = filtros['situacao'] ?? '';
  return { q: filtros.q, isActive: situacao === '' ? undefined : situacao === 'true' };
}

/**
 * Regras de conciliação automática, prioridade e tolerâncias (RF-075 — UI-051).
 *
 * A lista vem na ordem em que o motor avalia: menor prioridade decide primeiro
 * e a primeira que casa encerra a avaliação. Regra não se apaga — desativar é
 * o que existe, porque ela explica conciliações já feitas (RF-077).
 *
 * A execução automática fica aqui porque é o que põe as regras para trabalhar:
 * sempre por conta e período, em fila, e com permissão própria (`:APPROVE`).
 */
@Component({
  selector: 'sge-rules-page',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
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
    <p class="crumb">Conciliação / Regras</p>

    <div class="pagehead">
      <div>
        <h1>Regras de conciliação</h1>
        <p>Critérios, prioridade e tolerâncias da conciliação automática (RF-075).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeExecutar()) {
          <p-button
            label="Executar conciliação automática"
            icon="pi pi-play"
            severity="secondary"
            [outlined]="true"
            (onClick)="abrirExecucao()"
          />
        }
        @if (podeCriar()) {
          <p-button label="Nova regra" icon="pi pi-plus" (onClick)="abrirNova()" />
        }
      </div>
    </div>

    @if (aviso(); as texto) {
      <sge-alert tom="sucesso" [titulo]="texto" [mensagem]="detalheAviso()" />
    }

    <div class="espaco">
      <sge-filter-bar
        placeholderBusca="Buscar pelo nome"
        [valores]="lista.filtros()"
        [filtros]="filtrosBarra"
        (mudou)="lista.aplicarFiltros($event)"
      />
    </div>

    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }
    @if (erroAcao(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    <section class="card table-card espaco">
      <sge-data-table
        [colunas]="colunas"
        [linhas]="lista.linhas()"
        [total]="lista.total()"
        [pagina]="lista.pagina()"
        [tamanhoPagina]="lista.tamanhoPagina()"
        [carregando]="lista.carregando()"
        mensagemVazia="Nenhuma regra de conciliação cadastrada."
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-regra>
          <tr>
            <td class="numero">{{ regra.priority }}</td>
            <td>{{ regra.name }}</td>
            <td>{{ condicoes(regra) }}</td>
            <td>{{ acao(regra) }}</td>
            <td>
              {{ regra.dayTolerance }} dia(s)
              <span class="secundario">± {{ moeda(regra.valueTolerance) }}</span>
            </td>
            <td>
              <p-tag
                [value]="regra.isActive ? 'Ativa' : 'Inativa'"
                [severity]="regra.isActive ? 'success' : 'secondary'"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              @if (podeEditar()) {
                <p-button label="Editar" severity="secondary" [text]="true" size="small" (onClick)="abrirEdicao(regra)" />
              }
              @if (podeDesativar() && regra.isActive) {
                <p-button
                  label="Desativar"
                  severity="danger"
                  [text]="true"
                  size="small"
                  [loading]="desativando() === regra.id"
                  [disabled]="!!desativando()"
                  (onClick)="desativar(regra)"
                />
              }
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>

    <p-dialog
      [visible]="editando()"
      (visibleChange)="editando.set($event)"
      [modal]="true"
      [style]="{ width: '46rem' }"
      [header]="regraId() ? 'Editar regra' : 'Nova regra'"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <div class="grade-campos">
        <sge-text-field rotulo="Nome" [obrigatorio]="true" [ngModel]="form().name" (ngModelChange)="mudar('name', $event ?? '')" />
        <sge-text-field
          rotulo="Prioridade"
          tipo="number"
          dica="Menor decide primeiro (1 a 1000)"
          [obrigatorio]="true"
          [ngModel]="form().priority"
          (ngModelChange)="mudar('priority', ($event ?? '').toString())"
        />
      </div>

      <h3 class="subtitulo">Condições — todas precisam casar</h3>
      <div class="grade-campos">
        <sge-select-field
          rotulo="Sentido"
          placeholder="Qualquer"
          [opcoes]="opcoesSentido"
          [ngModel]="form().direction"
          (ngModelChange)="mudar('direction', $event ?? '')"
        />
        @if (contas().length > 0) {
          <sge-select-field
            rotulo="Conta"
            placeholder="Qualquer"
            [opcoes]="opcoesConta()"
            [ngModel]="form().bankAccountId"
            (ngModelChange)="mudar('bankAccountId', $event ?? '')"
          />
        }
        <sge-text-field
          rotulo="Histórico contém"
          dica="Sem diferenciar acentuação"
          [ngModel]="form().descriptionContains"
          (ngModelChange)="mudar('descriptionContains', $event ?? '')"
        />
        <sge-text-field
          rotulo="Documento igual a"
          [ngModel]="form().documentEquals"
          (ngModelChange)="mudar('documentEquals', $event ?? '')"
        />
        <sge-text-field
          rotulo="CPF/CNPJ da contraparte"
          [ngModel]="form().counterpartDocument"
          (ngModelChange)="mudar('counterpartDocument', $event ?? '')"
        />
        <sge-decimal-field rotulo="Valor mínimo" [ngModel]="form().minAmount" (ngModelChange)="mudar('minAmount', $event)" />
        <sge-decimal-field rotulo="Valor máximo" [ngModel]="form().maxAmount" (ngModelChange)="mudar('maxAmount', $event)" />
      </div>

      <h3 class="subtitulo">Ação e tolerâncias</h3>
      <div class="grade-campos">
        <sge-select-field
          rotulo="Ação"
          [obrigatorio]="true"
          [opcoes]="opcoesAcao"
          [ngModel]="form().acao"
          (ngModelChange)="mudar('acao', $event ?? 'SUGERIR')"
        />
        @if (form().acao === 'CONCILIAR') {
          <sge-decimal-field
            rotulo="Confiança mínima (%)"
            dica="De 0 a 100"
            [obrigatorio]="true"
            [ngModel]="form().minScore"
            (ngModelChange)="mudar('minScore', $event)"
          />
        }
        <sge-text-field
          rotulo="Tolerância de dias"
          tipo="number"
          dica="0 a 60"
          [ngModel]="form().dayTolerance"
          (ngModelChange)="mudar('dayTolerance', ($event ?? '').toString())"
        />
        <sge-decimal-field
          rotulo="Tolerância de valor"
          [ngModel]="form().valueTolerance"
          (ngModelChange)="mudar('valueTolerance', $event)"
        />
      </div>
      <label class="ativa">
        <p-checkbox [binary]="true" [ngModel]="form().isActive" (ngModelChange)="mudar('isActive', $event)" />
        Regra ativa
      </label>

      @if (form().acao === 'CONCILIAR') {
        <sge-alert
          tom="aviso"
          titulo="Esta regra concilia sem revisão humana"
          mensagem="Correspondências com confiança abaixo do mínimo continuam só como sugestão."
        />
      }
      @if (problema(); as texto) {
        <p class="campo__erro">{{ texto }}</p>
      }

      <ng-template #footer>
        <p-button label="Voltar" severity="secondary" [outlined]="true" [disabled]="salvando()" (onClick)="editando.set(false)" />
        <p-button label="Salvar" icon="pi pi-check" [loading]="salvando()" [disabled]="salvando()" (onClick)="salvar()" />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="executando()"
      (visibleChange)="executando.set($event)"
      [modal]="true"
      [style]="{ width: '32rem' }"
      header="Executar conciliação automática"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <p class="secundario">
        As regras ativas são aplicadas em fila aos movimentos da conta no período. Acompanhe o
        processamento em Bancos / Operações assíncronas.
      </p>
      <div class="grade-campos">
        <sge-select-field
          rotulo="Conta"
          [obrigatorio]="true"
          [opcoes]="opcoesConta()"
          [ngModel]="execucao().conta"
          (ngModelChange)="mudarExecucao('conta', $event ?? '')"
        />
        <sge-text-field rotulo="De" tipo="date" [obrigatorio]="true" [ngModel]="execucao().de" (ngModelChange)="mudarExecucao('de', $event ?? '')" />
        <sge-text-field rotulo="Até" tipo="date" [obrigatorio]="true" [ngModel]="execucao().ate" (ngModelChange)="mudarExecucao('ate', $event ?? '')" />
      </div>
      @if (problemaDaExecucao(); as texto) {
        <p class="campo__erro">{{ texto }}</p>
      }
      <ng-template #footer>
        <p-button label="Voltar" severity="secondary" [outlined]="true" [disabled]="salvando()" (onClick)="executando.set(false)" />
        <p-button
          label="Enfileirar"
          icon="pi pi-play"
          [loading]="salvando()"
          [disabled]="salvando() || !!problemaDaExecucao()"
          (onClick)="executar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .numero {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .subtitulo {
      margin: 1rem 0 0.5rem;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--p-text-muted-color);
    }
    .ativa {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.75rem 0;
      font-size: 0.85rem;
    }
  `,
})
export class RulesPage {
  private readonly api = inject(ReconciliationApiService);
  private readonly bancos = inject(BankingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas: Coluna[] = [
    { campo: 'priority', cabecalho: 'Prioridade', largura: '6rem' },
    { campo: 'name', cabecalho: 'Nome', largura: '12rem' },
    { campo: 'conditions', cabecalho: 'Condições' },
    { campo: 'actions', cabecalho: 'Ação', largura: '12rem' },
    { campo: 'tolerance', cabecalho: 'Tolerância', largura: '8rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '6rem' },
    { campo: 'acoes', cabecalho: '', largura: '10rem' },
  ];

  protected readonly filtrosBarra = [FILTRO_SITUACAO_REGRA];
  protected readonly opcoesSentido = OPCOES_SENTIDO;
  protected readonly opcoesAcao = OPCOES_ACAO;

  protected readonly lista = new ListState<ReconciliationRule>(
    (consulta) => this.api.listRules(consulta),
    consultaRegra,
  );

  protected readonly contas = signal<CompanyBankAccount[]>([]);
  protected readonly aviso = signal<string | null>(null);
  protected readonly detalheAviso = signal('');
  protected readonly erroAcao = signal<unknown>(null);
  protected readonly erroDialogo = signal<unknown>(null);
  protected readonly desativando = signal<string | null>(null);
  protected readonly salvando = signal(false);

  protected readonly editando = signal(false);
  protected readonly regraId = signal<string | null>(null);
  protected readonly form = signal<FormRegra>(formRegraVazio());
  /** O problema só aparece depois da primeira tentativa de salvar. */
  protected readonly tentouSalvar = signal(false);

  protected readonly executando = signal(false);
  protected readonly execucao = signal({ conta: '', de: '', ate: '' });

  protected readonly opcoesConta = computed(() =>
    this.contas()
      .filter((c) => c.isActive)
      .map(opcaoConta),
  );

  protected readonly problema = computed(() =>
    this.tentouSalvar() ? problemaRegra(this.form()) : null,
  );
  protected readonly problemaDaExecucao = computed(() => problemaExecucao(this.execucao()));

  protected readonly podeCriar = () => this.permissoes.pode('reconciliation-rules:CREATE');
  protected readonly podeEditar = () => this.permissoes.pode('reconciliation-rules:UPDATE');
  protected readonly podeDesativar = () => this.permissoes.pode('reconciliation-rules:DELETE');
  /** Executar exige escolher a conta — e escolher exige ler as contas. */
  protected readonly podeExecutar = () =>
    this.permissoes.pode('reconciliation:APPROVE') && this.permissoes.pode('company-bank-accounts:READ');

  constructor() {
    this.lista.carregar();
    if (this.permissoes.pode('company-bank-accounts:READ')) {
      this.bancos
        .listAccounts({ pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (resultado) => this.contas.set(resultado.data),
          error: () => this.contas.set([]),
        });
    }
  }

  protected abrirNova(): void {
    this.abrirFormulario(null, formRegraVazio());
  }

  protected abrirEdicao(regra: ReconciliationRule): void {
    this.abrirFormulario(regra.id, formDeRegra(regra));
  }

  protected mudar<K extends keyof FormRegra>(campo: K, valor: FormRegra[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected salvar(): void {
    this.tentouSalvar.set(true);
    if (problemaRegra(this.form()) || this.salvando()) return;

    const corpo = montarRegra(this.form());
    const id = this.regraId();
    const requisicao = id ? this.api.updateRule(id, corpo) : this.api.createRule(corpo);

    this.salvando.set(true);
    this.erroDialogo.set(null);
    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (regra) => {
        this.salvando.set(false);
        this.editando.set(false);
        this.mostrarAviso(id ? `Regra "${regra.name}" alterada.` : `Regra "${regra.name}" cadastrada.`);
        this.lista.carregar();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroDialogo.set(falha);
      },
    });
  }

  protected desativar(regra: ReconciliationRule): void {
    if (this.desativando()) return;
    this.desativando.set(regra.id);
    this.erroAcao.set(null);

    this.api
      .deactivateRule(regra.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.desativando.set(null);
          this.mostrarAviso(`Regra "${regra.name}" desativada.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.desativando.set(null);
          this.erroAcao.set(falha);
        },
      });
  }

  protected abrirExecucao(): void {
    const padrao = this.contas().find((c) => c.isDefault && c.isActive);
    this.execucao.set({ conta: padrao?.id ?? '', de: '', ate: '' });
    this.erroDialogo.set(null);
    this.executando.set(true);
  }

  protected mudarExecucao(campo: 'conta' | 'de' | 'ate', valor: string): void {
    this.execucao.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected executar(): void {
    const dados = this.execucao();
    if (problemaExecucao(dados) || this.salvando()) return;

    this.salvando.set(true);
    this.erroDialogo.set(null);
    this.api
      .runAuto({ bankAccountId: dados.conta, from: dados.de, to: dados.ate })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (job: AutoReconciliationJob) => {
          this.salvando.set(false);
          this.executando.set(false);
          this.mostrarAviso(
            'Conciliação automática enfileirada.',
            `Job ${job.jobId}: acompanhe em Bancos / Operações assíncronas.`,
          );
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erroDialogo.set(falha);
        },
      });
  }

  protected condicoes(regra: ReconciliationRule): string {
    return resumoCondicoes(regra, (id) => this.contas().find((c) => c.id === id)?.description ?? 'específica');
  }

  protected acao(regra: ReconciliationRule): string {
    return resumoAcao(regra);
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  private abrirFormulario(id: string | null, form: FormRegra): void {
    this.regraId.set(id);
    this.form.set(form);
    this.tentouSalvar.set(false);
    this.erroDialogo.set(null);
    this.editando.set(true);
  }

  private mostrarAviso(titulo: string, detalhe = ''): void {
    this.aviso.set(titulo);
    this.detalheAviso.set(detalhe);
  }
}
