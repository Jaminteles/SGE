import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { of } from 'rxjs';

import { AccountingApiService } from '../core/api/accounting-api.service';
import type { LedgerAccount, LedgerAccountNode } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type ValoresFiltro } from '../ui/filter-bar';
import { SearchSelect } from '../ui/search-select';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  FILTRO_GRUPO_CONTA,
  FILTRO_SITUACAO_CONTA,
  NATUREZA_POR_TIPO,
  OPCOES_NATUREZA,
  OPCOES_TIPO_CONTA,
  ROTULO_GRUPO,
  ROTULO_NATUREZA,
  ROTULO_TIPO_CONTA,
  achatarArvore,
  contasSinteticas,
  filtrarOpcoes,
  formContaVazio,
  formDeConta,
  grupoDaConta,
  montarConta,
  montarEdicaoConta,
  opcaoContaContabil,
  problemaConta,
  type FormConta,
} from './rotulos';

/**
 * Plano de contas em árvore (RF-078/RF-079 — UI-054).
 *
 * O plano inteiro vem numa resposta (`GET /ledger-accounts/tree`) e a busca é
 * local: a árvore é pequena, e filtrar no servidor quebraria o caminho do
 * grupo até a conta. Sintética agrupa, analítica recebe partida.
 *
 * Código e tipo não se editam: mudá-los reclassificaria retroativamente todo
 * saldo já apurado. O caminho é criar a conta nova e inativar a antiga.
 */
@Component({
  selector: 'sge-chart-of-accounts-page',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    TagModule,
    Alert,
    ErrorAlert,
    FilterBar,
    SearchSelect,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Contábil / Plano de contas</p>

    <div class="pagehead">
      <div>
        <h1>Plano de contas</h1>
        <p>Contas patrimoniais e de resultado, do grupo à conta analítica (RF-078/RF-079).</p>
      </div>
      <div class="pagehead__actions">
        @if (arvore().length > 0) {
          <p-button label="Expandir tudo" severity="secondary" [text]="true" (onClick)="expandirTudo()" />
          <p-button label="Recolher tudo" severity="secondary" [text]="true" (onClick)="recolherTudo()" />
        }
        @if (podeCriar()) {
          <p-button label="Nova conta" icon="pi pi-plus" (onClick)="abrirNova(null)" />
        }
      </div>
    </div>

    @if (aviso(); as texto) {
      <sge-alert tom="sucesso" [titulo]="texto" />
    }

    <div class="espaco">
      <sge-filter-bar
        placeholderBusca="Buscar por código ou nome"
        [valores]="filtros()"
        [filtros]="filtrosBarra"
        (mudou)="filtros.set($event)"
      />
    </div>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    <section class="card espaco">
      <div class="tabela-rolagem">
        <table class="tabela">
          <thead>
            <tr>
              <th>Conta</th>
              <th>Tipo</th>
              <th>Natureza</th>
              <th>Classe</th>
              <th>SPED</th>
              <th>Situação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (linha of linhas(); track linha.conta.id) {
              <tr [class.inativa]="!linha.conta.isActive">
                <td>
                  <span class="arvore" [style.padding-left.rem]="linha.profundidade * 1.25">
                    @if (linha.temFilhas) {
                      <button
                        type="button"
                        class="arvore__alternar"
                        [attr.aria-expanded]="!linha.recolhida"
                        [attr.aria-label]="(linha.recolhida ? 'Expandir ' : 'Recolher ') + linha.conta.code"
                        (click)="alternar(linha.conta.id)"
                      >
                        <i class="pi" [class.pi-chevron-right]="linha.recolhida" [class.pi-chevron-down]="!linha.recolhida"></i>
                      </button>
                    } @else {
                      <span class="arvore__folha" aria-hidden="true"></span>
                    }
                    <span class="codigo">{{ linha.conta.code }}</span>
                    <span [class.sintetica]="!linha.conta.acceptsEntry">{{ linha.conta.name }}</span>
                  </span>
                </td>
                <td>
                  {{ tipo(linha.conta) }}
                  <span class="secundario">{{ grupo(linha.conta) }}</span>
                </td>
                <td>{{ natureza(linha.conta) }}</td>
                <td>
                  <p-tag
                    [value]="linha.conta.acceptsEntry ? 'Analítica' : 'Sintética'"
                    [severity]="linha.conta.acceptsEntry ? 'info' : 'secondary'"
                    [rounded]="true"
                  />
                </td>
                <td>{{ linha.conta.spedReferenceCode ?? '—' }}</td>
                <td>
                  <p-tag
                    [value]="linha.conta.isActive ? 'Ativa' : 'Inativa'"
                    [severity]="linha.conta.isActive ? 'success' : 'secondary'"
                    [rounded]="true"
                  />
                </td>
                <td class="acoes">
                  @if (podeCriar() && !linha.conta.acceptsEntry && linha.conta.isActive) {
                    <p-button label="Subconta" severity="secondary" [text]="true" size="small" (onClick)="abrirNova(linha.conta)" />
                  }
                  @if (podeEditar()) {
                    <p-button label="Editar" severity="secondary" [text]="true" size="small" (onClick)="abrirEdicao(linha.conta)" />
                  }
                  @if (podeInativar() && linha.conta.isActive) {
                    <p-button
                      label="Inativar"
                      severity="danger"
                      [text]="true"
                      size="small"
                      [loading]="inativando() === linha.conta.id"
                      [disabled]="!!inativando()"
                      (onClick)="inativar(linha.conta)"
                    />
                  }
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" class="vazio">
                  @if (carregando()) {
                    Carregando o plano de contas…
                  } @else if (arvore().length === 0) {
                    Nenhuma conta cadastrada. Comece pelos grupos: 1 Ativo, 2 Passivo, 3 Receita…
                  } @else {
                    Nenhuma conta atende aos filtros.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <p-dialog
      [visible]="editando()"
      (visibleChange)="editando.set($event)"
      [modal]="true"
      [style]="{ width: '42rem' }"
      [header]="contaEditada() ? 'Editar conta ' + contaEditada()!.code : 'Nova conta'"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <div class="grade-campos">
        @if (!contaEditada()) {
          @if (paiFixo(); as pai) {
            <p class="secundario campo-largo">Subconta de {{ pai.code }} — {{ pai.name }}</p>
          } @else {
            <sge-search-select
              rotulo="Conta pai"
              placeholder="Nenhuma: conta de primeiro nível"
              dica="Só contas sintéticas agrupam"
              [buscar]="buscarPai"
              [resolver]="resolverPai"
              [ngModel]="form().parentId || null"
              (ngModelChange)="escolherPai($event ?? '')"
            />
          }
        }
        <sge-text-field
          rotulo="Código"
          dica="Estruturado por pontos, como 1.1.01.001"
          [obrigatorio]="true"
          [ngModel]="form().code"
          [disabled]="!!contaEditada()"
          (ngModelChange)="mudar('code', $event ?? '')"
        />
        <sge-text-field rotulo="Nome" [obrigatorio]="true" [ngModel]="form().name" (ngModelChange)="mudar('name', $event ?? '')" />
        <sge-select-field
          rotulo="Tipo"
          [obrigatorio]="true"
          [opcoes]="opcoesTipo"
          [ngModel]="form().type || null"
          [disabled]="!!contaEditada() || !!form().parentId"
          (ngModelChange)="mudar('type', $event ?? '')"
        />
        @if (form().type === 'COMPENSACAO' && !contaEditada()) {
          <sge-select-field
            rotulo="Natureza"
            [obrigatorio]="true"
            [opcoes]="opcoesNatureza"
            [ngModel]="form().nature || null"
            (ngModelChange)="mudar('nature', $event ?? '')"
          />
        } @else if (form().type) {
          <p class="secundario natureza">Natureza {{ naturezaDoTipo() }}: decorre do tipo (RF-079).</p>
        }
        <sge-text-field rotulo="Código reduzido" [ngModel]="form().shortCode" (ngModelChange)="mudar('shortCode', $event ?? '')" />
        <sge-text-field
          rotulo="Conta referencial SPED"
          [ngModel]="form().spedReferenceCode"
          (ngModelChange)="mudar('spedReferenceCode', $event ?? '')"
        />
      </div>
      <label class="marcador">
        <p-checkbox [binary]="true" [ngModel]="form().acceptsEntry" (ngModelChange)="mudar('acceptsEntry', $event)" />
        Analítica: recebe lançamento
      </label>
      <p class="secundario">Conta com filhas não recebe lançamento — o saldo entraria duas vezes no balancete.</p>

      @if (problema(); as texto) {
        <p class="campo__erro">{{ texto }}</p>
      }

      <ng-template #footer>
        <p-button label="Voltar" severity="secondary" [outlined]="true" [disabled]="salvando()" (onClick)="editando.set(false)" />
        <p-button label="Salvar" icon="pi pi-check" [loading]="salvando()" [disabled]="salvando()" (onClick)="salvar()" />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    ESTILO_TABELA,
    `
      .arvore {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
      }
      .arvore__alternar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        padding: 0;
        border: 0;
        background: none;
        color: var(--p-text-muted-color);
        cursor: pointer;
      }
      .arvore__alternar i {
        font-size: 0.7rem;
      }
      .arvore__folha {
        display: inline-block;
        width: 1.25rem;
      }
      .codigo {
        font-variant-numeric: tabular-nums;
        color: var(--p-text-muted-color);
      }
      .sintetica {
        font-weight: 600;
      }
      .inativa td {
        color: var(--p-text-muted-color);
      }
      .campo-largo,
      .natureza {
        align-self: end;
        margin: 0;
      }
      .marcador {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0.75rem 0 0.25rem;
        font-size: 0.85rem;
      }
    `,
  ],
})
export class ChartOfAccountsPage {
  private readonly api = inject(AccountingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly filtrosBarra = [FILTRO_GRUPO_CONTA, FILTRO_SITUACAO_CONTA];
  protected readonly opcoesTipo = OPCOES_TIPO_CONTA;
  protected readonly opcoesNatureza = OPCOES_NATUREZA;

  protected readonly arvore = signal<LedgerAccountNode[]>([]);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly filtros = signal<ValoresFiltro>({ q: '' });
  protected readonly recolhidas = signal<ReadonlySet<string>>(new Set());
  protected readonly aviso = signal<string | null>(null);
  protected readonly inativando = signal<string | null>(null);

  protected readonly editando = signal(false);
  protected readonly contaEditada = signal<LedgerAccount | null>(null);
  protected readonly paiFixo = signal<LedgerAccount | null>(null);
  protected readonly form = signal<FormConta>(formContaVazio());
  protected readonly tentouSalvar = signal(false);
  protected readonly salvando = signal(false);
  protected readonly erroDialogo = signal<unknown>(null);

  protected readonly linhas = computed(() => achatarArvore(this.arvore(), this.recolhidas(), this.filtros()));

  private readonly sinteticas = computed(() => contasSinteticas(this.arvore()));
  private readonly opcoesPai = computed(() => this.sinteticas().map(opcaoContaContabil));

  protected readonly buscarPai = (termo: string) => of(filtrarOpcoes(this.opcoesPai(), termo));
  protected readonly resolverPai = (id: string) =>
    of(this.opcoesPai().find((opcao) => opcao.value === id) ?? { value: id, label: id });

  protected readonly naturezaDoTipo = computed(() => {
    const tipo = this.form().type;
    const natureza = tipo ? NATUREZA_POR_TIPO[tipo] : null;
    return natureza ? ROTULO_NATUREZA[natureza].toLowerCase() : '';
  });

  protected readonly problema = computed(() => {
    if (!this.tentouSalvar()) return null;
    // Na edição, código, tipo e pai já existem e não mudam.
    if (this.contaEditada()) {
      const nome = this.form().name.trim();
      return nome.length < 2 || nome.length > 255 ? 'O nome deve ter de 2 a 255 caracteres.' : null;
    }
    return problemaConta(this.form(), this.paiDoForm());
  });

  protected readonly podeCriar = () => this.permissoes.pode('ledger-accounts:CREATE');
  protected readonly podeEditar = () => this.permissoes.pode('ledger-accounts:UPDATE');
  protected readonly podeInativar = () => this.permissoes.pode('ledger-accounts:DELETE');

  constructor() {
    this.carregar();
  }

  protected alternar(id: string): void {
    this.recolhidas.update((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  protected expandirTudo(): void {
    this.recolhidas.set(new Set());
  }

  protected recolherTudo(): void {
    this.recolhidas.set(new Set(this.arvore().map((raiz) => raiz.id)));
  }

  protected abrirNova(pai: LedgerAccount | null): void {
    this.contaEditada.set(null);
    this.paiFixo.set(pai);
    this.abrir(formContaVazio(pai ?? undefined));
  }

  protected abrirEdicao(conta: LedgerAccount): void {
    this.contaEditada.set(conta);
    this.paiFixo.set(null);
    this.abrir(formDeConta(conta));
  }

  protected escolherPai(id: string): void {
    const pai = this.sinteticas().find((conta) => conta.id === id) ?? null;
    this.form.update((atual) => ({
      ...atual,
      parentId: id,
      // A filha herda o tipo do pai; o código parte do dele.
      type: pai?.type ?? atual.type,
      code: pai && !atual.code ? `${pai.code}.` : atual.code,
    }));
  }

  protected mudar<K extends keyof FormConta>(campo: K, valor: FormConta[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected salvar(): void {
    this.tentouSalvar.set(true);
    if (this.problema() || this.salvando()) return;

    const atual = this.contaEditada();
    if (atual) {
      const corpo = montarEdicaoConta(this.form(), atual);
      if (Object.keys(corpo).length === 0) {
        this.editando.set(false);
        return;
      }
      this.enviar(this.api.updateAccount(atual.id, corpo), `Conta ${atual.code} alterada.`);
    } else {
      const corpo = montarConta(this.form());
      this.enviar(this.api.createAccount(corpo), `Conta ${corpo.code} cadastrada.`);
    }
  }

  protected inativar(conta: LedgerAccount): void {
    if (this.inativando()) return;
    this.inativando.set(conta.id);
    this.erro.set(null);
    this.api
      .deactivateAccount(conta.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.inativando.set(null);
          this.aviso.set(`Conta ${conta.code} inativada. O histórico dela permanece no razão.`);
          this.carregar();
        },
        error: (falha: unknown) => {
          this.inativando.set(null);
          this.erro.set(falha);
        },
      });
  }

  protected tipo(conta: LedgerAccount): string {
    return ROTULO_TIPO_CONTA[conta.type] ?? conta.type;
  }

  protected grupo(conta: LedgerAccount): string {
    return ROTULO_GRUPO[grupoDaConta(conta.type)];
  }

  protected natureza(conta: LedgerAccount): string {
    return ROTULO_NATUREZA[conta.nature] ?? conta.nature;
  }

  private paiDoForm(): LedgerAccount | null {
    const id = this.form().parentId;
    if (!id) return null;
    return this.paiFixo() ?? this.sinteticas().find((conta) => conta.id === id) ?? null;
  }

  private abrir(form: FormConta): void {
    this.form.set(form);
    this.tentouSalvar.set(false);
    this.erroDialogo.set(null);
    this.editando.set(true);
  }

  private enviar(requisicao: ReturnType<AccountingApiService['createAccount']>, mensagem: string): void {
    this.salvando.set(true);
    this.erroDialogo.set(null);
    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvando.set(false);
        this.editando.set(false);
        this.aviso.set(mensagem);
        this.carregar();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroDialogo.set(falha);
      },
    });
  }

  private carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.api
      .tree()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (arvore) => {
          this.arvore.set(arvore);
          this.carregando.set(false);
        },
        error: (falha: unknown) => {
          this.arvore.set([]);
          this.erro.set(falha);
          this.carregando.set(false);
        },
      });
  }
}
