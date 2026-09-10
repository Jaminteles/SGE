import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { map } from 'rxjs';

import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import { FinanceApiService } from '../core/api/finance-api.service';
import { PartnersApiService } from '../core/api/partners-api.service';
import { PaymentConditionsApiService } from '../core/api/payment-conditions-api.service';
import type {
  Category,
  CategoryClassification,
  CostCenter,
  EntryType,
  FinancialEntry,
  FinancialEntryInput,
  FinancialEntryUpdateInput,
  PaymentTerm,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { Alert } from '../ui/alert';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { LIMITE_BUSCA, SearchSelect } from '../ui/search-select';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  adicionarDias,
  comparar,
  dataValida,
  hoje,
  paraCentavos,
  planejarParcelas,
  somar,
  subtrair,
  type ParcelaPlanejada,
} from './dinheiro';
import { OPCOES_TIPO, ROTULO_TIPO } from './rotulos';

/** De onde saem as parcelas (RF-053) — espelha a precedência do backend. */
type ModoParcelamento = 'UNICA' | 'SIMPLES' | 'CONDICAO' | 'MANUAL';

const OPCOES_MODO: OpcaoFiltro[] = [
  { value: 'UNICA', label: 'Parcela única' },
  { value: 'SIMPLES', label: 'Parcelas iguais' },
  { value: 'CONDICAO', label: 'Condição de pagamento' },
  { value: 'MANUAL', label: 'Parcelas informadas' },
];

interface Formulario {
  type: EntryType;
  partnerId: string;
  description: string;
  documentReference: string;
  issueDate: string;
  competenceDate: string;
  grossAmount: string | null;
  discountAmount: string | null;
  categoryId: string;
  costCenterId: string;
  paymentMethodId: string;
  note: string;
  modo: ModoParcelamento;
  paymentTermId: string;
  installmentCount: string;
  firstDueDate: string;
  intervalDays: string;
  dailyInterestRate: string | null;
  penaltyRate: string | null;
}

interface LinhaParcela {
  dueDate: string;
  amount: string | null;
}

function formularioVazio(): Formulario {
  const emissao = hoje();
  return {
    type: 'PAGAR',
    partnerId: '',
    description: '',
    documentReference: '',
    issueDate: emissao,
    competenceDate: emissao,
    grossAmount: null,
    discountAmount: null,
    categoryId: '',
    costCenterId: '',
    paymentMethodId: '',
    note: '',
    modo: 'UNICA',
    paymentTermId: '',
    installmentCount: '2',
    firstDueDate: adicionarDias(emissao, 30),
    intervalDays: '30',
    dailyInterestRate: null,
    penaltyRate: null,
  };
}

function inteiro(texto: string): number | null {
  return /^\d+$/.test(texto.trim()) ? Number.parseInt(texto.trim(), 10) : null;
}

/** Só o que tem conteúdo vai para o DTO: campo em branco não é "apagar". */
function texto(valor: string): string | undefined {
  const limpo = valor.trim();
  return limpo === '' ? undefined : limpo;
}

/**
 * Lançamento e edição de título (RF-051 a RF-054 — UI-024/UI-025).
 *
 * A tela mostra uma **prévia** do parcelamento, calculada em centavos
 * `bigint` com a mesma regra do backend (o resto vai para a última parcela).
 * Quem decide as parcelas é o servidor: o DTO leva só a regra (quantidade,
 * vencimento e intervalo, ou a condição), exceto no modo "parcelas
 * informadas", em que a lista é do usuário e precisa somar o valor líquido.
 *
 * A conta contábil não é digitada: é herdada da categoria (RF-054/RF-080) e
 * exibida aqui para quem pode consultar a classificação.
 */
@Component({
  selector: 'sge-entry-form-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    Alert,
    DecimalField,
    ErrorAlert,
    SearchSelect,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Financeiro / Contas a pagar e receber / {{ titulo() }}</p>

    <div class="pagehead">
      <div>
        <h1>{{ titulo() }}</h1>
        <p>{{ subtitulo() }}</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          [routerLink]="edicao ? ['/financeiro/titulos', entryId] : '/financeiro/titulos'"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando() || carregando() || problemas().length > 0"
          (onClick)="salvar()"
        />
      </div>
    </div>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (tentouSalvar() && problemas().length > 0) {
      <div class="espaco">
        <sge-alert tom="aviso" titulo="Revise o lançamento" [detalhes]="problemas()" />
      </div>
    }

    <section class="card secao espaco">
      <h2 class="secao__titulo">Identificação</h2>
      <div class="grade-campos">
        <sge-select-field
          rotulo="Carteira"
          name="type"
          [opcoes]="opcoesTipo"
          [obrigatorio]="true"
          [disabled]="edicao"
          [ngModel]="form().type"
          (ngModelChange)="mudarTipo($event)"
        />
        @if (edicao) {
          <sge-text-field
            rotulo="Contraparte"
            name="contraparte"
            dica="A contraparte não muda: trocar é emitir outro título"
            [disabled]="true"
            [ngModel]="nomeContraparte()"
          />
        } @else {
          <sge-search-select
            [rotulo]="form().type === 'PAGAR' ? 'Fornecedor' : 'Cliente'"
            name="partnerId"
            [buscar]="buscarParceiro"
            [obrigatorio]="true"
            [ngModel]="form().partnerId || null"
            (ngModelChange)="mudar('partnerId', $event ?? '')"
          />
        }
        <sge-text-field
          rotulo="Descrição"
          name="description"
          [obrigatorio]="true"
          [ngModel]="form().description"
          (ngModelChange)="mudar('description', $event)"
        />
        <sge-text-field
          rotulo="Documento de origem"
          name="documentReference"
          dica="NF, contrato ou outro documento"
          [ngModel]="form().documentReference"
          (ngModelChange)="mudar('documentReference', $event)"
        />
        <sge-text-field
          rotulo="Emissão"
          name="issueDate"
          tipo="date"
          [disabled]="edicao"
          [ngModel]="form().issueDate"
          (ngModelChange)="mudar('issueDate', $event)"
        />
        <sge-text-field
          rotulo="Competência"
          name="competenceDate"
          tipo="date"
          [ngModel]="form().competenceDate"
          (ngModelChange)="mudar('competenceDate', $event)"
        />
      </div>
    </section>

    <section class="card secao espaco">
      <h2 class="secao__titulo">Valores</h2>
      @if (valoresTravados()) {
        <sge-alert
          tom="info"
          titulo="O título já tem baixa"
          mensagem="Valor bruto e desconto só mudam enquanto nada foi liquidado (RF-053)."
        />
      }
      <div class="grade-campos">
        <sge-decimal-field
          rotulo="Valor bruto"
          name="grossAmount"
          [obrigatorio]="true"
          [disabled]="valoresTravados()"
          [ngModel]="form().grossAmount"
          (ngModelChange)="mudar('grossAmount', $event)"
        />
        <sge-decimal-field
          rotulo="Desconto na emissão"
          name="discountAmount"
          [disabled]="valoresTravados()"
          [ngModel]="form().discountAmount"
          (ngModelChange)="mudar('discountAmount', $event)"
        />
        <div class="campo">
          <span class="campo__rotulo">Valor líquido</span>
          <strong class="liquido">{{ moeda(liquido()) }}</strong>
        </div>
      </div>
    </section>

    <section class="card secao espaco">
      <h2 class="secao__titulo">Classificação (RF-054)</h2>
      <div class="grade-campos">
        <sge-select-field
          rotulo="Categoria financeira"
          name="categoryId"
          [opcoes]="opcoesCategoria()"
          [dica]="dicaCategoria()"
          [ngModel]="form().categoryId || null"
          (ngModelChange)="mudar('categoryId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Centro de custo"
          name="costCenterId"
          [opcoes]="opcoesCentro()"
          [dica]="podeLerCentros() ? '' : 'Sem permissão para listar centros de custo'"
          [ngModel]="form().costCenterId || null"
          (ngModelChange)="mudar('costCenterId', $event ?? '')"
        />
        <div class="campo">
          <span class="campo__rotulo">Conta contábil</span>
          <span class="conta" [class.conta--ausente]="contaContabil().ausente">
            {{ contaContabil().texto }}
          </span>
          <span class="campo__dica">Herdada da categoria — não é digitada no título</span>
        </div>
        <sge-select-field
          rotulo="Forma de pagamento"
          name="paymentMethodId"
          [opcoes]="opcoesForma()"
          [ngModel]="form().paymentMethodId || null"
          (ngModelChange)="mudar('paymentMethodId', $event ?? '')"
        />
      </div>
    </section>

    @if (!edicao) {
      <section class="card secao espaco">
        <h2 class="secao__titulo">Parcelamento (RF-053)</h2>
        <div class="grade-campos">
          <sge-select-field
            rotulo="Parcelas"
            name="modo"
            [opcoes]="opcoesModo"
            [ngModel]="form().modo"
            (ngModelChange)="mudar('modo', $event ?? 'UNICA')"
          />
          @switch (form().modo) {
            @case ('UNICA') {
              <sge-text-field
                rotulo="Vencimento"
                name="firstDueDate"
                tipo="date"
                [obrigatorio]="true"
                [ngModel]="form().firstDueDate"
                (ngModelChange)="mudar('firstDueDate', $event)"
              />
            }
            @case ('SIMPLES') {
              <sge-text-field
                rotulo="Quantidade de parcelas"
                name="installmentCount"
                tipo="number"
                [obrigatorio]="true"
                [ngModel]="form().installmentCount"
                (ngModelChange)="mudar('installmentCount', '' + ($event ?? ''))"
              />
              <sge-text-field
                rotulo="1º vencimento"
                name="firstDueDate"
                tipo="date"
                [obrigatorio]="true"
                [ngModel]="form().firstDueDate"
                (ngModelChange)="mudar('firstDueDate', $event)"
              />
              <sge-text-field
                rotulo="Intervalo (dias)"
                name="intervalDays"
                tipo="number"
                [obrigatorio]="true"
                [ngModel]="form().intervalDays"
                (ngModelChange)="mudar('intervalDays', '' + ($event ?? ''))"
              />
            }
            @case ('CONDICAO') {
              <sge-select-field
                rotulo="Condição de pagamento"
                name="paymentTermId"
                [opcoes]="opcoesCondicao()"
                [obrigatorio]="true"
                [ngModel]="form().paymentTermId || null"
                (ngModelChange)="mudar('paymentTermId', $event ?? '')"
              />
            }
          }
          <sge-decimal-field
            rotulo="Juros de mora ao dia (%)"
            name="dailyInterestRate"
            [casas]="6"
            [ngModel]="form().dailyInterestRate"
            (ngModelChange)="mudar('dailyInterestRate', $event)"
          />
          <sge-decimal-field
            rotulo="Multa por atraso (%)"
            name="penaltyRate"
            [casas]="6"
            [ngModel]="form().penaltyRate"
            (ngModelChange)="mudar('penaltyRate', $event)"
          />
        </div>

        @if (form().modo === 'MANUAL') {
          <table class="parcelas">
            <thead>
              <tr>
                <th scope="col">Nº</th>
                <th scope="col">Vencimento</th>
                <th scope="col">Valor</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              @for (linha of linhas(); track $index) {
                <tr>
                  <td>{{ $index + 1 }}</td>
                  <td>
                    <sge-text-field
                      rotulo="Vencimento"
                      [name]="'venc-' + $index"
                      tipo="date"
                      [ngModel]="linha.dueDate"
                      (ngModelChange)="mudarLinha($index, 'dueDate', $event)"
                    />
                  </td>
                  <td>
                    <sge-decimal-field
                      rotulo="Valor"
                      [name]="'valor-' + $index"
                      [ngModel]="linha.amount"
                      (ngModelChange)="mudarLinha($index, 'amount', $event)"
                    />
                  </td>
                  <td class="acoes">
                    <p-button
                      icon="pi pi-trash"
                      severity="danger"
                      [text]="true"
                      size="small"
                      ariaLabel="Remover parcela"
                      [disabled]="linhas().length === 1"
                      (onClick)="removerLinha($index)"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <div class="rodape-parcelas">
            <p-button
              label="Adicionar parcela"
              icon="pi pi-plus"
              severity="secondary"
              [outlined]="true"
              size="small"
              [disabled]="linhas().length >= 360"
              (onClick)="adicionarLinha()"
            />
            <span [class.divergente]="diferencaManual() !== '0.00'">
              Soma {{ moeda(somaManual()) }} de {{ moeda(liquido()) }}
              @if (diferencaManual() !== '0.00') {
                — diferença {{ moeda(diferencaManual()) }}
              }
            </span>
          </div>
        } @else if (previa().length > 0) {
          <table class="parcelas">
            <caption>
              Prévia — o parcelamento oficial é gerado pelo servidor
            </caption>
            <thead>
              <tr>
                <th scope="col">Nº</th>
                <th scope="col">Vencimento</th>
                <th scope="col" class="numero">Valor</th>
              </tr>
            </thead>
            <tbody>
              @for (parcela of previa(); track parcela.numero) {
                <tr>
                  <td>{{ parcela.numero }}/{{ previa().length }}</td>
                  <td>{{ data(parcela.vencimento) }}</td>
                  <td class="numero">{{ moeda(parcela.valor) }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>
    }

    <section class="card secao espaco">
      <h2 class="secao__titulo">Observação</h2>
      <sge-text-field
        rotulo="Observação"
        name="note"
        [ngModel]="form().note"
        (ngModelChange)="mudar('note', $event)"
      />
    </section>
  `,
  styles: `
    .liquido {
      font-size: 1.1rem;
      font-variant-numeric: tabular-nums;
      padding-top: 0.4rem;
    }
    .conta {
      padding-top: 0.4rem;
      font-size: 0.85rem;
    }
    .conta--ausente {
      color: var(--p-text-muted-color);
      font-style: italic;
    }
    .parcelas {
      width: 100%;
      margin-top: 1rem;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .parcelas caption {
      caption-side: top;
      text-align: left;
      padding-bottom: 0.4rem;
      color: var(--p-text-muted-color);
    }
    .parcelas th,
    .parcelas td {
      padding: 0.4rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .parcelas .numero {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .rodape-parcelas {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      margin-top: 0.75rem;
      font-size: 0.8rem;
    }
    .divergente {
      color: var(--p-red-500, #dc2626);
      font-weight: 600;
    }
  `,
})
export class EntryFormPage {
  private readonly api = inject(FinanceApiService);
  private readonly configuracoes = inject(ConfigurationsApiService);
  private readonly parceiros = inject(PartnersApiService);
  private readonly condicoes = inject(PaymentConditionsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly entryId = this.rota.snapshot.paramMap.get('id') ?? '';
  protected readonly edicao = this.entryId !== '';

  protected readonly opcoesTipo = OPCOES_TIPO;
  protected readonly opcoesModo = OPCOES_MODO;

  protected readonly form = signal<Formulario>(formularioVazio());
  protected readonly linhas = signal<LinhaParcela[]>([
    { dueDate: adicionarDias(hoje(), 30), amount: null },
  ]);
  protected readonly registro = signal<FinancialEntry | null>(null);
  protected readonly carregando = signal(this.edicao);
  protected readonly salvando = signal(false);
  protected readonly tentouSalvar = signal(false);
  protected readonly erro = signal<unknown>(null);

  private readonly categorias = signal<Category[]>([]);
  private readonly centros = signal<CostCenter[]>([]);
  private readonly condicoesPagamento = signal<PaymentTerm[]>([]);
  protected readonly opcoesForma = signal<OpcaoFiltro[]>([]);
  /** `null` = sem permissão para consultar a classificação contábil. */
  private readonly classificacoes = signal<Map<string, CategoryClassification> | null>(null);

  protected readonly podeLerCentros = () => this.permissoes.pode('cost-centers:READ');

  protected readonly titulo = computed(() =>
    this.edicao ? `Título ${this.registro()?.number ?? ''}`.trim() : 'Novo título',
  );

  protected readonly subtitulo = computed(() =>
    this.edicao
      ? 'Tipo, número e contraparte não mudam; valores só enquanto não houver baixa.'
      : 'Conta a pagar ou a receber, com parcelamento e classificação (RF-051 a RF-054).',
  );

  protected readonly nomeContraparte = computed(() => {
    const titulo = this.registro();
    return (
      titulo?.partner?.tradeName ?? titulo?.partner?.legalName ?? titulo?.employee?.name ?? '—'
    );
  });

  /** Título com baixa não aceita novo valor — o servidor recusaria (RF-053). */
  protected readonly valoresTravados = computed(
    () => this.edicao && paraCentavos(this.registro()?.settledAmount) > 0n,
  );

  protected readonly liquido = computed(() =>
    subtrair(this.form().grossAmount, this.form().discountAmount),
  );

  /** Categoria precisa ser do mesmo tipo do título e aceitar lançamento (RF-054). */
  protected readonly opcoesCategoria = computed<OpcaoFiltro[]>(() =>
    this.categorias()
      .filter((c) => c.type === this.form().type && c.acceptsEntry)
      .map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
  );

  protected readonly opcoesCentro = computed<OpcaoFiltro[]>(() =>
    this.centros()
      .filter((c) => c.acceptsEntry)
      .map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
  );

  protected readonly opcoesCondicao = computed<OpcaoFiltro[]>(() =>
    this.condicoesPagamento().map((t) => ({
      value: t.id,
      label: `${t.code} — ${t.name} (${t.installments}x)`,
    })),
  );

  protected readonly dicaCategoria = computed(() => {
    if (!this.permissoes.pode('categories:READ')) return 'Sem permissão para listar categorias';
    return `Somente categorias ${ROTULO_TIPO[this.form().type].toLowerCase()} que aceitam lançamento`;
  });

  protected readonly contaContabil = computed(() => {
    const categoriaId = this.form().categoryId;
    const mapa = this.classificacoes();
    if (categoriaId === '') return { texto: 'Escolha a categoria', ausente: true };
    if (mapa === null) {
      return { texto: 'Sem permissão para consultar o plano de contas', ausente: true };
    }
    const item = mapa.get(categoriaId);
    if (!item?.ledgerAccountId) {
      return {
        texto: 'Categoria sem conta contábil — a contabilização automática será recusada',
        ausente: true,
      };
    }
    return { texto: `${item.ledgerAccountCode} — ${item.ledgerAccountName}`, ausente: false };
  });

  protected readonly previa = computed<ParcelaPlanejada[]>(() => {
    const form = this.form();
    const liquido = this.liquido();
    switch (form.modo) {
      case 'UNICA':
        return dataValida(form.firstDueDate)
          ? planejarParcelas(liquido, 1, form.firstDueDate, 30)
          : [];
      case 'SIMPLES': {
        const quantidade = inteiro(form.installmentCount);
        const intervalo = inteiro(form.intervalDays);
        if (quantidade === null || intervalo === null || !dataValida(form.firstDueDate)) return [];
        if (quantidade > 360 || intervalo < 1) return [];
        return planejarParcelas(liquido, quantidade, form.firstDueDate, intervalo);
      }
      case 'CONDICAO': {
        const condicao = this.condicoesPagamento().find((t) => t.id === form.paymentTermId);
        if (!condicao || !dataValida(form.issueDate)) return [];
        return planejarParcelas(
          liquido,
          condicao.installments,
          adicionarDias(form.issueDate, condicao.firstDueDays),
          condicao.intervalDays,
        );
      }
      default:
        return [];
    }
  });

  protected readonly somaManual = computed(() => somar(...this.linhas().map((l) => l.amount)));

  protected readonly diferencaManual = computed(() => subtrair(this.liquido(), this.somaManual()));

  /** Tudo que impede o envio, em linguagem de usuário. Vazio = pode salvar. */
  protected readonly problemas = computed<string[]>(() => {
    const form = this.form();
    const lista: string[] = [];
    if (form.description.trim() === '') lista.push('Informe a descrição.');
    if (!this.edicao && form.partnerId === '') {
      lista.push(form.type === 'PAGAR' ? 'Escolha o fornecedor.' : 'Escolha o cliente.');
    }
    if (paraCentavos(form.grossAmount) <= 0n)
      lista.push('O valor bruto precisa ser maior que zero.');
    if (paraCentavos(this.liquido()) <= 0n) {
      lista.push('O desconto não pode igualar ou superar o valor bruto.');
    }
    if (form.competenceDate !== '' && !dataValida(form.competenceDate)) {
      lista.push('Competência inválida.');
    }
    if (this.edicao) return lista;

    if (!dataValida(form.issueDate)) lista.push('Emissão inválida.');
    switch (form.modo) {
      case 'UNICA':
        if (!dataValida(form.firstDueDate)) lista.push('Informe o vencimento.');
        break;
      case 'SIMPLES': {
        const quantidade = inteiro(form.installmentCount);
        const intervalo = inteiro(form.intervalDays);
        if (quantidade === null || quantidade < 1 || quantidade > 360) {
          lista.push('A quantidade de parcelas vai de 1 a 360.');
        }
        if (intervalo === null || intervalo < 1 || intervalo > 365) {
          lista.push('O intervalo entre parcelas vai de 1 a 365 dias.');
        }
        if (!dataValida(form.firstDueDate)) lista.push('Informe o 1º vencimento.');
        break;
      }
      case 'CONDICAO':
        if (form.paymentTermId === '') lista.push('Escolha a condição de pagamento.');
        break;
      case 'MANUAL': {
        const linhas = this.linhas();
        if (linhas.some((l) => !dataValida(l.dueDate)))
          lista.push('Toda parcela precisa de vencimento.');
        if (linhas.some((l) => paraCentavos(l.amount) <= 0n)) {
          lista.push('Toda parcela precisa de valor maior que zero.');
        }
        if (this.diferencaManual() !== '0.00') {
          lista.push('A soma das parcelas precisa ser igual ao valor líquido (RF-053).');
        }
        break;
      }
    }
    return lista;
  });

  protected readonly buscarParceiro = (termo: string) =>
    this.parceiros
      .list({
        q: termo,
        role: this.form().type === 'PAGAR' ? 'FORNECEDOR' : 'CLIENTE',
        isActive: true,
        pageSize: LIMITE_BUSCA,
      })
      .pipe(map((r) => r.data.map((p) => ({ value: p.id, label: p.tradeName ?? p.legalName }))));

  constructor() {
    this.carregarApoio();
    if (this.edicao) this.carregar();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  /** Trocar a carteira invalida a contraparte e a categoria, que são por tipo. */
  protected mudarTipo(valor: string | null): void {
    const tipo: EntryType = valor === 'RECEBER' ? 'RECEBER' : 'PAGAR';
    this.form.update((atual) =>
      atual.type === tipo ? atual : { ...atual, type: tipo, partnerId: '', categoryId: '' },
    );
  }

  protected mudarLinha(indice: number, campo: keyof LinhaParcela, valor: string | null): void {
    this.linhas.update((atual) =>
      atual.map((linha, i) =>
        i === indice ? { ...linha, [campo]: campo === 'dueDate' ? (valor ?? '') : valor } : linha,
      ),
    );
  }

  protected adicionarLinha(): void {
    this.linhas.update((atual) => {
      const ultima = atual[atual.length - 1]?.dueDate;
      const vencimento = ultima && dataValida(ultima) ? adicionarDias(ultima, 30) : hoje();
      return [...atual, { dueDate: vencimento, amount: null }];
    });
  }

  protected removerLinha(indice: number): void {
    this.linhas.update((atual) =>
      atual.length > 1 ? atual.filter((_, i) => i !== indice) : atual,
    );
  }

  protected salvar(): void {
    this.tentouSalvar.set(true);
    if (this.salvando() || this.problemas().length > 0) return;
    this.salvando.set(true);
    this.erro.set(null);

    const requisicao = this.edicao
      ? this.api.updateEntry(this.entryId, this.montarEdicao())
      : this.api.createEntry(this.montarCriacao());

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (titulo) => {
        this.salvando.set(false);
        void this.router.navigate(['/financeiro/titulos', titulo.id]);
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erro.set(falha);
      },
    });
  }

  private montarCriacao(): FinancialEntryInput {
    const form = this.form();
    const dto: FinancialEntryInput = {
      type: form.type,
      description: form.description.trim(),
      partnerId: form.partnerId,
      grossAmount: form.grossAmount ?? '0',
      documentReference: texto(form.documentReference),
      issueDate: form.issueDate,
      competenceDate: texto(form.competenceDate),
      discountAmount: form.discountAmount ?? undefined,
      categoryId: texto(form.categoryId),
      costCenterId: texto(form.costCenterId),
      paymentMethodId: texto(form.paymentMethodId),
      dailyInterestRate: form.dailyInterestRate ?? undefined,
      penaltyRate: form.penaltyRate ?? undefined,
      note: texto(form.note),
    };

    switch (form.modo) {
      case 'UNICA':
        dto.installmentCount = 1;
        dto.firstDueDate = form.firstDueDate;
        break;
      case 'SIMPLES':
        dto.installmentCount = inteiro(form.installmentCount) ?? 1;
        dto.firstDueDate = form.firstDueDate;
        dto.intervalDays = inteiro(form.intervalDays) ?? 30;
        break;
      case 'CONDICAO':
        dto.paymentTermId = form.paymentTermId;
        break;
      case 'MANUAL':
        dto.installments = this.linhas().map((linha) => ({
          dueDate: linha.dueDate,
          amount: linha.amount ?? '0',
          dailyInterestRate: form.dailyInterestRate ?? undefined,
          penaltyRate: form.penaltyRate ?? undefined,
        }));
        break;
    }

    // Chaves `undefined` não vão para o corpo: sem isso, o JSON leva só o que
    // o usuário preencheu — e nada de campo que o DTO não conhece.
    return Object.fromEntries(
      Object.entries(dto).filter(([, valor]) => valor !== undefined),
    ) as unknown as FinancialEntryInput;
  }

  /**
   * Edição envia só o que mudou: valor bruto e desconto reenviados sem mudança
   * seriam recusados num título com baixa, e o resto é ruído na auditoria.
   */
  private montarEdicao(): FinancialEntryUpdateInput {
    const form = this.form();
    const atual = this.registro();
    const dto: FinancialEntryUpdateInput = {};
    if (!atual) return dto;

    if (form.description.trim() !== atual.description) dto.description = form.description.trim();
    if (
      form.documentReference.trim() !== (atual.documentReference ?? '') &&
      texto(form.documentReference)
    ) {
      dto.documentReference = form.documentReference.trim();
    }
    if (
      form.competenceDate !== atual.competenceDate.slice(0, 10) &&
      dataValida(form.competenceDate)
    ) {
      dto.competenceDate = form.competenceDate;
    }
    if (!this.valoresTravados()) {
      if (comparar(form.grossAmount, atual.grossAmount) !== 0)
        dto.grossAmount = form.grossAmount ?? '0';
      if (comparar(form.discountAmount, atual.discountAmount) !== 0) {
        dto.discountAmount = form.discountAmount ?? '0';
      }
    }
    if (form.categoryId !== (atual.categoryId ?? '') && form.categoryId !== '') {
      dto.categoryId = form.categoryId;
    }
    if (form.costCenterId !== (atual.costCenterId ?? '') && form.costCenterId !== '') {
      dto.costCenterId = form.costCenterId;
    }
    if (form.paymentMethodId !== (atual.paymentMethodId ?? '') && form.paymentMethodId !== '') {
      dto.paymentMethodId = form.paymentMethodId;
    }
    if (form.note.trim() !== (atual.note ?? '') && texto(form.note)) dto.note = form.note.trim();
    return dto;
  }

  private carregar(): void {
    this.api
      .getEntry(this.entryId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (titulo) => {
          this.registro.set(titulo);
          this.form.set({
            ...formularioVazio(),
            type: titulo.type,
            partnerId: titulo.partnerId ?? '',
            description: titulo.description,
            documentReference: titulo.documentReference ?? '',
            issueDate: titulo.issueDate.slice(0, 10),
            competenceDate: titulo.competenceDate.slice(0, 10),
            grossAmount: titulo.grossAmount,
            discountAmount: titulo.discountAmount,
            categoryId: titulo.categoryId ?? '',
            costCenterId: titulo.costCenterId ?? '',
            paymentMethodId: titulo.paymentMethodId ?? '',
            note: titulo.note ?? '',
          });
          this.carregando.set(false);
        },
        error: (falha: unknown) => {
          this.carregando.set(false);
          this.erro.set(falha);
        },
      });
  }

  /** Listas de apoio: cada uma só é pedida com a permissão que a API exige. */
  private carregarApoio(): void {
    if (this.permissoes.pode('categories:READ')) {
      this.configuracoes
        .listCategories({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) => this.categorias.set(r.data),
          error: () => this.categorias.set([]),
        });
    }
    if (this.podeLerCentros()) {
      this.configuracoes
        .listCostCenters({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (r) => this.centros.set(r.data), error: () => this.centros.set([]) });
    }
    if (this.permissoes.pode('payment-terms:READ')) {
      this.condicoes
        .listTerms({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) => this.condicoesPagamento.set(r.data),
          error: () => this.condicoesPagamento.set([]),
        });
    }
    if (this.permissoes.pode('payment-methods:READ')) {
      this.condicoes
        .listMethods({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesForma.set(
              r.data.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` })),
            ),
          error: () => this.opcoesForma.set([]),
        });
    }
    if (this.permissoes.pode('accounting-classifications:READ')) {
      this.api
        .categoryClassifications()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (lista) => this.classificacoes.set(new Map(lista.map((c) => [c.id, c]))),
          error: () => this.classificacoes.set(null),
        });
    }
  }
}
