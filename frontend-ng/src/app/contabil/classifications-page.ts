import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { of } from 'rxjs';

import { AccountingApiService } from '../core/api/accounting-api.service';
import type { AccountClassification, ClassifiableSource, LedgerAccountNode } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { SearchSelect } from '../ui/search-select';
import { SelectField } from '../ui/select-field';
import {
  DICA_ORIGEM_CLASSIFICAVEL,
  OPCOES_ORIGEM_CLASSIFICAVEL,
  ROTULO_ORIGEM_CLASSIFICAVEL,
  contaClassificada,
  contasAnaliticas,
  filtrarOpcoes,
  opcaoContaContabil,
  resumoClassificacao,
} from './rotulos';

/**
 * Classificação contábil das operações financeiras (RF-080 — UI-055).
 *
 * É onde o financeiro encontra a contabilidade: a conta de cada categoria,
 * verba de folha e conta bancária decide em que linha da DRE o valor cai e qual
 * é a contrapartida de caixa da baixa. Origem sem conta faz a contabilização
 * automática recusar — por isso o filtro "sem conta" existe.
 */
@Component({
  selector: 'sge-classifications-page',
  imports: [FormsModule, ButtonModule, CheckboxModule, TagModule, Alert, ErrorAlert, SearchSelect, SelectField],
  template: `
    <p class="crumb">Contábil / Classificação</p>

    <div class="pagehead">
      <div>
        <h1>Classificação contábil</h1>
        <p>Conta contábil de cada origem financeira, usada na contabilização automática (RF-080).</p>
      </div>
    </div>

    @if (aviso(); as texto) {
      <sge-alert tom="sucesso" [titulo]="texto" />
    }

    <div class="card espaco barra">
      <sge-select-field
        rotulo="Origem"
        [obrigatorio]="true"
        [opcoes]="opcoesOrigem"
        [dica]="dicaOrigem()"
        [ngModel]="origem()"
        (ngModelChange)="trocarOrigem($event)"
      />
      <label class="marcador">
        <p-checkbox [binary]="true" [ngModel]="somenteSem()" (ngModelChange)="alternarSomenteSem($event)" />
        Somente sem conta contábil
      </label>
    </div>

    @if (resumo().sem > 0 && !somenteSem()) {
      <div class="espaco">
        <sge-alert
          tom="aviso"
          [titulo]="resumo().sem + ' de ' + resumo().total + ' sem conta contábil'"
          mensagem="A contabilização automática recusa operações dessas origens até que sejam classificadas."
        />
      </div>
    }

    @if (!podeLerPlano()) {
      <div class="espaco">
        <sge-alert
          tom="info"
          titulo="Sem acesso ao plano de contas"
          mensagem="A classificação é exibida, mas escolher a conta exige a permissão de consultar o plano de contas."
        />
      </div>
    }

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    <section class="card espaco">
      <div class="tabela-rolagem">
        <table class="tabela">
          <thead>
            <tr>
              <th>{{ rotuloOrigem() }}</th>
              <th>Conta contábil</th>
              @if (podeClassificar()) {
                <th class="coluna-edicao">Alterar para</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (item of itens(); track item.id) {
              <tr>
                <td>
                  <span class="codigo">{{ item.code }}</span> {{ item.name }}
                </td>
                <td>
                  @if (item.ledgerAccountId) {
                    {{ conta(item) }}
                  } @else {
                    <p-tag value="Sem conta" severity="warn" [rounded]="true" />
                  }
                </td>
                @if (podeClassificar()) {
                  <td class="coluna-edicao">
                    <div class="edicao">
                      <sge-search-select
                        rotulo="Conta analítica"
                        placeholder="Buscar conta"
                        [buscar]="buscarConta"
                        [resolver]="resolverConta"
                        [ngModel]="valorEscolhido(item)"
                        (ngModelChange)="escolher(item.id, $event)"
                      />
                      <p-button
                        label="Salvar"
                        size="small"
                        [loading]="salvando() === item.id"
                        [disabled]="!!salvando() || !mudou(item)"
                        (onClick)="salvar(item)"
                      />
                    </div>
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="podeClassificar() ? 3 : 2" class="vazio">
                  @if (carregando()) {
                    Carregando…
                  } @else if (somenteSem()) {
                    Todas as origens desta lista já têm conta contábil.
                  } @else {
                    Nenhuma origem ativa cadastrada.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: [
    ESTILO_TABELA,
    `
      .barra {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 1rem;
        padding: 0.875rem;
      }
      .marcador {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.85rem;
        padding-bottom: 0.5rem;
      }
      .codigo {
        color: var(--p-text-muted-color);
        font-variant-numeric: tabular-nums;
      }
      .coluna-edicao {
        width: 24rem;
      }
      .edicao {
        display: flex;
        align-items: end;
        gap: 0.5rem;
      }
      .edicao sge-search-select {
        flex: 1;
      }
    `,
  ],
})
export class ClassificationsPage {
  private readonly api = inject(AccountingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly opcoesOrigem = OPCOES_ORIGEM_CLASSIFICAVEL;

  protected readonly origem = signal<ClassifiableSource>('categories');
  protected readonly somenteSem = signal(false);
  protected readonly itens = signal<AccountClassification[]>([]);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly salvando = signal<string | null>(null);
  /** Conta escolhida por origem, ainda não salva. `null` = remover a classificação. */
  protected readonly escolhas = signal<Record<string, string | null>>({});

  private readonly plano = signal<LedgerAccountNode[]>([]);
  private readonly opcoesConta = computed(() => contasAnaliticas(this.plano()).map(opcaoContaContabil));

  protected readonly rotuloOrigem = computed(() => ROTULO_ORIGEM_CLASSIFICAVEL[this.origem()]);
  protected readonly dicaOrigem = computed(() => DICA_ORIGEM_CLASSIFICAVEL[this.origem()]);
  protected readonly resumo = computed(() => resumoClassificacao(this.itens()));

  protected readonly buscarConta = (termo: string) => of(filtrarOpcoes(this.opcoesConta(), termo));
  protected readonly resolverConta = (id: string) => {
    const opcao = this.opcoesConta().find((item) => item.value === id);
    if (opcao) return of(opcao);
    const classificada = this.itens().find((item) => item.ledgerAccountId === id);
    return of({ value: id, label: classificada ? contaClassificada(classificada) : id });
  };

  protected readonly podeLerPlano = () => this.permissoes.pode('ledger-accounts:READ');
  protected readonly podeClassificar = () =>
    this.permissoes.pode('accounting-classifications:UPDATE') && this.podeLerPlano();

  constructor() {
    this.carregar();
    if (this.podeLerPlano()) {
      this.api
        .tree()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (plano) => this.plano.set(plano),
          error: () => this.plano.set([]),
        });
    }
  }

  protected trocarOrigem(origem: ClassifiableSource | null): void {
    if (!origem || origem === this.origem()) return;
    this.origem.set(origem);
    this.carregar();
  }

  protected alternarSomenteSem(valor: boolean): void {
    this.somenteSem.set(valor);
    this.carregar();
  }

  protected escolher(id: string, accountId: string | null): void {
    this.escolhas.update((atual) => ({ ...atual, [id]: accountId }));
  }

  /** Limpar o campo é escolha legítima (remover a conta), não "sem escolha". */
  protected valorEscolhido(item: AccountClassification): string | null {
    const escolhas = this.escolhas();
    return item.id in escolhas ? escolhas[item.id] : item.ledgerAccountId;
  }

  protected mudou(item: AccountClassification): boolean {
    const escolhas = this.escolhas();
    return item.id in escolhas && escolhas[item.id] !== item.ledgerAccountId;
  }

  protected salvar(item: AccountClassification): void {
    if (this.salvando() || !this.mudou(item)) return;
    const accountId = this.escolhas()[item.id] ?? null;
    const origem = this.origem();

    this.salvando.set(item.id);
    this.erro.set(null);
    this.api
      .assignClassification(origem, item.id, accountId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (atualizado) => {
          this.salvando.set(null);
          this.itens.update((lista) => lista.map((linha) => (linha.id === atualizado.id ? atualizado : linha)));
          this.escolhas.update(({ [item.id]: _descartada, ...resto }) => resto);
          this.aviso.set(
            atualizado.ledgerAccountId
              ? `${item.name} classificada em ${contaClassificada(atualizado)}.`
              : `Classificação de ${item.name} removida.`,
          );
        },
        error: (falha: unknown) => {
          this.salvando.set(null);
          this.erro.set(falha);
        },
      });
  }

  protected conta(item: AccountClassification): string {
    return contaClassificada(item);
  }

  private carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.escolhas.set({});
    this.api
      .listClassifications(this.origem(), this.somenteSem())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (itens) => {
          this.itens.set(itens);
          this.carregando.set(false);
        },
        error: (falha: unknown) => {
          this.itens.set([]);
          this.erro.set(falha);
          this.carregando.set(false);
        },
      });
  }
}
