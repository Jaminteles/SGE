import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { CashFlowApiService } from '../core/api/cash-flow-api.service';
import type {
  CashProjection,
  CashProjectionInput,
  CashScenario,
  CashScenarioInput,
  EntryType,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { ConfirmService } from '../ui/confirm.service';
import { DataTable, type Coluna } from '../ui/data-table';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { adicionarDias, dataValida, diasEntre, hoje, paraCentavos } from './dinheiro';
import { OPCOES_TIPO, ROTULO_TIPO } from './rotulos';

interface FormCenario {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  openingBalance: string | null;
  entradas: string;
  saidas: string;
  isBaseline: boolean;
}

interface FormProjecao {
  referenceDate: string;
  type: EntryType;
  amount: string | null;
  description: string;
}

/**
 * Premissa percentual (-100 a 100, até 2 casas). O backend a valida como
 * número (`IsNumber`) porque é hipótese de planejamento, não valor monetário.
 */
function premissa(texto: string): { valor?: number; erro?: string } {
  const limpo = texto.trim().replace(',', '.');
  if (limpo === '') return {};
  if (!/^-?\d{1,3}(\.\d{1,2})?$/.test(limpo)) return { erro: 'Use um percentual com até 2 casas.' };
  const valor = Number(limpo);
  if (valor < -100 || valor > 100) return { erro: 'A premissa vai de -100% a 100%.' };
  return { valor };
}

function cenarioVazio(): FormCenario {
  return {
    name: '',
    description: '',
    startDate: hoje(),
    endDate: adicionarDias(hoje(), 90),
    openingBalance: null,
    entradas: '',
    saidas: '',
    isBaseline: false,
  };
}

/**
 * Cenários e projeções manuais (RF-104 — UI-029).
 *
 * Cenário é uma pergunta ("e se as vendas caírem 10%?") feita sobre a mesma
 * carteira real: criar ou apagar um cenário não muda número nenhum do
 * financeiro. As projeções digitadas aqui são sempre PREVISTAS, com valor
 * positivo — a direção vem do tipo.
 */
@Component({
  selector: 'sge-scenarios-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
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
    <p class="crumb">Financeiro / Cenários</p>

    <div class="pagehead">
      <div>
        <h1>Cenários de caixa</h1>
        <p>Premissas e movimentos hipotéticos sobre a carteira real (RF-104).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Novo cenário" icon="pi pi-plus" (onClick)="abrirCenario(null)" />
        }
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar cenário"
      [valores]="lista.filtros()"
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
        mensagemVazia="Nenhum cenário criado."
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-cenario>
          <tr [class.selecionado]="selecionado()?.id === cenario.id">
            <td>
              {{ cenario.name }}
              @if (cenario.isBaseline) {
                <p-tag value="Base" severity="info" [rounded]="true" />
              }
            </td>
            <td>{{ data(cenario.startDate) }} a {{ data(cenario.endDate) }}</td>
            <td class="numero">
              {{ cenario.openingBalance ? moeda(cenario.openingBalance) : 'saldo atual' }}
            </td>
            <td>{{ premissas(cenario) }}</td>
            <td class="acoes">
              <p-button
                label="Projeções"
                severity="secondary"
                [text]="true"
                size="small"
                (onClick)="selecionar(cenario)"
              />
              <p-button
                label="Ver fluxo"
                severity="secondary"
                [text]="true"
                size="small"
                routerLink="/financeiro/fluxo-caixa"
                [queryParams]="{ cenario: cenario.id }"
              />
              @if (podeEditar()) {
                <p-button
                  label="Editar"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  (onClick)="abrirCenario(cenario)"
                />
              }
              @if (podeExcluir()) {
                <p-button
                  label="Excluir"
                  severity="danger"
                  [text]="true"
                  size="small"
                  (onClick)="abrirExclusao(cenario)"
                />
              }
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>

    @if (selecionado(); as cenario) {
      <section class="card table-card espaco">
        <div class="table-card__head">
          <h2 class="secao__titulo">Projeções manuais · {{ cenario.name }}</h2>
          @if (podeCriar()) {
            <p-button
              label="Nova projeção"
              icon="pi pi-plus"
              size="small"
              (onClick)="abrirProjecao()"
            />
          }
        </div>
        @if (erroProjecoes(); as falha) {
          <sge-error-alert [erro]="falha" />
        }
        @if (projecoes().length === 0) {
          <p class="nota">Nenhum movimento hipotético neste cenário.</p>
        } @else {
          <table class="grade">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Tipo</th>
                <th scope="col">Descrição</th>
                <th scope="col" class="numero">Valor</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              @for (projecao of projecoes(); track projecao.id) {
                <tr>
                  <td>{{ data(projecao.referenceDate) }}</td>
                  <td>{{ tipo(projecao.type) }}</td>
                  <td>{{ projecao.description ?? '—' }}</td>
                  <td class="numero" [class.negativo]="projecao.type === 'PAGAR'">
                    {{ projecao.type === 'PAGAR' ? '-' : '+' }}{{ moeda(projecao.amount) }}
                  </td>
                  <td class="acoes">
                    @if (podeExcluir()) {
                      <p-button
                        icon="pi pi-trash"
                        severity="danger"
                        [text]="true"
                        size="small"
                        ariaLabel="Remover projeção"
                        [disabled]="salvando()"
                        (onClick)="removerProjecao(projecao)"
                      />
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }

    <p-dialog
      [visible]="cenarioAberto()"
      (visibleChange)="cenarioAberto.set($event)"
      [modal]="true"
      [style]="{ width: '40rem' }"
      [header]="emEdicao() ? 'Editar cenário' : 'Novo cenário'"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <form class="grade-campos formulario" (ngSubmit)="salvarCenario()">
        <sge-text-field
          rotulo="Nome"
          name="name"
          [obrigatorio]="true"
          [ngModel]="form().name"
          (ngModelChange)="mudar('name', $event)"
        />
        <sge-text-field
          rotulo="Descrição"
          name="description"
          [ngModel]="form().description"
          (ngModelChange)="mudar('description', $event)"
        />
        <sge-text-field
          rotulo="Início"
          name="startDate"
          tipo="date"
          [obrigatorio]="true"
          [ngModel]="form().startDate"
          (ngModelChange)="mudar('startDate', $event)"
        />
        <sge-text-field
          rotulo="Fim"
          name="endDate"
          tipo="date"
          [obrigatorio]="true"
          [ngModel]="form().endDate"
          (ngModelChange)="mudar('endDate', $event)"
        />
        <sge-decimal-field
          rotulo="Caixa inicial"
          name="openingBalance"
          dica="Vazio = saldo atual das contas ativas"
          [ngModel]="form().openingBalance"
          (ngModelChange)="mudar('openingBalance', $event)"
        />
        <sge-text-field
          rotulo="Variação das entradas (%)"
          name="entradas"
          dica="Aplica-se ao previsto e ao vencido"
          [erro]="premissa(form().entradas).erro ?? null"
          [ngModel]="form().entradas"
          (ngModelChange)="mudar('entradas', $event)"
        />
        <sge-text-field
          rotulo="Variação das saídas (%)"
          name="saidas"
          [erro]="premissa(form().saidas).erro ?? null"
          [ngModel]="form().saidas"
          (ngModelChange)="mudar('saidas', $event)"
        />
        <label class="marcador">
          <input
            type="checkbox"
            name="isBaseline"
            [ngModel]="form().isBaseline"
            (ngModelChange)="mudar('isBaseline', $event)"
          />
          Cenário base (o anterior deixa de ser)
        </label>
      </form>
      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="cenarioAberto.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando() || !cenarioValido()"
          (onClick)="salvarCenario()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="projecaoAberta()"
      (visibleChange)="projecaoAberta.set($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      header="Nova projeção"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <form class="grade-campos formulario" (ngSubmit)="salvarProjecao()">
        <sge-text-field
          rotulo="Data"
          name="referenceDate"
          tipo="date"
          dica="Dentro da janela do cenário"
          [obrigatorio]="true"
          [ngModel]="formProjecao().referenceDate"
          (ngModelChange)="mudarProjecao('referenceDate', $event)"
        />
        <sge-select-field
          rotulo="Tipo"
          name="type"
          [opcoes]="opcoesTipo"
          [obrigatorio]="true"
          [ngModel]="formProjecao().type"
          (ngModelChange)="mudarProjecao('type', $event === 'RECEBER' ? 'RECEBER' : 'PAGAR')"
        />
        <sge-decimal-field
          rotulo="Valor"
          name="amount"
          dica="Sempre positivo — a direção vem do tipo"
          [obrigatorio]="true"
          [ngModel]="formProjecao().amount"
          (ngModelChange)="mudarProjecao('amount', $event)"
        />
        <sge-text-field
          rotulo="Descrição"
          name="descricaoProjecao"
          [ngModel]="formProjecao().description"
          (ngModelChange)="mudarProjecao('description', $event)"
        />
      </form>
      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="projecaoAberta.set(false)"
        />
        <p-button
          label="Adicionar"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando() || !projecaoValida()"
          (onClick)="salvarProjecao()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="exclusao() !== null"
      (visibleChange)="$event ? null : exclusao.set(null)"
      [modal]="true"
      [style]="{ width: '32rem' }"
      header="Excluir cenário"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <p>
        Excluir <strong>{{ exclusao()?.name }}</strong
        >? O financeiro real não muda; somente as premissas e projeções do cenário são descartadas.
      </p>
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          (onClick)="exclusao.set(null)"
        />
        <p-button
          label="Excluir"
          severity="danger"
          [loading]="salvando()"
          [disabled]="salvando()"
          (onClick)="excluir()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.75rem;
    }
    .grade {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .grade th,
    .grade td {
      padding: 0.5rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .numero {
      text-align: right !important;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .negativo {
      color: var(--p-red-500, #dc2626);
    }
    .selecionado td {
      background: var(--p-highlight-background, transparent);
    }
    .marcador {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      grid-column: 1 / -1;
    }
  `,
})
export class ScenariosPage {
  private readonly api = inject(CashFlowApiService);
  private readonly confirmacao = inject(ConfirmService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly opcoesTipo = OPCOES_TIPO;
  protected readonly premissa = premissa;

  protected readonly colunas: Coluna[] = [
    { campo: 'name', cabecalho: 'Cenário' },
    { campo: 'window', cabecalho: 'Janela', largura: '14rem' },
    { campo: 'openingBalance', cabecalho: 'Caixa inicial', largura: '9rem' },
    { campo: 'assumptions', cabecalho: 'Premissas', largura: '14rem' },
    { campo: 'acoes', cabecalho: '', largura: '22rem' },
  ];

  protected readonly lista = new ListState<CashScenario>((consulta) =>
    this.api.listScenarios(consulta),
  );

  protected readonly selecionado = signal<CashScenario | null>(null);
  protected readonly projecoes = signal<CashProjection[]>([]);
  protected readonly erroProjecoes = signal<unknown>(null);

  protected readonly cenarioAberto = signal(false);
  protected readonly emEdicao = signal<CashScenario | null>(null);
  protected readonly form = signal<FormCenario>(cenarioVazio());

  protected readonly projecaoAberta = signal(false);
  protected readonly formProjecao = signal<FormProjecao>({
    referenceDate: hoje(),
    type: 'RECEBER',
    amount: null,
    description: '',
  });

  protected readonly exclusao = signal<CashScenario | null>(null);
  protected readonly salvando = signal(false);
  protected readonly erroForm = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly podeCriar = () => this.permissoes.pode('cash-flow-scenarios:CREATE');
  protected readonly podeEditar = () => this.permissoes.pode('cash-flow-scenarios:UPDATE');
  protected readonly podeExcluir = () => this.permissoes.pode('cash-flow-scenarios:DELETE');

  protected readonly cenarioValido = computed(() => {
    const form = this.form();
    return (
      form.name.trim() !== '' &&
      dataValida(form.startDate) &&
      dataValida(form.endDate) &&
      diasEntre(form.startDate, form.endDate) >= 0 &&
      premissa(form.entradas).erro === undefined &&
      premissa(form.saidas).erro === undefined
    );
  });

  protected readonly projecaoValida = computed(() => {
    const form = this.formProjecao();
    const cenario = this.selecionado();
    if (!cenario || !dataValida(form.referenceDate)) return false;
    const dentro =
      diasEntre(cenario.startDate, form.referenceDate) >= 0 &&
      diasEntre(form.referenceDate, cenario.endDate) >= 0;
    return dentro && paraCentavos(form.amount) > 0n;
  });

  constructor() {
    this.lista.carregar();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected tipo(tipo: EntryType): string {
    return ROTULO_TIPO[tipo];
  }

  protected premissas(cenario: CashScenario): string {
    const partes: string[] = [];
    const entradas = cenario.assumptions?.entradas_percentual;
    const saidas = cenario.assumptions?.saidas_percentual;
    if (entradas !== undefined) partes.push(`entradas ${entradas > 0 ? '+' : ''}${entradas}%`);
    if (saidas !== undefined) partes.push(`saídas ${saidas > 0 ? '+' : ''}${saidas}%`);
    return partes.length > 0 ? partes.join(' · ') : 'sem premissas';
  }

  protected mudar<K extends keyof FormCenario>(campo: K, valor: FormCenario[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarProjecao<K extends keyof FormProjecao>(campo: K, valor: FormProjecao[K]): void {
    this.formProjecao.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrirCenario(cenario: CashScenario | null): void {
    this.emEdicao.set(cenario);
    this.form.set(
      cenario
        ? {
            name: cenario.name,
            description: cenario.description ?? '',
            startDate: cenario.startDate.slice(0, 10),
            endDate: cenario.endDate.slice(0, 10),
            openingBalance: cenario.openingBalance,
            entradas: cenario.assumptions?.entradas_percentual?.toString() ?? '',
            saidas: cenario.assumptions?.saidas_percentual?.toString() ?? '',
            isBaseline: cenario.isBaseline,
          }
        : cenarioVazio(),
    );
    this.erroForm.set(null);
    this.cenarioAberto.set(true);
  }

  protected salvarCenario(): void {
    if (this.salvando() || !this.cenarioValido()) return;
    const form = this.form();
    const entradas = premissa(form.entradas).valor;
    const saidas = premissa(form.saidas).valor;
    const dto: CashScenarioInput = {
      name: form.name.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      isBaseline: form.isBaseline,
      assumptions: {
        ...(entradas !== undefined ? { entradas_percentual: entradas } : {}),
        ...(saidas !== undefined ? { saidas_percentual: saidas } : {}),
      },
      ...(form.description.trim() !== '' ? { description: form.description.trim() } : {}),
      ...(form.openingBalance !== null ? { openingBalance: form.openingBalance } : {}),
    };

    const atual = this.emEdicao();
    this.salvando.set(true);
    this.erroForm.set(null);
    (atual ? this.api.updateScenario(atual.id, dto) : this.api.createScenario(dto))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cenario) => {
          this.salvando.set(false);
          this.cenarioAberto.set(false);
          this.aviso.set(`Cenário ${cenario.name} salvo.`);
          if (this.selecionado()?.id === cenario.id) this.selecionado.set(cenario);
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erroForm.set(falha);
        },
      });
  }

  protected abrirExclusao(cenario: CashScenario): void {
    this.erroForm.set(null);
    this.exclusao.set(cenario);
  }

  protected async excluir(): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Excluir cenário de fluxo de caixa?',
      mensagem:
        'O cenário e as projeções lançadas nele saem do comparativo. A ação não pode ser desfeita.',
      rotuloConfirmar: 'Excluir',
      destrutivo: true,
    });
    if (!confirmado) return;

    const cenario = this.exclusao();
    if (!cenario || this.salvando()) return;
    this.salvando.set(true);
    this.api
      .removeScenario(cenario.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.exclusao.set(null);
          if (this.selecionado()?.id === cenario.id) this.selecionado.set(null);
          this.aviso.set(`Cenário ${cenario.name} excluído.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erroForm.set(falha);
        },
      });
  }

  protected selecionar(cenario: CashScenario): void {
    this.selecionado.set(cenario);
    this.carregarProjecoes(cenario.id);
  }

  protected abrirProjecao(): void {
    const cenario = this.selecionado();
    if (!cenario) return;
    this.formProjecao.set({
      referenceDate: cenario.startDate.slice(0, 10),
      type: 'RECEBER',
      amount: null,
      description: '',
    });
    this.erroForm.set(null);
    this.projecaoAberta.set(true);
  }

  protected salvarProjecao(): void {
    const cenario = this.selecionado();
    if (!cenario || this.salvando() || !this.projecaoValida()) return;
    const form = this.formProjecao();
    const dto: CashProjectionInput = {
      referenceDate: form.referenceDate,
      type: form.type,
      amount: form.amount ?? '0',
      ...(form.description.trim() !== '' ? { description: form.description.trim() } : {}),
    };
    this.salvando.set(true);
    this.erroForm.set(null);
    this.api
      .createProjection(cenario.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.projecaoAberta.set(false);
          this.carregarProjecoes(cenario.id);
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erroForm.set(falha);
        },
      });
  }

  protected async removerProjecao(projecao: CashProjection): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Remover projeção do cenário?',
      mensagem: 'A projeção sai do cenário e deixa de compor a curva projetada.',
      rotuloConfirmar: 'Remover',
      destrutivo: true,
    });
    if (!confirmado) return;

    const cenario = this.selecionado();
    if (!cenario || this.salvando()) return;
    this.salvando.set(true);
    this.api
      .removeProjection(cenario.id, projecao.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.carregarProjecoes(cenario.id);
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erroProjecoes.set(falha);
        },
      });
  }

  private carregarProjecoes(cenarioId: string): void {
    this.erroProjecoes.set(null);
    this.api
      .listProjections(cenarioId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (lista) => this.projecoes.set(lista),
        error: (falha: unknown) => {
          this.projecoes.set([]);
          this.erroProjecoes.set(falha);
        },
      });
  }
}
