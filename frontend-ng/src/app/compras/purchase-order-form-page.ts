import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { type Observable, map, of } from 'rxjs';

import { CatalogApiService } from '../core/api/catalog-api.service';
import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import { EmployeesApiService } from '../core/api/employees-api.service';
import { PartnersApiService } from '../core/api/partners-api.service';
import { PaymentConditionsApiService } from '../core/api/payment-conditions-api.service';
import { PurchasingApiService } from '../core/api/purchasing-api.service';
import { StockApiService } from '../core/api/stock-api.service';
import type {
  Category,
  CostCenter,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderItemInput,
  PurchaseOrderUpdateInput,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { dataValida, hoje, paraCentavos, somar, subtrair } from '../financeiro/dinheiro';
import { Alert } from '../ui/alert';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { LIMITE_BUSCA, SearchSelect } from '../ui/search-select';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { CASAS_UNITARIAS, positivo, valorBruto, valorLinha } from './calculo';
import { editavel } from './rotulos';

interface Formulario {
  partnerId: string;
  buyerId: string;
  orderDate: string;
  expectedDate: string;
  paymentTermId: string;
  paymentMethodId: string;
  costCenterId: string;
  categoryId: string;
  discountAmount: string | null;
  freightAmount: string | null;
  insuranceAmount: string | null;
  otherExpenseAmount: string | null;
  note: string;
}

/** Linha do pedido na tela. `chave` identifica a linha para o `@for`. */
interface LinhaItem {
  chave: number;
  productId: string;
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  discountAmount: string | null;
  locationId: string;
  costCenterId: string;
  note: string;
}

type CampoValor = 'discountAmount' | 'freightAmount' | 'insuranceAmount' | 'otherExpenseAmount';

const ROTULO_VALOR: Record<CampoValor, string> = {
  discountAmount: 'O desconto do pedido',
  freightAmount: 'O frete',
  insuranceAmount: 'O seguro',
  otherExpenseAmount: 'As outras despesas',
};

function formularioVazio(): Formulario {
  return {
    partnerId: '',
    buyerId: '',
    orderDate: hoje(),
    expectedDate: '',
    paymentTermId: '',
    paymentMethodId: '',
    costCenterId: '',
    categoryId: '',
    discountAmount: null,
    freightAmount: null,
    insuranceAmount: null,
    otherExpenseAmount: null,
    note: '',
  };
}

let proximaChave = 0;

function linhaVazia(): LinhaItem {
  return {
    chave: ++proximaChave,
    productId: '',
    description: '',
    quantity: null,
    unitPrice: null,
    discountAmount: null,
    locationId: '',
    costCenterId: '',
    note: '',
  };
}

/** Só o que tem conteúdo vai para o DTO: campo em branco não é "apagar". */
function texto(valor: string): string | undefined {
  const limpo = valor.trim();
  return limpo === '' ? undefined : limpo;
}

/**
 * Na edição, campo esvaziado vira `null` — mas só se antes havia valor: é o
 * que o backend entende como "limpar", e mandar `null` do que já era nulo é
 * ruído na trilha de auditoria.
 */
function limpar(valor: string, original: string | null): string | null | undefined {
  const limpo = valor.trim();
  if (limpo !== '') return limpo;
  return original ? null : undefined;
}

function semIndefinidos<T extends object>(objeto: T): T {
  return Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== undefined)) as T;
}

/**
 * Criação e edição do pedido de compra (RF-036/RF-037 — UI-030).
 *
 * Valor da linha e totais aqui são **prévia**, em `bigint`, com a mesma regra
 * do backend (quantidade × preço arredondado no centavo, menos o desconto). O
 * número oficial é do banco: o DTO não leva total nenhum, e o rateio do frete
 * pelas linhas também é feito lá.
 *
 * O pedido nasce em rascunho e só muda enquanto está nele; na edição, `items`
 * substitui a lista inteira, então a tela sempre envia todas as linhas.
 */
@Component({
  selector: 'sge-purchase-order-form-page',
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
    <p class="crumb">Compras / Pedidos / {{ titulo() }}</p>

    <div class="pagehead">
      <div>
        <h1>{{ titulo() }}</h1>
        <p>Fornecedor, itens, quantidades, preços, descontos e frete (RF-036/RF-037).</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          [routerLink]="edicao ? ['/compras/pedidos', orderId] : '/compras/pedidos'"
        />
        <p-button
          label="Salvar rascunho"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando() || carregando() || bloqueado() || problemas().length > 0"
          (onClick)="salvar()"
        />
      </div>
    </div>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (bloqueado()) {
      <div class="espaco">
        <sge-alert
          tom="aviso"
          titulo="Este pedido não é mais editável"
          mensagem="Só o rascunho muda: aprovar um pedido cujos itens ainda podem mudar não é aprovar nada (RF-038)."
        />
      </div>
    }

    @if (tentouSalvar() && problemas().length > 0) {
      <div class="espaco">
        <sge-alert tom="aviso" titulo="Revise o pedido" [detalhes]="problemas()" />
      </div>
    }

    <section class="card secao espaco">
      <h2 class="secao__titulo">Fornecedor e prazos</h2>
      <div class="grade-campos">
        <sge-search-select
          rotulo="Fornecedor"
          name="partnerId"
          dica="Somente parceiros com o papel de fornecedor (RF-023)"
          [buscar]="buscarFornecedor"
          [resolver]="resolverFornecedor"
          [obrigatorio]="true"
          [ngModel]="form().partnerId || null"
          (ngModelChange)="mudar('partnerId', $event ?? '')"
        />
        @if (podeLerFuncionarios()) {
          <sge-search-select
            rotulo="Comprador"
            name="buyerId"
            [buscar]="buscarComprador"
            [resolver]="resolverComprador"
            [ngModel]="form().buyerId || null"
            (ngModelChange)="mudar('buyerId', $event ?? '')"
          />
        }
        <sge-text-field
          rotulo="Data do pedido"
          name="orderDate"
          tipo="date"
          [obrigatorio]="true"
          [ngModel]="form().orderDate"
          (ngModelChange)="mudar('orderDate', $event)"
        />
        <sge-text-field
          rotulo="Previsão de entrega"
          name="expectedDate"
          tipo="date"
          [ngModel]="form().expectedDate"
          (ngModelChange)="mudar('expectedDate', $event)"
        />
        <sge-select-field
          rotulo="Condição de pagamento"
          name="paymentTermId"
          dica="Vale para o título a pagar gerado no recebimento"
          [opcoes]="opcoesCondicao()"
          [ngModel]="form().paymentTermId || null"
          (ngModelChange)="mudar('paymentTermId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Forma de pagamento"
          name="paymentMethodId"
          [opcoes]="opcoesForma()"
          [ngModel]="form().paymentMethodId || null"
          (ngModelChange)="mudar('paymentMethodId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Categoria financeira"
          name="categoryId"
          dica="Somente categorias a pagar que aceitam lançamento"
          [opcoes]="opcoesCategoria()"
          [ngModel]="form().categoryId || null"
          (ngModelChange)="mudar('categoryId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Centro de custo"
          name="costCenterId"
          [opcoes]="opcoesCentro()"
          [ngModel]="form().costCenterId || null"
          (ngModelChange)="mudar('costCenterId', $event ?? '')"
        />
      </div>
    </section>

    <section class="card secao espaco">
      <div class="secao__cabecalho">
        <h2 class="secao__titulo">Itens (RF-037)</h2>
        <p-button
          label="Adicionar item"
          icon="pi pi-plus"
          severity="secondary"
          [outlined]="true"
          size="small"
          [disabled]="linhas().length >= 500"
          (onClick)="adicionarLinha()"
        />
      </div>

      @for (linha of linhas(); track linha.chave; let indice = $index) {
        <div class="item">
          <div class="item__cabecalho">
            <strong>Item {{ indice + 1 }}</strong>
            <span class="item__valor">{{ moeda(valorDaLinha(linha)) }}</span>
            <p-button
              icon="pi pi-trash"
              severity="danger"
              [text]="true"
              size="small"
              ariaLabel="Remover item"
              [disabled]="linhas().length === 1"
              (onClick)="removerLinha(indice)"
            />
          </div>
          <div class="grade-campos">
            @if (podeLerProdutos()) {
              <sge-search-select
                rotulo="Produto ou serviço"
                [name]="'produto-' + linha.chave"
                dica="Vazio para compra avulsa — então a descrição é obrigatória"
                [buscar]="buscarProduto"
                [resolver]="resolverProduto"
                [ngModel]="linha.productId || null"
                (ngModelChange)="mudarLinha(indice, 'productId', $event ?? '')"
              />
            }
            <sge-text-field
              rotulo="Descrição"
              [name]="'descricao-' + linha.chave"
              [dica]="linha.productId ? 'Vazia = a descrição do produto' : ''"
              [obrigatorio]="!linha.productId"
              [ngModel]="linha.description"
              (ngModelChange)="mudarLinha(indice, 'description', $event)"
            />
            <sge-decimal-field
              rotulo="Quantidade"
              [name]="'quantidade-' + linha.chave"
              [casas]="casasUnitarias"
              [obrigatorio]="true"
              [ngModel]="linha.quantity"
              (ngModelChange)="mudarLinha(indice, 'quantity', $event)"
            />
            <sge-decimal-field
              rotulo="Preço unitário"
              [name]="'preco-' + linha.chave"
              [casas]="casasUnitarias"
              [obrigatorio]="true"
              [ngModel]="linha.unitPrice"
              (ngModelChange)="mudarLinha(indice, 'unitPrice', $event)"
            />
            <sge-decimal-field
              rotulo="Desconto da linha"
              [name]="'desconto-' + linha.chave"
              [ngModel]="linha.discountAmount"
              (ngModelChange)="mudarLinha(indice, 'discountAmount', $event)"
            />
            @if (opcoesLocal().length > 0) {
              <sge-select-field
                rotulo="Local de recebimento"
                [name]="'local-' + linha.chave"
                [opcoes]="opcoesLocal()"
                [ngModel]="linha.locationId || null"
                (ngModelChange)="mudarLinha(indice, 'locationId', $event ?? '')"
              />
            }
            @if (opcoesCentro().length > 0) {
              <sge-select-field
                rotulo="Centro de custo da linha"
                [name]="'centro-' + linha.chave"
                [opcoes]="opcoesCentro()"
                [ngModel]="linha.costCenterId || null"
                (ngModelChange)="mudarLinha(indice, 'costCenterId', $event ?? '')"
              />
            }
          </div>
        </div>
      }
    </section>

    <section class="card secao espaco">
      <h2 class="secao__titulo">Valores do pedido</h2>
      <div class="grade-campos">
        <sge-decimal-field
          rotulo="Desconto negociado"
          name="discountAmount"
          [ngModel]="form().discountAmount"
          (ngModelChange)="mudar('discountAmount', $event)"
        />
        <sge-decimal-field
          rotulo="Frete"
          name="freightAmount"
          dica="Rateado entre as linhas pelo banco — entra no custo do estoque"
          [ngModel]="form().freightAmount"
          (ngModelChange)="mudar('freightAmount', $event)"
        />
        <sge-decimal-field
          rotulo="Seguro"
          name="insuranceAmount"
          [ngModel]="form().insuranceAmount"
          (ngModelChange)="mudar('insuranceAmount', $event)"
        />
        <sge-decimal-field
          rotulo="Outras despesas"
          name="otherExpenseAmount"
          [ngModel]="form().otherExpenseAmount"
          (ngModelChange)="mudar('otherExpenseAmount', $event)"
        />
      </div>
      <dl class="totais">
        <div>
          <dt>Produtos</dt>
          <dd>{{ moeda(produtos()) }}</dd>
        </div>
        <div>
          <dt>Total previsto</dt>
          <dd class="totais__total">{{ moeda(total()) }}</dd>
        </div>
      </dl>
      <p class="nota">Prévia da tela — o total oficial é calculado pelo servidor ao salvar.</p>
    </section>

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
    .secao__cabecalho {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }
    .item {
      padding: 0.75rem 0;
      border-top: 1px solid var(--p-content-border-color);
    }
    .item__cabecalho {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
      font-size: 0.85rem;
    }
    .item__valor {
      margin-left: auto;
      font-variant-numeric: tabular-nums;
    }
    .totais {
      display: flex;
      flex-wrap: wrap;
      gap: 2rem;
      margin: 1rem 0 0;
    }
    .totais dt {
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
    }
    .totais dd {
      margin: 0.2rem 0 0;
      font-variant-numeric: tabular-nums;
    }
    .totais__total {
      font-size: 1.1rem;
      font-weight: 600;
    }
  `,
})
export class PurchaseOrderFormPage {
  private readonly api = inject(PurchasingApiService);
  private readonly parceiros = inject(PartnersApiService);
  private readonly catalogo = inject(CatalogApiService);
  private readonly funcionarios = inject(EmployeesApiService);
  private readonly configuracoes = inject(ConfigurationsApiService);
  private readonly condicoes = inject(PaymentConditionsApiService);
  private readonly estoque = inject(StockApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly orderId = this.rota.snapshot.paramMap.get('id') ?? '';
  protected readonly edicao = this.orderId !== '';
  protected readonly casasUnitarias = CASAS_UNITARIAS;

  protected readonly form = signal<Formulario>(formularioVazio());
  protected readonly linhas = signal<LinhaItem[]>([linhaVazia()]);
  protected readonly registro = signal<PurchaseOrder | null>(null);
  protected readonly carregando = signal(this.edicao);
  protected readonly salvando = signal(false);
  protected readonly tentouSalvar = signal(false);
  protected readonly erro = signal<unknown>(null);

  private readonly categorias = signal<Category[]>([]);
  private readonly centros = signal<CostCenter[]>([]);
  protected readonly opcoesCondicao = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesForma = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesLocal = signal<OpcaoFiltro[]>([]);

  protected readonly podeLerProdutos = () => this.permissoes.pode('products:READ');
  protected readonly podeLerFuncionarios = () => this.permissoes.pode('employees:READ');

  protected readonly titulo = computed(() =>
    this.edicao ? `Pedido ${this.registro()?.number ?? ''}`.trim() : 'Novo pedido',
  );

  /** Pedido fora do rascunho: o servidor recusaria a edição (RF-038). */
  protected readonly bloqueado = computed(() => {
    const registro = this.registro();
    return this.edicao && registro !== null && !editavel(registro);
  });

  /** A categoria classifica o título a pagar da compra: só PAGAR (RF-041/RF-054). */
  protected readonly opcoesCategoria = computed<OpcaoFiltro[]>(() =>
    this.categorias()
      .filter((c) => c.type === 'PAGAR' && c.acceptsEntry)
      .map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
  );

  protected readonly opcoesCentro = computed<OpcaoFiltro[]>(() =>
    this.centros()
      .filter((c) => c.acceptsEntry)
      .map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
  );

  protected readonly produtos = computed(() =>
    somar(...this.linhas().map((linha) => this.valorDaLinha(linha))),
  );

  /** Produtos − desconto + frete + seguro + outras — a mesma conta do banco. */
  protected readonly total = computed(() => {
    const form = this.form();
    return subtrair(
      somar(this.produtos(), form.freightAmount, form.insuranceAmount, form.otherExpenseAmount),
      form.discountAmount,
    );
  });

  /** Tudo que impede o envio, em linguagem de usuário. Vazio = pode salvar. */
  protected readonly problemas = computed<string[]>(() => {
    const form = this.form();
    const lista: string[] = [];

    if (form.partnerId === '') lista.push('Escolha o fornecedor.');
    if (!dataValida(form.orderDate)) lista.push('Informe a data do pedido.');
    if (form.expectedDate !== '') {
      if (!dataValida(form.expectedDate)) lista.push('Previsão de entrega inválida.');
      else if (form.expectedDate < form.orderDate) {
        lista.push('A previsão de entrega não pode ser anterior ao pedido.');
      }
    }
    for (const campo of Object.keys(ROTULO_VALOR) as CampoValor[]) {
      if (paraCentavos(form[campo]) < 0n)
        lista.push(`${ROTULO_VALOR[campo]} não pode ser negativo.`);
    }

    const linhas = this.linhas();
    if (linhas.length === 0) lista.push('O pedido precisa de ao menos um item.');
    linhas.forEach((linha, indice) => {
      const n = indice + 1;
      if (linha.productId === '' && linha.description.trim() === '') {
        lista.push(`Informe o produto ou a descrição do item ${n}.`);
      }
      if (!positivo(linha.quantity))
        lista.push(`A quantidade do item ${n} deve ser maior que zero.`);
      if (!positivo(linha.unitPrice)) {
        lista.push(`O preço unitário do item ${n} deve ser maior que zero.`);
      }
      const desconto = paraCentavos(linha.discountAmount);
      if (desconto < 0n) lista.push(`O desconto do item ${n} não pode ser negativo.`);
      else if (desconto > paraCentavos(valorBruto(linha.quantity, linha.unitPrice))) {
        lista.push(`O desconto do item ${n} supera o valor da linha.`);
      }
    });
    return lista;
  });

  protected readonly buscarFornecedor = (termo: string): Observable<OpcaoFiltro[]> =>
    this.parceiros
      .list({ q: termo, role: 'FORNECEDOR', isActive: true, pageSize: LIMITE_BUSCA })
      .pipe(map((r) => r.data.map((p) => ({ value: p.id, label: p.tradeName ?? p.legalName }))));

  /** Na edição o rótulo já veio com o pedido; só pergunta à API o que não conhece. */
  protected readonly resolverFornecedor = (id: string): Observable<OpcaoFiltro> => {
    const parceiro = this.registro()?.partner;
    if (parceiro?.id === id) {
      return of({ value: id, label: parceiro.tradeName ?? parceiro.legalName });
    }
    return this.parceiros
      .get(id)
      .pipe(map((p) => ({ value: p.id, label: p.tradeName ?? p.legalName })));
  };

  protected readonly buscarProduto = (termo: string): Observable<OpcaoFiltro[]> =>
    this.catalogo
      .list({ q: termo, isActive: true, pageSize: LIMITE_BUSCA })
      .pipe(
        map((r) => r.data.map((p) => ({ value: p.id, label: `${p.code} — ${p.description}` }))),
      );

  protected readonly resolverProduto = (id: string): Observable<OpcaoFiltro> => {
    const produto = this.registro()?.items.find((item) => item.product?.id === id)?.product;
    if (produto) return of({ value: id, label: `${produto.code} — ${produto.description}` });
    return this.catalogo
      .get(id)
      .pipe(map((p) => ({ value: p.id, label: `${p.code} — ${p.description}` })));
  };

  protected readonly buscarComprador = (termo: string): Observable<OpcaoFiltro[]> =>
    this.funcionarios
      .list({ q: termo, pageSize: LIMITE_BUSCA })
      .pipe(map((r) => r.data.map((f) => ({ value: f.id, label: f.name }))));

  protected readonly resolverComprador = (id: string): Observable<OpcaoFiltro> => {
    const comprador = this.registro()?.buyer;
    if (comprador?.id === id) return of({ value: id, label: comprador.name });
    return this.funcionarios.get(id).pipe(map((f) => ({ value: f.id, label: f.name })));
  };

  constructor() {
    this.carregarApoio();
    if (this.edicao) this.carregar();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected valorDaLinha(linha: LinhaItem): string {
    return valorLinha(linha.quantity, linha.unitPrice, linha.discountAmount);
  }

  protected mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarLinha<K extends keyof LinhaItem>(indice: number, campo: K, valor: LinhaItem[K]) {
    this.linhas.update((atual) =>
      atual.map((linha, i) => (i === indice ? { ...linha, [campo]: valor } : linha)),
    );
  }

  protected adicionarLinha(): void {
    this.linhas.update((atual) => [...atual, linhaVazia()]);
  }

  protected removerLinha(indice: number): void {
    this.linhas.update((atual) =>
      atual.length > 1 ? atual.filter((_, i) => i !== indice) : atual,
    );
  }

  protected salvar(): void {
    this.tentouSalvar.set(true);
    if (this.salvando() || this.bloqueado() || this.problemas().length > 0) return;
    this.salvando.set(true);
    this.erro.set(null);

    const requisicao = this.edicao
      ? this.api.updateOrder(this.orderId, this.montarEdicao())
      : this.api.createOrder(this.montarCriacao());

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (pedido) => {
        this.salvando.set(false);
        void this.router.navigate(['/compras/pedidos', pedido.id]);
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erro.set(falha);
      },
    });
  }

  private montarItens(): PurchaseOrderItemInput[] {
    return this.linhas().map((linha) =>
      semIndefinidos<PurchaseOrderItemInput>({
        productId: texto(linha.productId),
        description: texto(linha.description),
        quantity: linha.quantity ?? '0',
        unitPrice: linha.unitPrice ?? '0',
        discountAmount: linha.discountAmount ?? undefined,
        costCenterId: texto(linha.costCenterId),
        locationId: texto(linha.locationId),
        note: texto(linha.note),
      }),
    );
  }

  private montarCriacao(): PurchaseOrderInput {
    const form = this.form();
    return semIndefinidos<PurchaseOrderInput>({
      partnerId: form.partnerId,
      buyerId: texto(form.buyerId),
      orderDate: form.orderDate,
      expectedDate: texto(form.expectedDate),
      paymentTermId: texto(form.paymentTermId),
      paymentMethodId: texto(form.paymentMethodId),
      costCenterId: texto(form.costCenterId),
      categoryId: texto(form.categoryId),
      discountAmount: form.discountAmount ?? undefined,
      freightAmount: form.freightAmount ?? undefined,
      insuranceAmount: form.insuranceAmount ?? undefined,
      otherExpenseAmount: form.otherExpenseAmount ?? undefined,
      note: texto(form.note),
      items: this.montarItens(),
    });
  }

  /** Rascunho: o corpo leva o pedido inteiro, e `items` troca a lista toda. */
  private montarEdicao(): PurchaseOrderUpdateInput {
    const form = this.form();
    const atual = this.registro();
    return semIndefinidos<PurchaseOrderUpdateInput>({
      partnerId: form.partnerId,
      buyerId: limpar(form.buyerId, atual?.buyerId ?? null),
      orderDate: form.orderDate,
      expectedDate: limpar(form.expectedDate, atual?.expectedDate ?? null),
      paymentTermId: limpar(form.paymentTermId, atual?.paymentTermId ?? null),
      paymentMethodId: limpar(form.paymentMethodId, atual?.paymentMethodId ?? null),
      costCenterId: limpar(form.costCenterId, atual?.costCenterId ?? null),
      categoryId: limpar(form.categoryId, atual?.categoryId ?? null),
      // Valor esvaziado é zero, não nulo: a coluna é NOT NULL DEFAULT 0.
      discountAmount: form.discountAmount ?? '0',
      freightAmount: form.freightAmount ?? '0',
      insuranceAmount: form.insuranceAmount ?? '0',
      otherExpenseAmount: form.otherExpenseAmount ?? '0',
      note: limpar(form.note, atual?.note ?? null),
      items: this.montarItens(),
    });
  }

  private carregar(): void {
    this.api
      .getOrder(this.orderId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pedido) => {
          this.registro.set(pedido);
          this.form.set({
            partnerId: pedido.partnerId,
            buyerId: pedido.buyerId ?? '',
            orderDate: pedido.orderDate.slice(0, 10),
            expectedDate: pedido.expectedDate?.slice(0, 10) ?? '',
            paymentTermId: pedido.paymentTermId ?? '',
            paymentMethodId: pedido.paymentMethodId ?? '',
            costCenterId: pedido.costCenterId ?? '',
            categoryId: pedido.categoryId ?? '',
            discountAmount: pedido.discountAmount,
            freightAmount: pedido.freightAmount,
            insuranceAmount: pedido.insuranceAmount,
            otherExpenseAmount: pedido.otherExpenseAmount,
            note: pedido.note ?? '',
          });
          this.linhas.set(
            pedido.items.map((item) => ({
              chave: ++proximaChave,
              productId: item.productId ?? '',
              // Com produto, a descrição vinda do catálogo não é repetida no DTO.
              description: item.productId ? '' : item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountAmount: item.discountAmount,
              locationId: item.locationId ?? '',
              costCenterId: item.costCenterId ?? '',
              note: item.note ?? '',
            })),
          );
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
    if (this.permissoes.pode('cost-centers:READ')) {
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
          next: (r) =>
            this.opcoesCondicao.set(
              r.data.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` })),
            ),
          error: () => this.opcoesCondicao.set([]),
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
    if (this.permissoes.pode('stock-locations:READ')) {
      this.estoque
        .listLocations({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesLocal.set(
              r.data.map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` })),
            ),
          error: () => this.opcoesLocal.set([]),
        });
    }
  }
}
