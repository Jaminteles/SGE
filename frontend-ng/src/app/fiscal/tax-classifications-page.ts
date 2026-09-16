import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { FiscalApiService } from '../core/api/fiscal-api.service';
import type { TaxClassification } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { ListState } from '../core/lib/list-state';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { Alert } from '../ui/alert';
import { ConfirmService } from '../ui/confirm.service';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type DefinicaoFiltro, type ValoresFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  DICA_CODIGO,
  type FormClassificacao,
  OPCOES_TIPO_CLASSIFICACAO,
  ROTULO_TIPO_CLASSIFICACAO,
  formClassificacaoDe,
  formClassificacaoVazia,
  formatarPercentual,
  montarClassificacao,
  montarEdicaoClassificacao,
  problemaClassificacao,
} from './tributos';

const COLUNAS: Coluna[] = [
  { campo: 'type', cabecalho: 'Tipo', largura: '8rem' },
  { campo: 'code', cabecalho: 'Código', largura: '9rem' },
  { campo: 'description', cabecalho: 'Descrição' },
  { campo: 'icmsRate', cabecalho: 'ICMS', numerica: true, largura: '6rem' },
  { campo: 'ipiRate', cabecalho: 'IPI', numerica: true, largura: '6rem' },
  { campo: 'pisRate', cabecalho: 'PIS', numerica: true, largura: '6rem' },
  { campo: 'cofinsRate', cabecalho: 'COFINS', numerica: true, largura: '6rem' },
  { campo: 'acoes', cabecalho: '', largura: '10rem' },
];

const FILTROS: DefinicaoFiltro[] = [
  {
    name: 'type',
    label: 'Tipo',
    options: OPCOES_TIPO_CLASSIFICACAO,
    placeholder: 'Todos os tipos',
  },
];

/**
 * Classificações fiscais da empresa (RF-089 — UI-061).
 *
 * É o cadastro que dá sentido ao NCM que vem no XML de terceiro: sem ele, a
 * alíquota declarada na nota não tem contra o que ser conferida, e a regra
 * fiscal presa a uma classificação não tem a que se prender.
 *
 * Tipo e código não são editáveis: são a identidade da linha (unique por
 * empresa, tipo e código) e já podem estar apontados por notas recebidas e por
 * regras. Reescrevê-los reclassificaria retroativamente nota fechada — o
 * caminho é cadastrar a nova e inativar a antiga.
 */
@Component({
  selector: 'sge-tax-classifications-page',
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
    <p class="crumb">Fiscal / Classificações</p>

    <div class="pagehead">
      <div>
        <h1>Classificações fiscais</h1>
        <p>NCM, CEST, CFOP, CST e LC 116 com as alíquotas esperadas (RF-089).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Nova classificação" icon="pi pi-plus" (onClick)="abrirNova()" />
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
        placeholderBusca="Buscar por código ou descrição"
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
            ? 'Nenhuma classificação para este filtro.'
            : 'Nenhuma classificação fiscal cadastrada.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-item>
          <tr [class.linha--inativa]="!item.isActive">
            <td>{{ rotuloTipo(item) }}</td>
            <td class="codigo">{{ item.code }}</td>
            <td>
              {{ item.description }}
              @if (!item.isActive) {
                <p-tag value="Inativa" severity="secondary" [rounded]="true" />
              }
            </td>
            <td class="coluna--numerica">{{ percentual(item.icmsRate) }}</td>
            <td class="coluna--numerica">{{ percentual(item.ipiRate) }}</td>
            <td class="coluna--numerica">{{ percentual(item.pisRate) }}</td>
            <td class="coluna--numerica">{{ percentual(item.cofinsRate) }}</td>
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
      [style]="{ width: '40rem' }"
      [header]="form().id ? 'Editar classificação' : 'Nova classificação fiscal'"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <div class="grade-campos">
        <sge-select-field
          rotulo="Tipo"
          [obrigatorio]="true"
          [opcoes]="opcoesTipo"
          [disabled]="!!form().id"
          [ngModel]="form().type"
          (ngModelChange)="mudar('type', $event ?? 'NCM')"
        />
        <sge-text-field
          rotulo="Código"
          [obrigatorio]="true"
          [dica]="dicaCodigo()"
          [disabled]="!!form().id"
          [ngModel]="form().code"
          (ngModelChange)="mudar('code', $event ?? '')"
        />
        <sge-text-field
          rotulo="Descrição"
          [obrigatorio]="true"
          [ngModel]="form().description"
          (ngModelChange)="mudar('description', $event ?? '')"
        />
        <sge-text-field
          rotulo="ICMS (%)"
          [ngModel]="form().icmsRate"
          (ngModelChange)="mudar('icmsRate', $event ?? '')"
        />
        <sge-text-field
          rotulo="IPI (%)"
          [ngModel]="form().ipiRate"
          (ngModelChange)="mudar('ipiRate', $event ?? '')"
        />
        <sge-text-field
          rotulo="PIS (%)"
          [ngModel]="form().pisRate"
          (ngModelChange)="mudar('pisRate', $event ?? '')"
        />
        <sge-text-field
          rotulo="COFINS (%)"
          [ngModel]="form().cofinsRate"
          (ngModelChange)="mudar('cofinsRate', $event ?? '')"
        />
      </div>

      <p class="secundario">
        As alíquotas são a expectativa do cadastro: elas não reescrevem nada do que a nota declarou
        — servem para apontar divergência.
      </p>

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
      p-tag {
        margin-left: 0.35rem;
      }
    `,
  ],
})
export class TaxClassificationsPage {
  private readonly api = inject(FiscalApiService);
  private readonly confirmacao = inject(ConfirmService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly colunas = COLUNAS;
  protected readonly filtros = FILTROS;
  protected readonly opcoesTipo = OPCOES_TIPO_CLASSIFICACAO;
  protected readonly percentual = formatarPercentual;

  protected readonly lista = new ListState<TaxClassification>(
    (consulta) => this.api.listClassifications(consulta),
    (filtros) => ({ q: filtros.q, type: filtros['type'] || undefined }),
  );

  protected readonly aviso = signal<string | null>(null);
  protected readonly editando = signal(false);
  protected readonly salvando = signal(false);
  protected readonly inativando = signal<string | null>(null);
  protected readonly erroDialogo = signal<unknown>(null);
  protected readonly form = signal<FormClassificacao>(formClassificacaoVazia());
  private readonly original = signal<TaxClassification | null>(null);

  protected readonly problema = computed(() => problemaClassificacao(this.form()));
  protected readonly dicaCodigo = computed(() => DICA_CODIGO[this.form().type]);

  protected readonly podeCriar = () => this.permissoes.pode('tax-classifications:CREATE');
  protected readonly podeEditar = () => this.permissoes.pode('tax-classifications:UPDATE');
  protected readonly podeInativar = () => this.permissoes.pode('tax-classifications:DELETE');

  constructor() {
    this.lista.carregar();
  }

  protected rotuloTipo(item: TaxClassification): string {
    return ROTULO_TIPO_CLASSIFICACAO[item.type];
  }

  protected aplicar(valores: ValoresFiltro): void {
    this.lista.aplicarFiltros(valores);
  }

  protected abrirNova(): void {
    this.original.set(null);
    this.form.set(formClassificacaoVazia());
    this.erroDialogo.set(null);
    this.editando.set(true);
  }

  protected abrirEdicao(item: TaxClassification): void {
    this.original.set(item);
    this.form.set(formClassificacaoDe(item));
    this.erroDialogo.set(null);
    this.editando.set(true);
  }

  protected mudar<K extends keyof FormClassificacao>(campo: K, valor: FormClassificacao[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected salvar(): void {
    if (this.salvando() || this.problema()) return;
    const form = this.form();
    const atual = this.original();

    this.salvando.set(true);
    this.erroDialogo.set(null);

    const requisicao = atual
      ? this.api.updateClassification(atual.id, montarEdicaoClassificacao(form, atual))
      : this.api.createClassification(montarClassificacao(form));

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvando.set(false);
        this.editando.set(false);
        this.aviso.set(atual ? 'Classificação atualizada.' : 'Classificação cadastrada.');
        this.lista.carregar();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroDialogo.set(falha);
      },
    });
  }

  /** Inativa: o item de nota já classificado não pode apontar para linha que sumiu. */
  protected async inativar(item: TaxClassification): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Inativar classificação fiscal?',
      mensagem:
        'A classificação deixa de ser oferecida em novos produtos e documentos. O que já a usa não muda.',
      rotuloConfirmar: 'Inativar',
      destrutivo: true,
    });
    if (!confirmado) return;

    if (this.inativando()) return;
    this.inativando.set(item.id);
    this.api
      .deleteClassification(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.inativando.set(null);
          this.aviso.set(`${item.code} inativada.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.inativando.set(null);
          this.lista.erro.set(falha);
        },
      });
  }
}
