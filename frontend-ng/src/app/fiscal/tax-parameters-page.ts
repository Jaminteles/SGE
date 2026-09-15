import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { BranchesApiService } from '../core/api/branches-api.service';
import { FiscalApiService } from '../core/api/fiscal-api.service';
import type { Branch, TaxParameter } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatDate } from '../core/lib/format';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { hoje } from '../financeiro/dinheiro';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  type FormParametro,
  OPCOES_REGIME,
  ROTULO_REGIME,
  formParametroDe,
  formParametroVazio,
  formatarPercentual,
  montarEdicaoParametro,
  montarParametro,
  problemaParametro,
  vigente,
} from './tributos';

/**
 * Parâmetros fiscais da empresa (RF-088 — UI-061).
 *
 * O parâmetro responde uma pergunta só: **qual era o regime tributário desta
 * empresa naquela data**. Daí o que a tela mostra em primeiro plano ser a
 * vigência, e não o cadastro: duas linhas cobrindo a mesma data dariam duas
 * respostas à mesma pergunta, e o banco recusa a sobreposição (bd/18 §2).
 *
 * Encerrar não apaga: fecha a vigência de hoje em diante e o histórico
 * permanece, porque a apuração de um mês passado precisa continuar respondendo
 * com o regime que valia naquele mês.
 */
@Component({
  selector: 'sge-tax-parameters-page',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    TagModule,
    Alert,
    ErrorAlert,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Fiscal / Parâmetros</p>

    <div class="pagehead">
      <div>
        <h1>Parâmetros fiscais</h1>
        <p>Regime tributário e alíquotas vigentes por empresa e filial (RF-088).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Novo parâmetro" icon="pi pi-plus" (onClick)="abrirNovo()" />
        }
      </div>
    </div>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }
    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (!carregando() && semVigente()) {
      <div class="espaco">
        <sge-alert
          tom="aviso"
          titulo="Nenhum parâmetro vigente hoje"
          mensagem="Sem regime tributário vigente a apuração fiscal não sabe que alíquotas aplicar."
        />
      </div>
    }

    <section class="card espaco">
      <div class="tabela-rolagem">
        <table class="tabela">
          <thead>
            <tr>
              <th>Abrangência</th>
              <th>Regime</th>
              <th>Vigência</th>
              <th class="numero">Simples</th>
              <th class="numero">ISS</th>
              <th>Marcações</th>
              @if (podeEncerrar() || podeEditar()) {
                <th class="coluna-acoes">Ações</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (item of itens(); track item.id) {
              <tr>
                <td>{{ abrangencia(item) }}</td>
                <td>
                  {{ rotuloRegime(item) }}
                  @if (vigenteHoje(item)) {
                    <p-tag value="Vigente" severity="success" [rounded]="true" />
                  }
                </td>
                <td>
                  {{ formatarData(item.effectiveFrom) }} —
                  {{ item.effectiveTo ? formatarData(item.effectiveTo) : 'indeterminado' }}
                </td>
                <td class="numero">{{ percentual(item.simplesRate) }}</td>
                <td class="numero">{{ percentual(item.issRate) }}</td>
                <td>
                  @if (item.ipiTaxpayer) {
                    <p-tag value="Contribuinte de IPI" severity="info" [rounded]="true" />
                  }
                  @if (item.taxSubstitute) {
                    <p-tag value="Substituto tributário" severity="info" [rounded]="true" />
                  }
                </td>
                @if (podeEncerrar() || podeEditar()) {
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
                    @if (podeEncerrar() && !item.effectiveTo) {
                      <p-button
                        label="Encerrar"
                        size="small"
                        severity="danger"
                        [text]="true"
                        [disabled]="!!encerrando()"
                        [loading]="encerrando() === item.id"
                        (onClick)="encerrar(item)"
                      />
                    }
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td colspan="7" class="vazio">
                  @if (carregando()) {
                    Carregando…
                  } @else {
                    Nenhum parâmetro fiscal cadastrado.
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
      [style]="{ width: '40rem' }"
      [header]="form().id ? 'Editar parâmetro fiscal' : 'Novo parâmetro fiscal'"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <div class="grade-campos">
        <sge-select-field
          rotulo="Abrangência"
          placeholder="Toda a empresa"
          dica="O parâmetro da filial tem precedência sobre o da empresa."
          [opcoes]="opcoesFilial()"
          [disabled]="!!form().id"
          [ngModel]="form().branchId || null"
          (ngModelChange)="mudar('branchId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Regime tributário"
          [obrigatorio]="true"
          [opcoes]="opcoesRegime"
          [ngModel]="form().taxRegime"
          (ngModelChange)="mudar('taxRegime', $event ?? 'SIMPLES_NACIONAL')"
        />
        <sge-text-field
          rotulo="Início da vigência"
          tipo="date"
          [obrigatorio]="true"
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
        @if (form().taxRegime === 'SIMPLES_NACIONAL') {
          <sge-text-field
            rotulo="Alíquota do Simples (%)"
            dica="Até 6 casas decimais."
            [ngModel]="form().simplesRate"
            (ngModelChange)="mudar('simplesRate', $event ?? '')"
          />
        }
        <sge-text-field
          rotulo="Alíquota de ISS (%)"
          [ngModel]="form().issRate"
          (ngModelChange)="mudar('issRate', $event ?? '')"
        />
      </div>

      <label class="marcador">
        <p-checkbox
          [binary]="true"
          [ngModel]="form().ipiTaxpayer"
          (ngModelChange)="mudar('ipiTaxpayer', $event)"
        />
        Contribuinte de IPI
      </label>
      <label class="marcador">
        <p-checkbox
          [binary]="true"
          [ngModel]="form().taxSubstitute"
          (ngModelChange)="mudar('taxSubstitute', $event)"
        />
        Substituto tributário
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
  `,
  styles: [
    ESTILO_TABELA,
    `
      .coluna-acoes {
        white-space: nowrap;
        text-align: right;
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
export class TaxParametersPage {
  private readonly api = inject(FiscalApiService);
  private readonly filiais = inject(BranchesApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly opcoesRegime = OPCOES_REGIME;
  protected readonly formatarData = formatDate;
  protected readonly percentual = formatarPercentual;

  private readonly referencia = hoje();

  protected readonly itens = signal<TaxParameter[]>([]);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly editando = signal(false);
  protected readonly salvando = signal(false);
  protected readonly encerrando = signal<string | null>(null);
  protected readonly erroDialogo = signal<unknown>(null);
  protected readonly form = signal<FormParametro>(formParametroVazio(this.referencia));
  private readonly original = signal<TaxParameter | null>(null);

  private readonly listaFiliais = signal<Branch[]>([]);
  protected readonly opcoesFilial = computed<OpcaoFiltro[]>(() =>
    this.listaFiliais().map((filial) => ({
      value: filial.id,
      label: `${filial.code} — ${filial.name}`,
    })),
  );

  protected readonly problema = computed(() => problemaParametro(this.form()));
  protected readonly semVigente = computed(
    () => this.itens().length > 0 && !this.itens().some((item) => vigente(item, this.referencia)),
  );

  protected readonly podeCriar = () => this.permissoes.pode('tax-parameters:CREATE');
  protected readonly podeEditar = () => this.permissoes.pode('tax-parameters:UPDATE');
  protected readonly podeEncerrar = () => this.permissoes.pode('tax-parameters:DELETE');

  constructor() {
    this.carregar();
    if (this.permissoes.pode('branches:READ')) {
      this.filiais
        .list({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (pagina) => this.listaFiliais.set(pagina.data),
          error: () => this.listaFiliais.set([]),
        });
    }
  }

  protected abrangencia(item: TaxParameter): string {
    if (!item.branchId) return 'Toda a empresa';
    const filial = this.listaFiliais().find((linha) => linha.id === item.branchId);
    return filial ? `${filial.code} — ${filial.name}` : 'Filial específica';
  }

  protected rotuloRegime(item: TaxParameter): string {
    return ROTULO_REGIME[item.taxRegime];
  }

  protected vigenteHoje(item: TaxParameter): boolean {
    return vigente(item, this.referencia);
  }

  protected abrirNovo(): void {
    this.original.set(null);
    this.form.set(formParametroVazio(this.referencia));
    this.erroDialogo.set(null);
    this.editando.set(true);
  }

  protected abrirEdicao(item: TaxParameter): void {
    this.original.set(item);
    this.form.set(formParametroDe(item));
    this.erroDialogo.set(null);
    this.editando.set(true);
  }

  protected mudar<K extends keyof FormParametro>(campo: K, valor: FormParametro[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected salvar(): void {
    if (this.salvando() || this.problema()) return;
    const form = this.form();
    const atual = this.original();

    this.salvando.set(true);
    this.erroDialogo.set(null);

    const requisicao = atual
      ? this.api.updateParameter(atual.id, montarEdicaoParametro(form, atual))
      : this.api.createParameter(montarParametro(form));

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvando.set(false);
        this.editando.set(false);
        this.aviso.set(atual ? 'Parâmetro fiscal atualizado.' : 'Parâmetro fiscal cadastrado.');
        this.carregar();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroDialogo.set(falha);
      },
    });
  }

  /** Encerra a vigência hoje. O histórico permanece: a apuração antiga depende dele. */
  protected encerrar(item: TaxParameter): void {
    if (this.encerrando()) return;
    this.encerrando.set(item.id);
    this.erro.set(null);
    this.api
      .closeParameter(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.encerrando.set(null);
          this.aviso.set('Vigência encerrada. O parâmetro permanece no histórico.');
          this.carregar();
        },
        error: (falha: unknown) => {
          this.encerrando.set(null);
          this.erro.set(falha);
        },
      });
  }

  private carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.api
      .listParameters({ pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pagina) => {
          this.itens.set(pagina.data);
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
