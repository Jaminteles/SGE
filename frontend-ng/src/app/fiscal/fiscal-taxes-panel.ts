import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { of } from 'rxjs';

import { FiscalApiService } from '../core/api/fiscal-api.service';
import type {
  DocumentTaxItem,
  DocumentTaxSummary,
  TaxClassification,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency, formatDecimal } from '../core/lib/decimal';
import { CASAS_UNITARIAS } from '../compras/calculo';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SearchSelect } from '../ui/search-select';
import { formatarPercentual } from './tributos';

/**
 * Tributação declarada da nota e divergências contra o cadastro (RF-090 —
 * UI-063).
 *
 * **Nada do que o emitente declarou é reescrito aqui.** Valor, base, alíquota e
 * o NCM do XML seguem como chegaram — o banco recusa alterá-los depois do
 * processamento (bd/12). A única coluna que esta tela grava é a classificação
 * do item, que é leitura *nossa* sobre a nota.
 *
 * Divergência é informação, não correção: corrigir XML de terceiro para que ele
 * pareça certo é perder a prova do que foi recebido.
 */
@Component({
  selector: 'sge-fiscal-taxes-panel',
  imports: [FormsModule, ButtonModule, TagModule, Alert, ErrorAlert, SearchSelect],
  template: `
    <section class="card secao espaco">
      <div class="secao__cabecalho">
        <h2 class="secao__titulo">Tributação declarada</h2>
        @if (podeClassificar() && resumo()) {
          <p-button
            label="Classificar pelo NCM"
            icon="pi pi-sparkles"
            size="small"
            severity="secondary"
            [outlined]="true"
            [loading]="classificandoTudo()"
            [disabled]="classificandoTudo()"
            (onClick)="classificarTudo()"
          />
        }
      </div>

      @if (aviso(); as texto) {
        <div class="bloco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
      }
      @if (erro(); as falha) {
        <div class="bloco"><sge-error-alert [erro]="falha" /></div>
      }

      @if (resumo(); as dados) {
        <div class="totais">
          <div class="total">
            <span class="total__rotulo">Produtos</span>
            <span class="total__valor">{{ moeda(dados.declared.productsAmount) }}</span>
          </div>
          <div class="total">
            <span class="total__rotulo">Total da nota</span>
            <span class="total__valor">{{ moeda(dados.declared.totalAmount) }}</span>
          </div>
          <div class="total">
            <span class="total__rotulo">ICMS</span>
            <span class="total__valor">{{ moeda(dados.declared.icmsAmount) }}</span>
          </div>
          <div class="total">
            <span class="total__rotulo">ICMS ST</span>
            <span class="total__valor">{{ moeda(dados.declared.icmsStAmount) }}</span>
          </div>
          <div class="total">
            <span class="total__rotulo">IPI</span>
            <span class="total__valor">{{ moeda(dados.declared.ipiAmount) }}</span>
          </div>
          <div class="total">
            <span class="total__rotulo">PIS / COFINS</span>
            <span class="total__valor">
              {{ moeda(dados.declared.pisAmount) }} / {{ moeda(dados.declared.cofinsAmount) }}
            </span>
          </div>
          <div class="total">
            <span class="total__rotulo">ISS</span>
            <span class="total__valor">{{ moeda(dados.declared.issAmount) }}</span>
          </div>
        </div>

        @if (dados.unclassifiedItems > 0) {
          <div class="bloco">
            <sge-alert
              tom="aviso"
              [titulo]="
                dados.unclassifiedItems + ' item(ns) sem classificação fiscal no cadastro'
              "
              mensagem="Sem a classificação, a alíquota declarada não tem contra o que ser conferida."
            />
          </div>
        }

        @if (dados.divergences.length > 0) {
          <div class="bloco">
            <sge-alert
              tom="aviso"
              [titulo]="dados.divergences.length + ' divergência(s) entre a nota e o cadastro'"
              mensagem="A nota permanece como foi recebida: a divergência é informação para conferência, não correção."
              [detalhes]="detalhes()"
            />
          </div>
        }

        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Descrição</th>
                <th scope="col">NCM / CFOP</th>
                <th class="numero" scope="col">Quantidade</th>
                <th class="numero" scope="col">Valor</th>
                <th class="numero" scope="col">ICMS</th>
                <th scope="col">Classificação</th>
                @if (podeClassificar()) {
                  <th class="coluna-edicao" scope="col">Classificar</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (item of dados.items; track item.id) {
                <tr [class.linha--divergente]="temDivergencia(item)">
                  <td>{{ item.sequence }}</td>
                  <td>{{ item.description }}</td>
                  <td>
                    <span class="codigo">{{ item.ncm ?? '—' }}</span>
                    /
                    <span class="codigo">{{ item.cfop ?? '—' }}</span>
                  </td>
                  <td class="numero">{{ quantidade(item.quantity) }}</td>
                  <td class="numero">{{ moeda(item.lineAmount) }}</td>
                  <td class="numero">
                    {{ moeda(item.icmsAmount) }}
                    <span class="secundario">{{ percentual(item.icmsRate) }}</span>
                  </td>
                  <td>
                    @if (item.classification; as classificacao) {
                      {{ classificacao.code }} — {{ classificacao.description }}
                    } @else {
                      <p-tag value="Sem classificação" severity="warn" [rounded]="true" />
                    }
                  </td>
                  @if (podeClassificar()) {
                    <td class="coluna-edicao">
                      <div class="edicao">
                        <sge-search-select
                          rotulo="NCM cadastrado"
                          placeholder="Buscar classificação"
                          [buscar]="buscarClassificacao"
                          [resolver]="resolverClassificacao"
                          [ngModel]="escolha(item)"
                          (ngModelChange)="escolher(item.sequence, $event)"
                        />
                        <p-button
                          label="Salvar"
                          size="small"
                          [loading]="salvando() === item.sequence"
                          [disabled]="!!salvando() || !mudou(item)"
                          (onClick)="salvar(item)"
                        />
                      </div>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (carregando()) {
        <p class="secundario">Carregando a tributação…</p>
      }
    </section>
  `,
  styles: [
    ESTILO_TABELA,
    `
      .secao__cabecalho {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }
      .bloco {
        margin: 0.75rem 0;
      }
      .totais {
        display: flex;
        flex-wrap: wrap;
        gap: 1.25rem;
        margin: 0.75rem 0 1rem;
      }
      .total {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .total__rotulo {
        font-size: 0.72rem;
        color: var(--p-text-muted-color);
      }
      .total__valor {
        font-size: 0.9rem;
        font-variant-numeric: tabular-nums;
      }
      .codigo {
        font-variant-numeric: tabular-nums;
      }
      .linha--divergente {
        background: var(--p-highlight-background, transparent);
      }
      .coluna-edicao {
        width: 22rem;
      }
      .edicao {
        display: flex;
        align-items: end;
        gap: 0.5rem;
      }
      .edicao sge-search-select {
        flex: 1;
      }
      .secundario {
        display: block;
        font-size: 0.72rem;
        color: var(--p-text-muted-color);
      }
    `,
  ],
})
export class FiscalTaxesPanel {
  /** Documento cuja tributação é exibida. */
  readonly documentoId = input.required<string>();

  private readonly api = inject(FiscalApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly moeda = formatCurrency;
  protected readonly percentual = formatarPercentual;

  protected readonly resumo = signal<DocumentTaxSummary | null>(null);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly salvando = signal<number | null>(null);
  protected readonly classificandoTudo = signal(false);
  /** Classificação escolhida por sequência, ainda não salva. */
  protected readonly escolhas = signal<Record<number, string | null>>({});

  private readonly classificacoes = signal<TaxClassification[]>([]);

  protected readonly detalhes = computed(() =>
    (this.resumo()?.divergences ?? []).map(
      (linha) => `Item ${linha.sequence} · ${linha.field}: ${linha.note}`,
    ),
  );

  private readonly sequenciasDivergentes = computed(
    () => new Set((this.resumo()?.divergences ?? []).map((linha) => linha.sequence)),
  );

  protected readonly podeClassificar = () => this.permissoes.pode('document-taxes:UPDATE');

  protected readonly buscarClassificacao = (termo: string) => {
    const busca = termo.trim().toLowerCase();
    return of(
      this.classificacoes()
        .filter(
          (item) =>
            busca === '' ||
            item.code.toLowerCase().includes(busca) ||
            item.description.toLowerCase().includes(busca),
        )
        .slice(0, 20)
        .map(opcaoClassificacao),
    );
  };

  protected readonly resolverClassificacao = (id: string) => {
    const item = this.classificacoes().find((linha) => linha.id === id);
    if (item) return of(opcaoClassificacao(item));
    const noResumo = this.resumo()?.items.find((linha) => linha.classificationId === id);
    return of({
      value: id,
      label: noResumo?.classification
        ? `${noResumo.classification.code} — ${noResumo.classification.description}`
        : id,
    });
  };

  constructor() {
    effect(() => {
      const id = this.documentoId();
      if (id) untracked(() => this.carregar(id));
    });

    if (this.permissoes.pode('tax-classifications:READ')) {
      this.api
        .listClassifications({ pageSize: 200, type: 'NCM' })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (pagina) => this.classificacoes.set(pagina.data),
          error: () => this.classificacoes.set([]),
        });
    }
  }

  protected quantidade(valor: string): string {
    return formatDecimal(valor, CASAS_UNITARIAS);
  }

  protected temDivergencia(item: DocumentTaxItem): boolean {
    return this.sequenciasDivergentes().has(item.sequence);
  }

  /** Campo limpo é escolha legítima (remover o vínculo), não "sem escolha". */
  protected escolha(item: DocumentTaxItem): string | null {
    const escolhas = this.escolhas();
    return item.sequence in escolhas ? escolhas[item.sequence] : item.classificationId;
  }

  protected escolher(sequence: number, classificationId: string | null): void {
    this.escolhas.update((atual) => ({ ...atual, [sequence]: classificationId }));
  }

  protected mudou(item: DocumentTaxItem): boolean {
    const escolhas = this.escolhas();
    return item.sequence in escolhas && escolhas[item.sequence] !== item.classificationId;
  }

  protected salvar(item: DocumentTaxItem): void {
    if (this.salvando() || !this.mudou(item)) return;
    const escolhido = this.escolhas()[item.sequence] ?? null;

    this.salvando.set(item.sequence);
    this.erro.set(null);
    this.api
      .classifyItem(this.documentoId(), item.sequence, escolhido)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (atualizado) => {
          this.salvando.set(null);
          this.resumo.set(atualizado);
          this.escolhas.update(({ [item.sequence]: _descartada, ...resto }) => resto);
          this.aviso.set(
            escolhido
              ? `Item ${item.sequence} classificado.`
              : `Classificação do item ${item.sequence} removida.`,
          );
        },
        error: (falha: unknown) => {
          this.salvando.set(null);
          this.erro.set(falha);
        },
      });
  }

  /** Liga cada linha ao NCM já cadastrado; o que não existe no cadastro sobra. */
  protected classificarTudo(): void {
    if (this.classificandoTudo()) return;
    this.classificandoTudo.set(true);
    this.erro.set(null);
    this.api
      .autoClassify(this.documentoId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => {
          this.classificandoTudo.set(false);
          this.aviso.set(
            resultado.pending.length > 0
              ? `${resultado.classified} item(ns) classificados. Sem cadastro: ${resultado.pending.join(', ')}.`
              : `${resultado.classified} item(ns) classificados.`,
          );
          this.carregar(this.documentoId());
        },
        error: (falha: unknown) => {
          this.classificandoTudo.set(false);
          this.erro.set(falha);
        },
      });
  }

  private carregar(documentoId: string): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.escolhas.set({});
    this.api
      .documentTaxes(documentoId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dados) => {
          this.resumo.set(dados);
          this.carregando.set(false);
        },
        error: (falha: unknown) => {
          this.resumo.set(null);
          this.erro.set(falha);
          this.carregando.set(false);
        },
      });
  }
}

function opcaoClassificacao(item: TaxClassification): OpcaoFiltro {
  return { value: item.id, label: `${item.code} — ${item.description}` };
}
