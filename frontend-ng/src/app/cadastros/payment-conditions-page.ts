import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { PaymentConditionsApiService } from '../core/api/payment-conditions-api.service';
import type {
  PaymentMethod,
  PaymentMethodInput,
  PaymentMethodType,
  PaymentTerm,
  PaymentTermInput,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { ListState } from '../core/lib/list-state';
import { FILTRO_SITUACAO, consultaPadrao } from '../admin/filtros';
import { Alert } from '../ui/alert';
import { ConfirmService } from '../ui/confirm.service';
import { DataTable, type Coluna } from '../ui/data-table';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { OPCOES_METODO, ROTULO_METODO, descricaoPrazo } from './rotulos';

type Secao = 'condicoes' | 'formas';

interface FormularioCondicao {
  code: string;
  name: string;
  installments: string;
  intervalDays: string;
  firstDueDays: string;
  discountPercent: string;
}

const CONDICAO_VAZIA: FormularioCondicao = {
  code: '',
  name: '',
  installments: '1',
  intervalDays: '30',
  firstDueDays: '30',
  discountPercent: '',
};

interface FormularioForma {
  code: string;
  name: string;
  method: string;
}

const FORMA_VAZIA: FormularioForma = { code: '', name: '', method: '' };

/** Inteiro do formulário para o corpo; vazio ou inválido não vai. */
function inteiro(valor: string): number | undefined {
  const limpo = valor.trim();
  return limpo !== '' && /^\d+$/.test(limpo) ? Number(limpo) : undefined;
}

/**
 * Condições e formas de pagamento (RF-026 — UI-019).
 *
 * Dois recursos na mesma tela, como no Figma: a condição define o prazo
 * (parcelas, intervalo, primeiro vencimento) e a forma define o meio de
 * liquidação. Só a seção visível é consultada.
 *
 * Nenhum dos dois é apagado: `DELETE` inativa, porque a condição continua
 * descrevendo os títulos que já foram gerados com ela.
 */
@Component({
  selector: 'sge-payment-conditions-page',
  imports: [
    FormsModule,
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
    <p class="crumb">Cadastros / Condições de pagamento</p>

    <div class="pagehead">
      <div>
        <h1>Condições e formas de pagamento</h1>
        <p>Prazos, parcelamentos e meios aceitos (RF-026).</p>
      </div>
      <div class="pagehead__actions">
        @if (secao() === 'condicoes' && podeCriarCondicao()) {
          <p-button label="Nova condição" icon="pi pi-plus" (onClick)="abrirNovaCondicao()" />
        }
        @if (secao() === 'formas' && podeCriarForma()) {
          <p-button label="Nova forma" icon="pi pi-plus" (onClick)="abrirNovaForma()" />
        }
      </div>
    </div>

    <nav class="secoes" aria-label="Recurso de pagamento">
      @if (podeVerCondicoes()) {
        <button
          type="button"
          class="secoes__item"
          [class.secoes__item--ativa]="secao() === 'condicoes'"
          (click)="trocar('condicoes')"
        >
          Condições
        </button>
      }
      @if (podeVerFormas()) {
        <button
          type="button"
          class="secoes__item"
          [class.secoes__item--ativa]="secao() === 'formas'"
          (click)="trocar('formas')"
        >
          Formas de pagamento
        </button>
      }
    </nav>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    @if (secao() === 'condicoes') {
      <sge-filter-bar
        placeholderBusca="Buscar condição por nome ou código"
        [valores]="condicoes.filtros()"
        [filtros]="[FILTRO_SITUACAO]"
        (mudou)="condicoes.aplicarFiltros($event)"
      />

      @if (condicoes.erro(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }

      <section class="card table-card espaco">
        <sge-data-table
          [colunas]="colunasCondicao"
          [linhas]="condicoes.linhas()"
          [total]="condicoes.total()"
          [pagina]="condicoes.pagina()"
          [tamanhoPagina]="condicoes.tamanhoPagina()"
          [carregando]="condicoes.carregando()"
          mensagemVazia="Nenhuma condição cadastrada."
          (paginaMudou)="condicoes.irParaPagina($event.page, $event.pageSize)"
        >
          <ng-template #linha let-condicao>
            <tr>
              <td>{{ condicao.code }}</td>
              <td>{{ condicao.name }}</td>
              <td>{{ condicao.installments }}</td>
              <td>{{ condicao.installments > 1 ? condicao.intervalDays + ' dias' : '—' }}</td>
              <td>{{ prazo(condicao) }}</td>
              <td>
                <p-tag
                  [value]="condicao.isActive ? 'Ativa' : 'Inativa'"
                  [severity]="condicao.isActive ? 'success' : 'secondary'"
                  [rounded]="true"
                />
              </td>
              <td class="acoes">
                @if (podeEditarCondicao()) {
                  <p-button
                    label="Editar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="abrirEdicaoCondicao(condicao)"
                  />
                }
                @if (podeInativarCondicao() && condicao.isActive) {
                  <p-button
                    label="Inativar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="inativarCondicao(condicao)"
                  />
                }
              </td>
            </tr>
          </ng-template>
        </sge-data-table>
      </section>
    } @else {
      <sge-filter-bar
        placeholderBusca="Buscar forma por nome ou código"
        [valores]="formas.filtros()"
        [filtros]="[FILTRO_SITUACAO]"
        (mudou)="formas.aplicarFiltros($event)"
      />

      @if (formas.erro(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }

      <section class="card table-card espaco">
        <sge-data-table
          [colunas]="colunasForma"
          [linhas]="formas.linhas()"
          [total]="formas.total()"
          [pagina]="formas.pagina()"
          [tamanhoPagina]="formas.tamanhoPagina()"
          [carregando]="formas.carregando()"
          mensagemVazia="Nenhuma forma cadastrada."
          (paginaMudou)="formas.irParaPagina($event.page, $event.pageSize)"
        >
          <ng-template #linha let-forma>
            <tr>
              <td>{{ forma.code }}</td>
              <td>{{ forma.name }}</td>
              <td>{{ metodo(forma) }}</td>
              <td>
                <p-tag
                  [value]="forma.isActive ? 'Ativa' : 'Inativa'"
                  [severity]="forma.isActive ? 'success' : 'secondary'"
                  [rounded]="true"
                />
              </td>
              <td class="acoes">
                @if (podeEditarForma()) {
                  <p-button
                    label="Editar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="abrirEdicaoForma(forma)"
                  />
                }
                @if (podeInativarForma() && forma.isActive) {
                  <p-button
                    label="Inativar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="inativarForma(forma)"
                  />
                }
              </td>
            </tr>
          </ng-template>
        </sge-data-table>
      </section>
    }

    <p-dialog
      [visible]="condicaoAberta()"
      (visibleChange)="condicaoAberta.set($event)"
      [modal]="true"
      [style]="{ width: '42rem' }"
      [header]="condicaoEmEdicao() ? 'Editar condição' : 'Nova condição'"
    >
      @if (erroCondicao(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvarCondicao()">
        <sge-text-field
          rotulo="Código"
          name="code"
          [obrigatorio]="true"
          [ngModel]="formCondicao().code"
          (ngModelChange)="mudarCondicao('code', $event)"
        />
        <sge-text-field
          rotulo="Descrição"
          name="name"
          [obrigatorio]="true"
          [ngModel]="formCondicao().name"
          (ngModelChange)="mudarCondicao('name', $event)"
        />
        <sge-text-field
          rotulo="Parcelas"
          name="installments"
          tipo="number"
          dica="1 = pagamento único"
          [ngModel]="formCondicao().installments"
          (ngModelChange)="mudarCondicao('installments', $event)"
        />
        <sge-text-field
          rotulo="Intervalo entre parcelas"
          name="intervalDays"
          tipo="number"
          dica="Em dias"
          [ngModel]="formCondicao().intervalDays"
          (ngModelChange)="mudarCondicao('intervalDays', $event)"
        />
        <sge-text-field
          rotulo="Primeiro vencimento"
          name="firstDueDays"
          tipo="number"
          dica="Dias após a emissão; 0 = à vista"
          [ngModel]="formCondicao().firstDueDays"
          (ngModelChange)="mudarCondicao('firstDueDays', $event)"
        />
        <sge-decimal-field
          rotulo="Desconto da condição (%)"
          name="discountPercent"
          [casas]="6"
          [ngModel]="formCondicao().discountPercent"
          (ngModelChange)="mudarCondicao('discountPercent', $event ?? '')"
        />
      </form>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="condicaoAberta.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvandoCondicao()"
          [disabled]="salvandoCondicao()"
          (onClick)="salvarCondicao()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="formaAberta()"
      (visibleChange)="formaAberta.set($event)"
      [modal]="true"
      [style]="{ width: '38rem' }"
      [header]="formaEmEdicao() ? 'Editar forma' : 'Nova forma'"
    >
      @if (erroForma(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvarForma()">
        <sge-text-field
          rotulo="Código"
          name="formaCode"
          [obrigatorio]="true"
          [ngModel]="formForma().code"
          (ngModelChange)="mudarForma('code', $event)"
        />
        <sge-text-field
          rotulo="Nome"
          name="formaName"
          [obrigatorio]="true"
          [ngModel]="formForma().name"
          (ngModelChange)="mudarForma('name', $event)"
        />
        <sge-select-field
          rotulo="Meio de liquidação"
          name="method"
          [opcoes]="OPCOES_METODO"
          [obrigatorio]="true"
          [ngModel]="formForma().method"
          (ngModelChange)="mudarForma('method', $event ?? '')"
        />
      </form>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="formaAberta.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvandoForma()"
          [disabled]="salvandoForma()"
          (onClick)="salvarForma()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .secoes {
      display: flex;
      gap: 0.25rem;
      margin-bottom: 0.75rem;
    }
    .secoes__item {
      padding: 0.35rem 0.75rem;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--p-text-muted-color);
      background: transparent;
      border: 1px solid var(--p-content-border-color);
      border-radius: var(--p-content-border-radius);
      cursor: pointer;
    }
    .secoes__item--ativa {
      color: var(--p-primary-color);
      border-color: var(--p-primary-color);
    }
    .formulario {
      padding-top: 0.5rem;
    }
  `,
})
export class PaymentConditionsPage {
  private readonly api = inject(PaymentConditionsApiService);
  private readonly confirmacao = inject(ConfirmService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_SITUACAO = FILTRO_SITUACAO;
  protected readonly OPCOES_METODO = OPCOES_METODO;

  protected readonly colunasCondicao: Coluna[] = [
    { campo: 'code', cabecalho: 'Código', largura: '8rem' },
    { campo: 'name', cabecalho: 'Descrição' },
    { campo: 'installments', cabecalho: 'Parcelas', largura: '7rem' },
    { campo: 'intervalDays', cabecalho: 'Intervalo', largura: '8rem' },
    { campo: 'firstDueDays', cabecalho: 'Primeiro vencimento', largura: '16rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly colunasForma: Coluna[] = [
    { campo: 'code', cabecalho: 'Código', largura: '8rem' },
    { campo: 'name', cabecalho: 'Nome' },
    { campo: 'method', cabecalho: 'Meio de liquidação', largura: '14rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly condicoes = new ListState<PaymentTerm>(
    (consulta) => this.api.listTerms(consulta),
    consultaPadrao,
  );

  protected readonly formas = new ListState<PaymentMethod>(
    (consulta) => this.api.listMethods(consulta),
    consultaPadrao,
  );

  protected readonly secao = signal<Secao>('condicoes');
  protected readonly aviso = signal<string | null>(null);

  protected readonly condicaoAberta = signal(false);
  protected readonly condicaoEmEdicao = signal<PaymentTerm | null>(null);
  protected readonly formCondicao = signal<FormularioCondicao>({ ...CONDICAO_VAZIA });
  protected readonly salvandoCondicao = signal(false);
  protected readonly erroCondicao = signal<unknown>(null);

  protected readonly formaAberta = signal(false);
  protected readonly formaEmEdicao = signal<PaymentMethod | null>(null);
  protected readonly formForma = signal<FormularioForma>({ ...FORMA_VAZIA });
  protected readonly salvandoForma = signal(false);
  protected readonly erroForma = signal<unknown>(null);

  protected readonly podeVerCondicoes = () => this.permissoes.pode('payment-terms:READ');
  protected readonly podeCriarCondicao = () => this.permissoes.pode('payment-terms:CREATE');
  protected readonly podeEditarCondicao = () => this.permissoes.pode('payment-terms:UPDATE');
  protected readonly podeInativarCondicao = () => this.permissoes.pode('payment-terms:DELETE');
  protected readonly podeVerFormas = () => this.permissoes.pode('payment-methods:READ');
  protected readonly podeCriarForma = () => this.permissoes.pode('payment-methods:CREATE');
  protected readonly podeEditarForma = () => this.permissoes.pode('payment-methods:UPDATE');
  protected readonly podeInativarForma = () => this.permissoes.pode('payment-methods:DELETE');

  constructor() {
    // Abre na seção que o perfil consegue ler.
    if (!this.podeVerCondicoes()) this.secao.set('formas');
    this.carregarSecao();
  }

  protected trocar(secao: Secao): void {
    if (this.secao() === secao) return;
    this.secao.set(secao);
    this.aviso.set(null);
    this.carregarSecao();
  }

  protected prazo(condicao: PaymentTerm): string {
    return descricaoPrazo(condicao);
  }

  protected metodo(forma: PaymentMethod): string {
    return ROTULO_METODO[forma.method] ?? forma.method;
  }

  protected mudarCondicao<K extends keyof FormularioCondicao>(
    campo: K,
    valor: FormularioCondicao[K],
  ): void {
    this.formCondicao.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarForma<K extends keyof FormularioForma>(campo: K, valor: FormularioForma[K]): void {
    this.formForma.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrirNovaCondicao(): void {
    this.condicaoEmEdicao.set(null);
    this.formCondicao.set({ ...CONDICAO_VAZIA });
    this.erroCondicao.set(null);
    this.condicaoAberta.set(true);
  }

  protected abrirEdicaoCondicao(condicao: PaymentTerm): void {
    this.condicaoEmEdicao.set(condicao);
    this.erroCondicao.set(null);
    this.formCondicao.set({
      code: condicao.code,
      name: condicao.name,
      installments: String(condicao.installments),
      intervalDays: String(condicao.intervalDays),
      firstDueDays: String(condicao.firstDueDays),
      discountPercent: condicao.discountPercent,
    });
    this.condicaoAberta.set(true);
  }

  protected salvarCondicao(): void {
    if (this.salvandoCondicao()) return;
    this.salvandoCondicao.set(true);
    this.erroCondicao.set(null);

    const form = this.formCondicao();
    const corpo: Partial<PaymentTermInput> = { code: form.code.trim(), name: form.name.trim() };
    const parcelas = inteiro(form.installments);
    const intervalo = inteiro(form.intervalDays);
    const primeiro = inteiro(form.firstDueDays);
    if (parcelas !== undefined) corpo.installments = parcelas;
    if (intervalo !== undefined) corpo.intervalDays = intervalo;
    // `0` é à vista e precisa ser enviado — por isso a checagem é por undefined.
    if (primeiro !== undefined) corpo.firstDueDays = primeiro;
    if (form.discountPercent.trim() !== '') corpo.discountPercent = form.discountPercent;

    const alvo = this.condicaoEmEdicao();
    const requisicao = alvo
      ? this.api.updateTerm(alvo.id, corpo)
      : this.api.createTerm(corpo as PaymentTermInput);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvandoCondicao.set(false);
        this.condicaoAberta.set(false);
        this.aviso.set(alvo ? 'Condição atualizada.' : 'Condição cadastrada.');
        this.condicoes.carregar();
      },
      error: (falha: unknown) => {
        this.salvandoCondicao.set(false);
        this.erroCondicao.set(falha);
      },
    });
  }

  protected async inativarCondicao(condicao: PaymentTerm): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Inativar condição de pagamento?',
      mensagem:
        'A condição deixa de ser oferecida em novos títulos. Os títulos já emitidos com ela não mudam.',
      rotuloConfirmar: 'Inativar',
      destrutivo: true,
    });
    if (!confirmado) return;

    this.api
      .inactivateTerm(condicao.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Condição ${condicao.name} inativada.`);
          this.condicoes.carregar();
        },
        error: (falha: unknown) => this.condicoes.erro.set(falha),
      });
  }

  protected abrirNovaForma(): void {
    this.formaEmEdicao.set(null);
    this.formForma.set({ ...FORMA_VAZIA });
    this.erroForma.set(null);
    this.formaAberta.set(true);
  }

  protected abrirEdicaoForma(forma: PaymentMethod): void {
    this.formaEmEdicao.set(forma);
    this.erroForma.set(null);
    this.formForma.set({ code: forma.code, name: forma.name, method: forma.method });
    this.formaAberta.set(true);
  }

  protected salvarForma(): void {
    if (this.salvandoForma()) return;
    this.salvandoForma.set(true);
    this.erroForma.set(null);

    const form = this.formForma();
    const corpo: PaymentMethodInput = {
      code: form.code.trim(),
      name: form.name.trim(),
      method: form.method as PaymentMethodType,
    };

    const alvo = this.formaEmEdicao();
    const requisicao = alvo ? this.api.updateMethod(alvo.id, corpo) : this.api.createMethod(corpo);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvandoForma.set(false);
        this.formaAberta.set(false);
        this.aviso.set(alvo ? 'Forma atualizada.' : 'Forma cadastrada.');
        this.formas.carregar();
      },
      error: (falha: unknown) => {
        this.salvandoForma.set(false);
        this.erroForma.set(falha);
      },
    });
  }

  protected async inativarForma(forma: PaymentMethod): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Inativar forma de pagamento?',
      mensagem:
        'A forma deixa de ser oferecida em novas baixas e ordens. As já registradas não mudam.',
      rotuloConfirmar: 'Inativar',
      destrutivo: true,
    });
    if (!confirmado) return;

    this.api
      .inactivateMethod(forma.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Forma ${forma.name} inativada.`);
          this.formas.carregar();
        },
        error: (falha: unknown) => this.formas.erro.set(falha),
      });
  }

  /** Só a listagem visível é consultada — a outra espera o clique na seção. */
  private carregarSecao(): void {
    if (this.secao() === 'condicoes') this.condicoes.carregar();
    else this.formas.carregar();
  }
}
