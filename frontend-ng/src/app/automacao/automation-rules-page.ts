import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { NotificationsApiService } from '../core/api/notifications-api.service';
import type {
  AutomationRule,
  AutomationRuleRun,
  AutomationTrigger,
  NotificationChannel,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { ListState } from '../core/lib/list-state';
import { formatDateTime } from '../core/lib/format';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro, type ValoresFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  DESCRICAO_GATILHO,
  type FormAcao,
  type FormRegraAutomacao,
  OPCOES_CANAL,
  OPCOES_GATILHO,
  ROTULO_GATILHO,
  acaoVazia,
  aceitaCondicoes,
  formRegraDe,
  formRegraVazia,
  montarEdicaoRegra,
  montarRegra,
  problemaRegra,
  resumoAcoes,
  resumoCondicoes,
  rotuloExecucao,
  severidadeExecucao,
} from './rotulos';

const COLUNAS: Coluna[] = [
  { campo: 'name', cabecalho: 'Regra' },
  { campo: 'triggerEvent', cabecalho: 'Gatilho', largura: '14rem' },
  { campo: 'conditions', cabecalho: 'Condições' },
  { campo: 'actions', cabecalho: 'Destinatários' },
  { campo: 'lastRunAt', cabecalho: 'Última varredura', largura: '12rem' },
  { campo: 'acoes', cabecalho: '', largura: '14rem' },
];

const FILTROS: DefinicaoFiltro[] = [
  {
    name: 'triggerEvent',
    label: 'Gatilho',
    options: OPCOES_GATILHO,
    placeholder: 'Todos os gatilhos',
  },
];

const OPCOES_SENTIDO_TITULO = [
  { value: 'PAGAR', label: 'Só contas a pagar' },
  { value: 'RECEBER', label: 'Só contas a receber' },
];

const OPCOES_PRIORIDADE = [
  { value: '1', label: '1 — Urgente' },
  { value: '2', label: '2 — Alta' },
  { value: '3', label: '3 — Normal' },
  { value: '4', label: '4 — Baixa' },
  { value: '5', label: '5 — Informativo' },
];

/**
 * Editor de regras de automação (RF-125 — UI-067).
 *
 * Três decisões do módulo que a tela torna visíveis:
 *
 *  - **a única ação é notificar**. Não há ação que prorrogue parcela, cancele
 *    ordem ou concilie movimento: uma regra que agisse sobre o financeiro
 *    transformaria erro de configuração em dinheiro movimentado, sem ninguém no
 *    caminho. A decisão continua humana;
 *  - **o destinatário é endereçado por permissão**, no formato `recurso:AÇÃO` —
 *    é o endereçamento que acompanha o RBAC: quem pode aprovar é quem precisa
 *    saber, mesmo depois de a equipe mudar;
 *  - **desativar é o botão, apagar não existe** para quem só edita. Uma regra
 *    desligada é rastro do que parou de avisar; uma regra apagada não é.
 */
@Component({
  selector: 'sge-automation-rules-page',
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
    <p class="crumb">Automação / Regras</p>

    <div class="pagehead">
      <div>
        <h1>Regras de automação</h1>
        <p>Gatilho, condições, destinatários e o histórico de cada varredura (RF-125).</p>
      </div>
      <div class="pagehead__actions">
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
          lista.temFiltro()
            ? 'Nenhuma regra para este filtro.'
            : 'Nenhuma regra de automação cadastrada.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-regra>
          <tr [class.linha--inativa]="!regra.isActive">
            <td>
              {{ regra.name }}
              @if (!regra.isActive) {
                <p-tag value="Desativada" severity="secondary" [rounded]="true" />
              }
            </td>
            <td>{{ gatilho(regra) }}</td>
            <td>{{ condicoes(regra) }}</td>
            <td>{{ destinatarios(regra) }}</td>
            <td>{{ regra.lastRunAt ? dataHora(regra.lastRunAt) : 'nunca' }}</td>
            <td class="coluna-acoes">
              <p-button
                label="Execuções"
                size="small"
                severity="secondary"
                [text]="true"
                (onClick)="abrirHistorico(regra)"
              />
              @if (podeEditar()) {
                <p-button
                  label="Editar"
                  size="small"
                  severity="secondary"
                  [text]="true"
                  (onClick)="abrirEdicao(regra)"
                />
              }
              @if (podeDesativar() && regra.isActive) {
                <p-button
                  label="Desativar"
                  size="small"
                  severity="danger"
                  [text]="true"
                  [disabled]="!!desativando()"
                  [loading]="desativando() === regra.id"
                  (onClick)="desativar(regra)"
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
      [header]="form().id ? 'Editar regra de automação' : 'Nova regra de automação'"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <div class="grade-campos">
        <sge-text-field
          rotulo="Nome"
          [obrigatorio]="true"
          [ngModel]="form().name"
          (ngModelChange)="mudar('name', $event ?? '')"
        />
        <sge-select-field
          rotulo="Gatilho"
          [obrigatorio]="true"
          [opcoes]="opcoesGatilho"
          [ngModel]="form().triggerEvent"
          (ngModelChange)="mudarGatilho($event ?? 'TITULO_VENCENDO')"
        />
        <sge-text-field
          rotulo="Descrição"
          [ngModel]="form().description"
          (ngModelChange)="mudar('description', $event ?? '')"
        />
      </div>

      <p class="secundario">{{ descricaoGatilho() }}</p>

      @if (temCondicoes()) {
        <h3 class="bloco__titulo">Condições</h3>
        <div class="grade-campos">
          <sge-text-field
            rotulo="Antecedência (dias)"
            dica="De 0 a 90. Em branco: o padrão do sistema."
            [ngModel]="form().daysAhead"
            (ngModelChange)="mudar('daysAhead', $event ?? '')"
          />
          <sge-text-field
            rotulo="Valor mínimo"
            dica="Ignora o que estiver abaixo deste valor."
            [ngModel]="form().minAmount"
            (ngModelChange)="mudar('minAmount', $event ?? '')"
          />
          <sge-select-field
            rotulo="Sentido do título"
            placeholder="A pagar e a receber"
            [opcoes]="opcoesSentido"
            [ngModel]="form().entryType || null"
            (ngModelChange)="mudar('entryType', $event ?? '')"
          />
        </div>
        <label class="marcador">
          <p-checkbox
            [binary]="true"
            [ngModel]="form().includeOverdue"
            (ngModelChange)="mudar('includeOverdue', $event)"
          />
          Incluir o que já venceu, além do que vai vencer
        </label>
      }

      <h3 class="bloco__titulo">Quem é avisado</h3>
      @for (acao of form().acoes; track $index) {
        <div class="acao">
          <sge-select-field
            rotulo="Canal"
            [obrigatorio]="true"
            [opcoes]="opcoesCanal"
            [ngModel]="acao.channel"
            (ngModelChange)="mudarAcao($index, 'channel', $event ?? 'INTERNO')"
          />
          <sge-text-field
            rotulo="Permissão do destinatário"
            dica="Formato recurso:AÇÃO, como financial-entries:READ."
            [obrigatorio]="true"
            [ngModel]="acao.permission"
            (ngModelChange)="mudarAcao($index, 'permission', $event ?? '')"
          />
          <sge-select-field
            rotulo="Prioridade"
            [obrigatorio]="true"
            [opcoes]="opcoesPrioridade"
            [ngModel]="acao.priority"
            (ngModelChange)="mudarAcao($index, 'priority', $event ?? '3')"
          />
          @if (form().acoes.length > 1) {
            <p-button
              icon="pi pi-trash"
              severity="danger"
              [text]="true"
              ariaLabel="Remover destinatário"
              (onClick)="removerAcao($index)"
            />
          }
        </div>
      }
      <p-button
        label="Outro destinatário"
        icon="pi pi-plus"
        size="small"
        severity="secondary"
        [text]="true"
        (onClick)="adicionarAcao()"
      />

      <p class="secundario">
        A regra só notifica: não prorroga parcela, não cancela ordem e não concilia movimento. A
        decisão continua humana.
      </p>

      <label class="marcador">
        <p-checkbox
          [binary]="true"
          [ngModel]="form().isActive"
          (ngModelChange)="mudar('isActive', $event)"
        />
        Regra ativa
      </label>

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
      [visible]="!!historico()"
      (visibleChange)="fecharHistorico($event)"
      [modal]="true"
      [style]="{ width: '44rem' }"
      [header]="'Execuções de ' + (historico()?.name ?? '')"
    >
      @if (erroHistorico(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <div class="tabela-rolagem">
        <table class="tabela">
          <thead>
            <tr>
              <th>Executada em</th>
              <th>Situação</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            @for (execucao of execucoes(); track execucao.id) {
              <tr>
                <td>{{ dataHora(execucao.executedAt) }}</td>
                <td>
                  <p-tag
                    [value]="rotuloStatus(execucao)"
                    [severity]="severidadeStatus(execucao)"
                    [rounded]="true"
                  />
                </td>
                <td>{{ resultado(execucao) }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="3" class="vazio">
                  @if (carregandoHistorico()) {
                    Carregando…
                  } @else {
                    A regra ainda não foi executada por nenhuma varredura.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <ng-template #footer>
        <p-button
          label="Fechar"
          severity="secondary"
          [outlined]="true"
          (onClick)="fecharHistorico(false)"
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
      .acao {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }
      .acao sge-text-field {
        flex: 1;
        min-width: 14rem;
      }
      .marcador {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: 0.75rem;
        font-size: 0.85rem;
      }
      p-tag {
        margin-left: 0.35rem;
      }
    `,
  ],
})
export class AutomationRulesPage {
  private readonly api = inject(NotificationsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas = COLUNAS;
  protected readonly filtros = FILTROS;
  protected readonly opcoesGatilho = OPCOES_GATILHO;
  protected readonly opcoesCanal = OPCOES_CANAL;
  protected readonly opcoesSentido = OPCOES_SENTIDO_TITULO;
  protected readonly opcoesPrioridade = OPCOES_PRIORIDADE;
  protected readonly dataHora = formatDateTime;
  protected readonly condicoes = resumoCondicoes;
  protected readonly destinatarios = resumoAcoes;

  protected readonly lista = new ListState<AutomationRule>(
    (consulta) => this.api.listRules(consulta),
    (filtros) => ({ q: filtros.q, triggerEvent: filtros['triggerEvent'] || undefined }),
  );

  protected readonly aviso = signal<string | null>(null);
  protected readonly editando = signal(false);
  protected readonly salvando = signal(false);
  protected readonly desativando = signal<string | null>(null);
  protected readonly erroDialogo = signal<unknown>(null);
  protected readonly form = signal<FormRegraAutomacao>(formRegraVazia());
  private readonly original = signal<AutomationRule | null>(null);

  protected readonly historico = signal<AutomationRule | null>(null);
  protected readonly execucoes = signal<AutomationRuleRun[]>([]);
  protected readonly carregandoHistorico = signal(false);
  protected readonly erroHistorico = signal<unknown>(null);

  protected readonly problema = computed(() => problemaRegra(this.form()));
  protected readonly temCondicoes = computed(() => aceitaCondicoes(this.form().triggerEvent));
  protected readonly descricaoGatilho = computed(
    () => DESCRICAO_GATILHO[this.form().triggerEvent],
  );

  protected readonly podeCriar = () => this.permissoes.pode('automation-rules:CREATE');
  protected readonly podeEditar = () => this.permissoes.pode('automation-rules:UPDATE');
  protected readonly podeDesativar = () => this.permissoes.pode('automation-rules:DELETE');

  constructor() {
    this.lista.carregar();
  }

  protected gatilho(regra: AutomationRule): string {
    return ROTULO_GATILHO[regra.triggerEvent];
  }

  protected rotuloStatus(execucao: AutomationRuleRun): string {
    return rotuloExecucao(execucao.status);
  }

  protected severidadeStatus(execucao: AutomationRuleRun) {
    return severidadeExecucao(execucao.status);
  }

  /** O resultado é `jsonb` do motor: exibido como texto, nunca interpretado. */
  protected resultado(execucao: AutomationRuleRun): string {
    if (execucao.error) return execucao.error;
    if (!execucao.result) return '—';
    return Object.entries(execucao.result)
      .map(([chave, valor]) => `${chave}: ${String(valor)}`)
      .join(' · ');
  }

  protected aplicar(valores: ValoresFiltro): void {
    this.lista.aplicarFiltros(valores);
  }

  protected abrirNova(): void {
    this.original.set(null);
    this.form.set(formRegraVazia());
    this.erroDialogo.set(null);
    this.editando.set(true);
  }

  protected abrirEdicao(regra: AutomationRule): void {
    this.original.set(regra);
    this.form.set(formRegraDe(regra));
    this.erroDialogo.set(null);
    this.editando.set(true);
  }

  protected mudar<K extends keyof FormRegraAutomacao>(
    campo: K,
    valor: FormRegraAutomacao[K],
  ): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  /** Trocar o gatilho descarta condição que o novo gatilho não entende. */
  protected mudarGatilho(gatilho: AutomationTrigger): void {
    this.form.update((atual) => ({
      ...atual,
      triggerEvent: gatilho,
      ...(aceitaCondicoes(gatilho) ? {} : { daysAhead: '', minAmount: '', entryType: '' as const }),
    }));
  }

  protected mudarAcao(indice: number, campo: keyof FormAcao, valor: string): void {
    this.form.update((atual) => ({
      ...atual,
      acoes: atual.acoes.map((acao, posicao) =>
        posicao === indice
          ? { ...acao, [campo]: campo === 'channel' ? (valor as NotificationChannel) : valor }
          : acao,
      ),
    }));
  }

  protected adicionarAcao(): void {
    this.form.update((atual) => ({ ...atual, acoes: [...atual.acoes, acaoVazia()] }));
  }

  protected removerAcao(indice: number): void {
    this.form.update((atual) => ({
      ...atual,
      acoes: atual.acoes.filter((_, posicao) => posicao !== indice),
    }));
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
        this.aviso.set(atual ? 'Regra atualizada.' : 'Regra cadastrada.');
        this.lista.carregar();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroDialogo.set(falha);
      },
    });
  }

  /** Desativa, não apaga: o histórico de execuções continua respondendo. */
  protected desativar(regra: AutomationRule): void {
    if (this.desativando()) return;
    this.desativando.set(regra.id);
    this.api
      .deleteRule(regra.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.desativando.set(null);
          this.aviso.set(`${regra.name} desativada: os avisos deste gatilho param.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.desativando.set(null);
          this.lista.erro.set(falha);
        },
      });
  }

  protected abrirHistorico(regra: AutomationRule): void {
    this.historico.set(regra);
    this.execucoes.set([]);
    this.erroHistorico.set(null);
    this.carregandoHistorico.set(true);
    this.api
      .runs(regra.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (linhas) => {
          this.execucoes.set(linhas);
          this.carregandoHistorico.set(false);
        },
        error: (falha: unknown) => {
          this.erroHistorico.set(falha);
          this.carregandoHistorico.set(false);
        },
      });
  }

  protected fecharHistorico(aberto: boolean): void {
    if (!aberto) this.historico.set(null);
  }
}
