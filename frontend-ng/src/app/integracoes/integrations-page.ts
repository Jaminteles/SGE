import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { Observable } from 'rxjs';

import { BankingApiService } from '../core/api/banking-api.service';
import { IntegrationsApiService } from '../core/api/integrations-api.service';
import type { BankProvider, Integration, IntegrationCredential } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { ListState } from '../core/lib/list-state';
import { formatDateTime } from '../core/lib/format';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro, type OpcaoFiltro, type ValoresFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  type FormIntegracao,
  OPCOES_AMBIENTE,
  OPCOES_STATUS_INTEGRACAO,
  ROTULO_AMBIENTE,
  ROTULO_STATUS_INTEGRACAO,
  formIntegracaoDe,
  formIntegracaoVazio,
  montarEdicaoIntegracao,
  montarIntegracao,
  montarParametros,
  parametrosMudaram,
  problemaIntegracao,
  problemaSuspensao,
  severidadeStatus,
} from './rotulos';

const COLUNAS: Coluna[] = [
  { campo: 'code', cabecalho: 'Código', largura: '10rem' },
  { campo: 'name', cabecalho: 'Integração' },
  { campo: 'provider', cabecalho: 'Provedor', largura: '12rem' },
  { campo: 'environment', cabecalho: 'Ambiente', largura: '9rem' },
  { campo: 'status', cabecalho: 'Situação', largura: '9rem' },
  { campo: 'lastRunAt', cabecalho: 'Última execução', largura: '12rem' },
  { campo: 'acoes', cabecalho: '', largura: '16rem' },
];

const FILTROS: DefinicaoFiltro[] = [
  {
    name: 'status',
    label: 'Situação',
    options: OPCOES_STATUS_INTEGRACAO,
    placeholder: 'Todas as situações',
  },
  {
    name: 'environment',
    label: 'Ambiente',
    options: OPCOES_AMBIENTE,
    placeholder: 'Todos os ambientes',
  },
];

/**
 * Administração das integrações externas (RF-126/RF-127 — UI-074).
 *
 * **Segredo não passa por aqui.** Os parâmetros são a configuração não sensível
 * do provedor; chave com nome de credencial é recusada nesta tela, na API e no
 * banco. O segredo mora na credencial cifrada — cadastrada em Bancos — e nenhuma
 * rota o devolve: a tela mostra só o nome dela.
 *
 * Situação não é campo de formulário: ativar, suspender e retomar são ações
 * próprias, e a suspensão exige motivo, porque "por que isso parou" é a única
 * pergunta que sobra depois.
 */
@Component({
  selector: 'sge-integrations-page',
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
    <p class="crumb">Integrações / Provedores</p>

    <div class="pagehead">
      <div>
        <h1>Integrações</h1>
        <p>Provedores, credenciais e parâmetros de cada integração da empresa (RF-126/RF-127).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Nova integração" icon="pi pi-plus" (onClick)="abrirNova()" />
        }
      </div>
    </div>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }
    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (!podeLerCredenciais()) {
      <div class="espaco">
        <sge-alert
          tom="info"
          titulo="Sem acesso ao catálogo de provedores"
          mensagem="Escolher provedor e credencial exige a permissão de consultar credenciais de integração."
        />
      </div>
    }

    <div class="espaco">
      <sge-filter-bar
        [valores]="lista.filtros()"
        [filtros]="filtros"
        placeholderBusca="Buscar por código ou nome"
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
            ? 'Nenhuma integração para este filtro.'
            : 'Nenhuma integração cadastrada nesta empresa.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-item>
          <tr [class.linha--inativa]="!item.isActive">
            <td class="codigo">{{ item.code }}</td>
            <td>
              {{ item.name }}
              @if (item.suspensionReason) {
                <span class="secundario">Suspensa: {{ item.suspensionReason }}</span>
              }
            </td>
            <td>{{ item.provider.name }}</td>
            <td>{{ ambiente(item) }}</td>
            <td>
              <p-tag
                [value]="situacao(item)"
                [severity]="severidade(item)"
                [rounded]="true"
              />
              @if (item.failureStreak > 0) {
                <span class="secundario">
                  {{ item.failureStreak }}/{{ item.failureThreshold }} falhas seguidas
                </span>
              }
            </td>
            <td>{{ item.lastRunAt ? dataHora(item.lastRunAt) : 'nunca' }}</td>
            <td class="coluna-acoes">
              @if (podeEditar()) {
                <p-button
                  label="Editar"
                  size="small"
                  severity="secondary"
                  [text]="true"
                  (onClick)="abrirEdicao(item)"
                />
                @if (item.status === 'SUSPENSA') {
                  <p-button
                    label="Retomar"
                    size="small"
                    [text]="true"
                    [disabled]="!!agindo()"
                    [loading]="agindo() === item.id"
                    (onClick)="retomar(item)"
                  />
                } @else if (item.status === 'ATIVA') {
                  <p-button
                    label="Suspender"
                    size="small"
                    severity="warn"
                    [text]="true"
                    [disabled]="!!agindo()"
                    (onClick)="abrirSuspensao(item)"
                  />
                } @else {
                  <p-button
                    label="Ativar"
                    size="small"
                    [text]="true"
                    [disabled]="!!agindo()"
                    [loading]="agindo() === item.id"
                    (onClick)="ativar(item)"
                  />
                }
              }
              @if (podeDesativar() && item.isActive) {
                <p-button
                  label="Desativar"
                  size="small"
                  severity="danger"
                  [text]="true"
                  [disabled]="!!agindo()"
                  (onClick)="desativar(item)"
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
      [style]="{ width: '48rem' }"
      [header]="form().id ? 'Editar integração' : 'Nova integração'"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <div class="grade-campos">
        <sge-select-field
          rotulo="Provedor"
          [obrigatorio]="true"
          [opcoes]="opcoesProvedor()"
          [disabled]="!!form().id"
          [ngModel]="form().providerId || null"
          (ngModelChange)="mudar('providerId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Credencial"
          placeholder="Sem credencial"
          dica="Cadastrada cifrada em Bancos; o segredo nunca aparece aqui."
          [opcoes]="opcoesCredencial()"
          [ngModel]="form().credentialId || null"
          (ngModelChange)="mudar('credentialId', $event ?? '')"
        />
        <sge-text-field
          rotulo="Código"
          dica="Curto e estável — aparece no log. Letras, números, ponto, hífen e sublinhado."
          [obrigatorio]="true"
          [disabled]="!!form().id"
          [ngModel]="form().code"
          (ngModelChange)="mudar('code', $event ?? '')"
        />
        <sge-text-field
          rotulo="Nome"
          [obrigatorio]="true"
          [ngModel]="form().name"
          (ngModelChange)="mudar('name', $event ?? '')"
        />
        <sge-select-field
          rotulo="Ambiente"
          [obrigatorio]="true"
          [opcoes]="opcoesAmbiente"
          [ngModel]="form().environment"
          (ngModelChange)="mudar('environment', $event ?? 'PRODUCAO')"
        />
        <sge-text-field
          rotulo="Tempo limite (ms)"
          [obrigatorio]="true"
          [ngModel]="form().timeoutMs"
          (ngModelChange)="mudar('timeoutMs', $event ?? '')"
        />
        <sge-text-field
          rotulo="Tentativas"
          dica="Quantas vezes a fila repete antes de desistir."
          [obrigatorio]="true"
          [ngModel]="form().maxAttempts"
          (ngModelChange)="mudar('maxAttempts', $event ?? '')"
        />
        <sge-text-field
          rotulo="Limite de falhas seguidas"
          dica="Atingido o limite, a integração é suspensa sozinha."
          [obrigatorio]="true"
          [ngModel]="form().failureThreshold"
          (ngModelChange)="mudar('failureThreshold', $event ?? '')"
        />
        <sge-text-field
          rotulo="Observação"
          [ngModel]="form().note"
          (ngModelChange)="mudar('note', $event ?? '')"
        />
      </div>

      <h3 class="bloco__titulo">Parâmetros do provedor</h3>
      <p class="secundario">
        Configuração não sensível. Senha, token e chave de API são recusados aqui — eles são
        credencial cifrada, não parâmetro.
      </p>

      @for (par of form().parametros; track $index) {
        <div class="parametro">
          <sge-text-field
            rotulo="Chave"
            [ngModel]="par.chave"
            (ngModelChange)="mudarParametro($index, 'chave', $event ?? '')"
          />
          <sge-text-field
            rotulo="Valor"
            [ngModel]="par.valor"
            (ngModelChange)="mudarParametro($index, 'valor', $event ?? '')"
          />
          <p-button
            icon="pi pi-trash"
            severity="danger"
            [text]="true"
            ariaLabel="Remover parâmetro"
            (onClick)="removerParametro($index)"
          />
        </div>
      }
      <p-button
        label="Outro parâmetro"
        icon="pi pi-plus"
        size="small"
        severity="secondary"
        [text]="true"
        (onClick)="adicionarParametro()"
      />

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
      [visible]="!!suspendendo()"
      (visibleChange)="fecharSuspensao($event)"
      [modal]="true"
      [style]="{ width: '34rem' }"
      header="Suspender a integração"
    >
      <p class="secundario">
        Enquanto estiver suspensa, nada é enviado por ela. O motivo fica registrado e aparece na
        lista.
      </p>
      <sge-text-field
        rotulo="Motivo"
        [obrigatorio]="true"
        [ngModel]="motivo()"
        (ngModelChange)="motivo.set($event ?? '')"
      />
      @if (problemaMotivo(); as texto) {
        <p class="campo__erro">{{ texto }}</p>
      }

      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          [disabled]="salvando()"
          (onClick)="fecharSuspensao(false)"
        />
        <p-button
          label="Suspender"
          severity="warn"
          [loading]="salvando()"
          [disabled]="salvando() || !!problemaMotivo()"
          (onClick)="suspender()"
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
      .codigo {
        font-variant-numeric: tabular-nums;
      }
      .linha--inativa {
        color: var(--p-text-muted-color);
      }
      .secundario {
        display: block;
        font-size: 0.72rem;
        color: var(--p-text-muted-color);
      }
      .bloco__titulo {
        margin: 1rem 0 0.25rem;
        font-size: 0.82rem;
        font-weight: 600;
        color: var(--p-text-muted-color);
      }
      .parametro {
        display: flex;
        align-items: end;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }
      .parametro sge-text-field {
        flex: 1;
      }
    `,
  ],
})
export class IntegrationsPage {
  private readonly api = inject(IntegrationsApiService);
  private readonly bancos = inject(BankingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas = COLUNAS;
  protected readonly filtros = FILTROS;
  protected readonly opcoesAmbiente = OPCOES_AMBIENTE;
  protected readonly dataHora = formatDateTime;

  protected readonly lista = new ListState<Integration>(
    (consulta) => this.api.list(consulta),
    (filtros) => ({
      q: filtros.q,
      status: filtros['status'] || undefined,
      environment: filtros['environment'] || undefined,
    }),
  );

  protected readonly aviso = signal<string | null>(null);
  protected readonly agindo = signal<string | null>(null);
  protected readonly editando = signal(false);
  protected readonly salvando = signal(false);
  protected readonly erroDialogo = signal<unknown>(null);
  protected readonly form = signal<FormIntegracao>(formIntegracaoVazio());
  private readonly original = signal<Integration | null>(null);

  protected readonly suspendendo = signal<Integration | null>(null);
  protected readonly motivo = signal('');

  private readonly provedores = signal<BankProvider[]>([]);
  private readonly credenciais = signal<IntegrationCredential[]>([]);

  protected readonly problema = computed(() => problemaIntegracao(this.form()));
  protected readonly problemaMotivo = computed(() => problemaSuspensao(this.motivo()));

  protected readonly opcoesProvedor = computed<OpcaoFiltro[]>(() =>
    this.provedores().map((item) => ({ value: item.id, label: `${item.code} — ${item.name}` })),
  );

  /** Só credencial do mesmo provedor: o backend recusa as demais. */
  protected readonly opcoesCredencial = computed<OpcaoFiltro[]>(() => {
    const provedor = this.form().providerId;
    return this.credenciais()
      .filter((item) => !provedor || item.provider.id === provedor)
      .map((item) => ({ value: item.id, label: `${item.name} (${item.environment})` }));
  });

  protected readonly podeCriar = () => this.permissoes.pode('integrations:CREATE');
  protected readonly podeEditar = () => this.permissoes.pode('integrations:UPDATE');
  protected readonly podeDesativar = () => this.permissoes.pode('integrations:DELETE');
  protected readonly podeLerCredenciais = () =>
    this.permissoes.pode('integration-credentials:READ');

  constructor() {
    this.lista.carregar();
    if (this.podeLerCredenciais()) {
      this.bancos
        .listProviders()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (lista) => this.provedores.set(lista),
          error: () => this.provedores.set([]),
        });
      this.bancos
        .listCredentials()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (lista) => this.credenciais.set(lista),
          error: () => this.credenciais.set([]),
        });
    }
  }

  protected ambiente(item: Integration): string {
    return ROTULO_AMBIENTE[item.environment];
  }

  protected situacao(item: Integration): string {
    return ROTULO_STATUS_INTEGRACAO[item.status];
  }

  protected severidade(item: Integration) {
    return severidadeStatus(item.status);
  }

  protected aplicar(valores: ValoresFiltro): void {
    this.lista.aplicarFiltros(valores);
  }

  protected abrirNova(): void {
    this.original.set(null);
    this.form.set(formIntegracaoVazio());
    this.erroDialogo.set(null);
    this.editando.set(true);
  }

  protected abrirEdicao(item: Integration): void {
    this.original.set(item);
    this.form.set(formIntegracaoDe(item));
    this.erroDialogo.set(null);
    this.editando.set(true);
  }

  protected mudar<K extends keyof FormIntegracao>(campo: K, valor: FormIntegracao[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarParametro(indice: number, campo: 'chave' | 'valor', valor: string): void {
    this.form.update((atual) => ({
      ...atual,
      parametros: atual.parametros.map((par, posicao) =>
        posicao === indice ? { ...par, [campo]: valor } : par,
      ),
    }));
  }

  protected adicionarParametro(): void {
    this.form.update((atual) => ({
      ...atual,
      parametros: [...atual.parametros, { chave: '', valor: '' }],
    }));
  }

  protected removerParametro(indice: number): void {
    this.form.update((atual) => ({
      ...atual,
      parametros: atual.parametros.filter((_, posicao) => posicao !== indice),
    }));
  }

  /**
   * Criar manda tudo de uma vez; editar separa em duas chamadas porque a API
   * substitui o conjunto inteiro de parâmetros numa rota própria — e só é
   * chamada quando os pares realmente mudaram.
   */
  protected salvar(): void {
    if (this.salvando() || this.problema()) return;
    const form = this.form();
    const atual = this.original();

    this.salvando.set(true);
    this.erroDialogo.set(null);

    if (!atual) {
      this.api
        .create(montarIntegracao(form))
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.concluir('Integração cadastrada.'),
          error: (falha: unknown) => this.falhar(falha),
        });
      return;
    }

    this.api
      .update(atual.id, montarEdicaoIntegracao(form, atual))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (!parametrosMudaram(form, atual)) {
            this.concluir('Integração atualizada.');
            return;
          }
          this.api
            .setParameters(atual.id, montarParametros(form.parametros))
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: () => this.concluir('Integração e parâmetros atualizados.'),
              error: (falha: unknown) => this.falhar(falha),
            });
        },
        error: (falha: unknown) => this.falhar(falha),
      });
  }

  protected ativar(item: Integration): void {
    this.executar(item, this.api.activate(item.id), `${item.code} ativada.`);
  }

  protected retomar(item: Integration): void {
    this.executar(item, this.api.resume(item.id), `${item.code} retomada.`);
  }

  protected abrirSuspensao(item: Integration): void {
    this.motivo.set('');
    this.suspendendo.set(item);
  }

  protected fecharSuspensao(aberto: boolean): void {
    if (!aberto) this.suspendendo.set(null);
  }

  protected suspender(): void {
    const item = this.suspendendo();
    if (!item || this.salvando() || this.problemaMotivo()) return;

    this.salvando.set(true);
    this.api
      .suspend(item.id, this.motivo().trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.suspendendo.set(null);
          this.aviso.set(`${item.code} suspensa. Nada é enviado por ela até ser retomada.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.lista.erro.set(falha);
        },
      });
  }

  /** Desativa sem remover: o histórico de chamadas continua respondendo. */
  protected desativar(item: Integration): void {
    this.executar(
      item,
      this.api.deactivate(item.id),
      `${item.code} desativada. O histórico permanece.`,
    );
  }

  private executar(item: Integration, requisicao: Observable<unknown>, texto: string): void {
    if (this.agindo()) return;
    this.agindo.set(item.id);
    requisicao
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.agindo.set(null);
          this.aviso.set(texto);
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.agindo.set(null);
          this.lista.erro.set(falha);
        },
      });
  }

  private concluir(texto: string): void {
    this.salvando.set(false);
    this.editando.set(false);
    this.aviso.set(texto);
    this.lista.carregar();
  }

  private falhar(falha: unknown): void {
    this.salvando.set(false);
    this.erroDialogo.set(falha);
  }
}
