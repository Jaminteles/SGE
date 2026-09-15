import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { of } from 'rxjs';

import { FiscalApiService } from '../core/api/fiscal-api.service';
import type {
  TaxClassification,
  TaxOperationType,
  TaxRule,
  TaxRuleResolution,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { ListState } from '../core/lib/list-state';
import { formatDate } from '../core/lib/format';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { hoje } from '../financeiro/dinheiro';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro, type OpcaoFiltro, type ValoresFiltro } from '../ui/filter-bar';
import { SearchSelect } from '../ui/search-select';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  type FormRegra,
  OPCOES_OPERACAO,
  formRegraDe,
  formRegraVazia,
  formatarPercentual,
  montarEdicaoRegra,
  montarRegra,
  problemaRegra,
  resumoCriterios,
} from './tributos';

const COLUNAS: Coluna[] = [
  { campo: 'priority', cabecalho: 'Prioridade', numerica: true, largura: '6rem' },
  { campo: 'name', cabecalho: 'Regra' },
  { campo: 'criterios', cabecalho: 'Critérios' },
  { campo: 'cfop', cabecalho: 'Determina', largura: '12rem' },
  { campo: 'effectiveFrom', cabecalho: 'Vigência', largura: '12rem' },
  { campo: 'acoes', cabecalho: '', largura: '10rem' },
];

const FILTROS: DefinicaoFiltro[] = [
  {
    name: 'operationType',
    label: 'Operação',
    options: OPCOES_OPERACAO,
    placeholder: 'Todas as operações',
  },
];

/**
 * Regras fiscais por operação e produto (RF-091 — UI-062).
 *
 * Duas coisas governam a tela:
 *
 *  - **regra sem critério decide tudo**. A resolução ordena por prioridade, e
 *    uma regra sem critério casa com toda operação da empresa — por isso o
 *    formulário exige ao menos um, antes mesmo do backend (bd/18 §5);
 *  - **a simulação não grava nada**. "Qual regra decide esta operação" é
 *    consulta: nenhuma nota é alterada e nenhum tributo declarado é reescrito.
 */
@Component({
  selector: 'sge-tax-rules-page',
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    TagModule,
    Alert,
    DataTable,
    ErrorAlert,
    FilterBar,
    SearchSelect,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Fiscal / Regras</p>

    <div class="pagehead">
      <div>
        <h1>Regras fiscais</h1>
        <p>Tributação decidida por operação, UF, classificação e produto (RF-091).</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Simular"
          icon="pi pi-play"
          severity="secondary"
          [outlined]="true"
          (onClick)="abrirSimulacao()"
        />
        @if (podeCriar()) {
          <p-button label="Nova regra" icon="pi pi-plus" (onClick)="abrirNova()" />
        }
      </div>
    </div>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }
    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    <div class="espaco">
      <sge-filter-bar
        [valores]="lista.filtros()"
        [filtros]="filtros"
        placeholderBusca="Buscar pelo nome da regra"
        (mudou)="aplicar($event)"
      />
    </div>

    <div class="card espaco">
      <sge-data-table
        [colunas]="colunas"
        [linhas]="lista.linhas()"
        [total]="lista.total()"
        [pagina]="lista.pagina()"
        [tamanhoPagina]="lista.tamanhoPagina()"
        [carregando]="lista.carregando()"
        [mensagemVazia]="
          lista.temFiltro() ? 'Nenhuma regra para este filtro.' : 'Nenhuma regra fiscal cadastrada.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-item>
          <tr [class.linha--inativa]="!item.isActive">
            <td class="coluna--numerica">{{ item.priority }}</td>
            <td>
              {{ item.name }}
              @if (!item.isActive) {
                <p-tag value="Inativa" severity="secondary" [rounded]="true" />
              }
            </td>
            <td>{{ criterios(item) }}</td>
            <td>{{ determina(item) }}</td>
            <td>
              {{ formatarData(item.effectiveFrom) }} —
              {{ item.effectiveTo ? formatarData(item.effectiveTo) : 'indeterminado' }}
            </td>
            <td class="coluna-acoes">
              @if (podeEditar()) {
                <p-button
                  label="Editar"
                  size="small"
                  severity="secondary"
                  [text]="true"
                  (onClick)="abrirEdicao(item)"
                />
              }
              @if (podeInativar() && item.isActive) {
                <p-button
                  label="Inativar"
                  size="small"
                  severity="danger"
                  [text]="true"
                  [disabled]="!!inativando()"
                  [loading]="inativando() === item.id"
                  (onClick)="inativar(item)"
                />
              }
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </div>

    <p-dialog
      [visible]="editando()"
      (visibleChange)="editando.set($event)"
      [modal]="true"
      [style]="{ width: '46rem' }"
      [header]="form().id ? 'Editar regra fiscal' : 'Nova regra fiscal'"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <h3 class="bloco__titulo">Identificação</h3>
      <div class="grade-campos">
        <sge-text-field
          rotulo="Nome"
          [obrigatorio]="true"
          [ngModel]="form().name"
          (ngModelChange)="mudar('name', $event ?? '')"
        />
        <sge-text-field
          rotulo="Prioridade"
          dica="De 1 a 999 — o menor número decide primeiro."
          [obrigatorio]="true"
          [ngModel]="form().priority"
          (ngModelChange)="mudar('priority', $event ?? '')"
        />
      </div>

      <h3 class="bloco__titulo">Critérios — quando a regra se aplica</h3>
      <div class="grade-campos">
        <sge-select-field
          rotulo="Operação"
          placeholder="Qualquer operação"
          [opcoes]="opcoesOperacao"
          [ngModel]="form().operationType || null"
          (ngModelChange)="mudar('operationType', $event ?? '')"
        />
        <sge-search-select
          rotulo="Classificação fiscal"
          placeholder="Qualquer classificação"
          [buscar]="buscarClassificacao"
          [resolver]="resolverClassificacao"
          [ngModel]="form().classificationId || null"
          (ngModelChange)="mudar('classificationId', $event ?? '')"
        />
        <sge-text-field
          rotulo="UF de origem"
          dica="Duas letras, como SP."
          [ngModel]="form().originState"
          (ngModelChange)="mudar('originState', $event ?? '')"
        />
        <sge-text-field
          rotulo="UF de destino"
          [ngModel]="form().destinationState"
          (ngModelChange)="mudar('destinationState', $event ?? '')"
        />
      </div>

      <h3 class="bloco__titulo">Efeito — o que a regra determina</h3>
      <div class="grade-campos">
        <sge-text-field
          rotulo="CFOP"
          dica="4 dígitos começando entre 1 e 7."
          [ngModel]="form().cfop"
          (ngModelChange)="mudar('cfop', $event ?? '')"
        />
        <sge-text-field
          rotulo="CST de ICMS"
          [ngModel]="form().icmsCst"
          (ngModelChange)="mudar('icmsCst', $event ?? '')"
        />
        <sge-text-field
          rotulo="Alíquota de ICMS (%)"
          [ngModel]="form().icmsRate"
          (ngModelChange)="mudar('icmsRate', $event ?? '')"
        />
        <sge-text-field
          rotulo="Redução da base (%)"
          [ngModel]="form().icmsBaseReduction"
          (ngModelChange)="mudar('icmsBaseReduction', $event ?? '')"
        />
        <sge-text-field
          rotulo="Início da vigência"
          tipo="date"
          [ngModel]="form().effectiveFrom"
          (ngModelChange)="mudar('effectiveFrom', $event ?? '')"
        />
        <sge-text-field
          rotulo="Fim da vigência"
          tipo="date"
          dica="Em branco: vigente por prazo indeterminado."
          [ngModel]="form().effectiveTo"
          (ngModelChange)="mudar('effectiveTo', $event ?? '')"
        />
      </div>

      @if (problema(); as texto) {
        <p class="campo__erro">{{ texto }}</p>
      }

      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          [disabled]="salvando()"
          (onClick)="editando.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando() || !!problema()"
          (onClick)="salvar()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="simulando()"
      (visibleChange)="simulando.set($event)"
      [modal]="true"
      [style]="{ width: '40rem' }"
      header="Simular a resolução da regra"
    >
      <p class="secundario">
        Consulta apenas: nenhuma nota é alterada e nenhum tributo declarado é reescrito.
      </p>

      <div class="grade-campos">
        <sge-select-field
          rotulo="Operação"
          placeholder="Não informada"
          [opcoes]="opcoesOperacao"
          [ngModel]="simulacao().operationType || null"
          (ngModelChange)="mudarSimulacao('operationType', $event ?? '')"
        />
        <sge-search-select
          rotulo="Classificação fiscal"
          placeholder="Não informada"
          [buscar]="buscarClassificacao"
          [resolver]="resolverClassificacao"
          [ngModel]="simulacao().classificationId || null"
          (ngModelChange)="mudarSimulacao('classificationId', $event ?? '')"
        />
        <sge-text-field
          rotulo="UF de origem"
          [ngModel]="simulacao().originState"
          (ngModelChange)="mudarSimulacao('originState', $event ?? '')"
        />
        <sge-text-field
          rotulo="UF de destino"
          [ngModel]="simulacao().destinationState"
          (ngModelChange)="mudarSimulacao('destinationState', $event ?? '')"
        />
        <sge-text-field
          rotulo="Data da operação"
          tipo="date"
          [ngModel]="simulacao().onDate"
          (ngModelChange)="mudarSimulacao('onDate', $event ?? '')"
        />
      </div>

      @if (erroSimulacao(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }

      @if (resultado(); as resolucao) {
        <div class="espaco">
          @if (resolucao.matched; as escolhida) {
            <sge-alert
              tom="sucesso"
              [titulo]="'Decide: ' + escolhida.name"
              [mensagem]="
                'Prioridade ' +
                escolhida.priority +
                ' · CFOP ' +
                (escolhida.cfop ?? '—') +
                ' · ICMS ' +
                percentual(escolhida.icmsRate)
              "
            />
            @if (resolucao.alternatives.length > 0) {
              <p class="secundario">
                Outras {{ resolucao.alternatives.length }} regra(s) casam com esta operação e
                perderam pela prioridade ou pela especificidade.
              </p>
            }
          } @else {
            <sge-alert
              tom="aviso"
              titulo="Nenhuma regra decide esta operação"
              mensagem="A nota seguirá com o que o emitente declarou, sem conferência contra o cadastro."
            />
          }
        </div>
      }

      <ng-template #footer>
        <p-button
          label="Fechar"
          severity="secondary"
          [outlined]="true"
          (onClick)="simulando.set(false)"
        />
        <p-button
          label="Simular"
          icon="pi pi-play"
          [loading]="resolvendo()"
          [disabled]="resolvendo()"
          (onClick)="simular()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    ESTILO_TABELA,
    `
      .coluna-acoes {
        white-space: nowrap;
        text-align: right;
      }
      .linha--inativa {
        color: var(--p-text-muted-color);
      }
      .bloco__titulo {
        margin: 1rem 0 0.5rem;
        font-size: 0.82rem;
        font-weight: 600;
        color: var(--p-text-muted-color);
      }
      p-tag {
        margin-left: 0.35rem;
      }
    `,
  ],
})
export class TaxRulesPage {
  private readonly api = inject(FiscalApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas = COLUNAS;
  protected readonly filtros = FILTROS;
  protected readonly opcoesOperacao = OPCOES_OPERACAO;
  protected readonly formatarData = formatDate;
  protected readonly percentual = formatarPercentual;

  private readonly referencia = hoje();

  protected readonly lista = new ListState<TaxRule>(
    (consulta) => this.api.listRules(consulta),
    (filtros) => ({ q: filtros.q, operationType: filtros['operationType'] || undefined }),
  );

  protected readonly aviso = signal<string | null>(null);
  protected readonly editando = signal(false);
  protected readonly salvando = signal(false);
  protected readonly inativando = signal<string | null>(null);
  protected readonly erroDialogo = signal<unknown>(null);
  protected readonly form = signal<FormRegra>(formRegraVazia(this.referencia));
  private readonly original = signal<TaxRule | null>(null);

  protected readonly simulando = signal(false);
  protected readonly resolvendo = signal(false);
  protected readonly erroSimulacao = signal<unknown>(null);
  protected readonly resultado = signal<TaxRuleResolution | null>(null);
  protected readonly simulacao = signal<{
    operationType: TaxOperationType | '';
    classificationId: string;
    originState: string;
    destinationState: string;
    onDate: string;
  }>({
    operationType: '',
    classificationId: '',
    originState: '',
    destinationState: '',
    onDate: this.referencia,
  });

  private readonly classificacoes = signal<TaxClassification[]>([]);

  protected readonly problema = computed(() => problemaRegra(this.form()));

  protected readonly podeCriar = () => this.permissoes.pode('tax-rules:CREATE');
  protected readonly podeEditar = () => this.permissoes.pode('tax-rules:UPDATE');
  protected readonly podeInativar = () => this.permissoes.pode('tax-rules:DELETE');

  /**
   * O catálogo de classificações é carregado uma vez e filtrado na memória: são
   * dezenas de linhas por empresa, e a busca por digitação num campo de diálogo
   * não justifica uma requisição por tecla.
   */
  protected readonly buscarClassificacao = (termo: string) => {
    const busca = termo.trim().toLowerCase();
    const opcoes = this.classificacoes()
      .filter(
        (item) =>
          busca === '' ||
          item.code.toLowerCase().includes(busca) ||
          item.description.toLowerCase().includes(busca),
      )
      .slice(0, 20)
      .map(this.opcaoClassificacao);
    return of(opcoes);
  };

  protected readonly resolverClassificacao = (id: string) => {
    const item = this.classificacoes().find((linha) => linha.id === id);
    return of(item ? this.opcaoClassificacao(item) : { value: id, label: id });
  };

  constructor() {
    this.lista.carregar();
    if (this.permissoes.pode('tax-classifications:READ')) {
      this.api
        .listClassifications({ pageSize: 200 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (pagina) => this.classificacoes.set(pagina.data),
          error: () => this.classificacoes.set([]),
        });
    }
  }

  protected criterios(item: TaxRule): string {
    const classificacao = this.classificacoes().find(
      (linha) => linha.id === item.classificationId,
    );
    return resumoCriterios(
      item,
      classificacao ? `${classificacao.type} ${classificacao.code}` : undefined,
    );
  }

  protected determina(item: TaxRule): string {
    const partes = [
      item.cfop ? `CFOP ${item.cfop}` : null,
      item.icmsCst ? `CST ${item.icmsCst}` : null,
      item.icmsRate ? `ICMS ${formatarPercentual(item.icmsRate)}` : null,
    ].filter(Boolean);
    return partes.length > 0 ? partes.join(' · ') : '—';
  }

  protected aplicar(valores: ValoresFiltro): void {
    this.lista.aplicarFiltros(valores);
  }

  protected abrirNova(): void {
    this.original.set(null);
    this.form.set(formRegraVazia(this.referencia));
    this.erroDialogo.set(null);
    this.editando.set(true);
  }

  protected abrirEdicao(item: TaxRule): void {
    this.original.set(item);
    this.form.set(formRegraDe(item));
    this.erroDialogo.set(null);
    this.editando.set(true);
  }

  protected mudar<K extends keyof FormRegra>(campo: K, valor: FormRegra[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected salvar(): void {
    if (this.salvando() || this.problema()) return;
    const form = this.form();
    const atual = this.original();

    this.salvando.set(true);
    this.erroDialogo.set(null);

    const requisicao = atual
      ? this.api.updateRule(atual.id, montarEdicaoRegra(form, atual))
      : this.api.createRule(montarRegra(form));

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvando.set(false);
        this.editando.set(false);
        this.aviso.set(atual ? 'Regra fiscal atualizada.' : 'Regra fiscal cadastrada.');
        this.lista.carregar();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroDialogo.set(falha);
      },
    });
  }

  protected inativar(item: TaxRule): void {
    if (this.inativando()) return;
    this.inativando.set(item.id);
    this.api
      .deleteRule(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.inativando.set(null);
          this.aviso.set(`${item.name} inativada: as operações voltam à regra seguinte.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.inativando.set(null);
          this.lista.erro.set(falha);
        },
      });
  }

  protected abrirSimulacao(): void {
    this.resultado.set(null);
    this.erroSimulacao.set(null);
    this.simulando.set(true);
  }

  protected mudarSimulacao(campo: string, valor: string): void {
    this.simulacao.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected simular(): void {
    if (this.resolvendo()) return;
    const atual = this.simulacao();

    this.resolvendo.set(true);
    this.erroSimulacao.set(null);
    this.api
      .resolveRule({
        ...(atual.operationType ? { operationType: atual.operationType } : {}),
        ...(atual.originState ? { originState: atual.originState.toUpperCase() } : {}),
        ...(atual.destinationState
          ? { destinationState: atual.destinationState.toUpperCase() }
          : {}),
        ...(atual.classificationId ? { classificationId: atual.classificationId } : {}),
        ...(atual.onDate ? { onDate: atual.onDate } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resolucao) => {
          this.resolvendo.set(false);
          this.resultado.set(resolucao);
        },
        error: (falha: unknown) => {
          this.resolvendo.set(false);
          this.resultado.set(null);
          this.erroSimulacao.set(falha);
        },
      });
  }

  private readonly opcaoClassificacao = (item: TaxClassification): OpcaoFiltro => ({
    value: item.id,
    label: `${item.type} ${item.code} — ${item.description}`,
  });
}
