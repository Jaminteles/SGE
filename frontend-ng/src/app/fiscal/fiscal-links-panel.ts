import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { Observable, map, of } from 'rxjs';

import { BranchesApiService } from '../core/api/branches-api.service';
import { CatalogApiService } from '../core/api/catalog-api.service';
import { ConfigurationsApiService } from '../core/api/configurations-api.service';
import { FiscalDocumentsApiService } from '../core/api/fiscal-documents-api.service';
import { PartnersApiService } from '../core/api/partners-api.service';
import { PaymentConditionsApiService } from '../core/api/payment-conditions-api.service';
import { PurchasingApiService } from '../core/api/purchasing-api.service';
import { StockApiService } from '../core/api/stock-api.service';
import type {
  FiscalDocument,
  FiscalDocumentLinkInput,
  FiscalDocumentPostingInput,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ROTULO_STATUS_TITULO } from '../financeiro/rotulos';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SearchSelect } from '../ui/search-select';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { efeitosPendentes, vinculavel } from './rotulos';

const LIMITE_BUSCA = 20;

/** Formulário de vínculos: `''` = sem vínculo. */
export interface FormVinculos {
  issuerPartnerId: string;
  purchaseOrderId: string;
  branchId: string;
  /** `itemId` → `productId` (`''` = sem produto). */
  itens: Record<string, string>;
}

export interface FormEfeitos {
  gerarEstoque: boolean;
  localId: string;
  gerarTitulo: boolean;
  categoriaId: string;
  condicaoId: string;
  primeiroVencimento: string;
  parcelas: string;
  observacao: string;
}

export function formVinculosDe(nota: FiscalDocument): FormVinculos {
  return {
    issuerPartnerId: nota.issuerPartnerId ?? '',
    purchaseOrderId: nota.purchaseOrderId ?? '',
    branchId: nota.branchId ?? '',
    itens: Object.fromEntries(nota.items.map((item) => [item.id, item.productId ?? ''])),
  };
}

/**
 * Só o que mudou vai para o `PATCH /links`: campo ausente é "não mexer" e
 * `null` desfaz o vínculo (`LinkFiscalDocumentDto`). Mandar tudo sempre
 * reescreveria vínculos que outra pessoa acabou de mudar.
 */
export function montarVinculos(nota: FiscalDocument, form: FormVinculos): FiscalDocumentLinkInput {
  const corpo: FiscalDocumentLinkInput = {};
  const mudou = (atual: string | null, novo: string) => (atual ?? '') !== novo;

  if (mudou(nota.issuerPartnerId, form.issuerPartnerId)) {
    corpo.issuerPartnerId = form.issuerPartnerId || null;
  }
  if (mudou(nota.purchaseOrderId, form.purchaseOrderId)) {
    corpo.purchaseOrderId = form.purchaseOrderId || null;
  }
  if (mudou(nota.branchId, form.branchId)) corpo.branchId = form.branchId || null;

  const itens = nota.items
    .filter((item) => mudou(item.productId, form.itens[item.id] ?? ''))
    .map((item) => ({ itemId: item.id, productId: form.itens[item.id] || null }));
  if (itens.length > 0) corpo.items = itens;

  return corpo;
}

export const EFEITOS_VAZIO: FormEfeitos = {
  gerarEstoque: false,
  localId: '',
  gerarTitulo: false,
  categoriaId: '',
  condicaoId: '',
  primeiroVencimento: '',
  parcelas: '',
  observacao: '',
};

/**
 * O que impede gerar efeito, dito antes do clique (RF-047). O backend confere
 * tudo de novo — isto só evita a ida e volta de um 409 previsível.
 */
export function problemasEfeitos(nota: FiscalDocument, form: FormEfeitos): string[] {
  const lista: string[] = [];
  if (!form.gerarEstoque && !form.gerarTitulo) {
    lista.push('Escolha ao menos um efeito: entrada de estoque ou título a pagar.');
  }
  if (!nota.issuerPartnerId) lista.push('Vincule e salve o fornecedor emitente antes.');
  if (form.gerarEstoque) {
    if (!form.localId) lista.push('Escolha o local de estoque da entrada.');
    const semProduto = nota.items.filter((item) => !item.productId).map((item) => item.sequence);
    if (semProduto.length > 0) {
      lista.push(`Vincule e salve o produto dos itens ${semProduto.join(', ')}.`);
    }
  }
  if (form.gerarTitulo && form.parcelas !== '') {
    const parcelas = Number(form.parcelas);
    if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 120) {
      lista.push('O número de parcelas vai de 1 a 120.');
    }
  }
  return lista;
}

/** Corpo do `POST /postings` — só os campos preenchidos, efeitos sempre explícitos. */
export function montarEfeitos(form: FormEfeitos): FiscalDocumentPostingInput {
  const corpo: FiscalDocumentPostingInput = {
    generateStock: form.gerarEstoque,
    generatePayable: form.gerarTitulo,
  };
  if (form.gerarEstoque) corpo.locationId = form.localId;
  if (form.gerarTitulo) {
    const titulo: NonNullable<FiscalDocumentPostingInput['payable']> = {};
    if (form.categoriaId) titulo.categoryId = form.categoriaId;
    if (form.condicaoId) titulo.paymentTermId = form.condicaoId;
    if (form.primeiroVencimento) titulo.firstDueDate = form.primeiroVencimento;
    if (form.parcelas !== '') titulo.installmentCount = Number(form.parcelas);
    if (form.observacao.trim()) titulo.note = form.observacao.trim();
    corpo.payable = titulo;
  }
  return corpo;
}

/**
 * Vínculo do documento com fornecedor, pedido, produtos, estoque e títulos
 * (RF-047 — UI-039).
 *
 * Duas decisões separadas: **vincular** (reversível enquanto a nota não deu
 * entrada) e **gerar efeitos** (entrada de estoque e título a pagar, que não se
 * desfazem por aqui). Nota que já tem recebimento do pedido não gera efeito: a
 * entrada é do recebimento (RN-004).
 */
@Component({
  selector: 'sge-fiscal-links-panel',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    TagModule,
    Alert,
    ErrorAlert,
    SearchSelect,
    SelectField,
    TextField,
  ],
  template: `
    <section class="card secao espaco">
      <h2 class="secao__titulo">Vínculos e efeitos</h2>

      @if (aviso(); as texto) {
        <div class="bloco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
      }
      @if (erro(); as falha) {
        <div class="bloco"><sge-error-alert [erro]="falha" /></div>
      }

      <div class="efeitos">
        <div class="vinculo">
          <h3>Recebimentos</h3>
          @if (nota().receipts.length === 0) {
            <span class="secundario">Nenhum recebimento referencia esta nota.</span>
          } @else {
            <ul>
              @for (entrega of nota().receipts; track entrega.id) {
                <li>
                  @if (podeLerRecebimentos()) {
                    <a [routerLink]="['/compras/recebimentos', entrega.id]">{{ entrega.number }}</a>
                  } @else {
                    {{ entrega.number }}
                  }
                  · {{ data(entrega.receivedAt) }}
                  <span class="secundario">{{
                    entrega.generatedStock ? 'deu entrada no estoque' : 'sem entrada no estoque'
                  }}</span>
                </li>
              }
            </ul>
          }
        </div>
        <div class="vinculo">
          <h3>Estoque</h3>
          <p-tag
            [value]="nota().generatedStock ? 'Entrada registrada' : 'Sem entrada'"
            [severity]="nota().generatedStock ? 'info' : 'secondary'"
          />
          @if (nota().generatedStock && podeLerMovimentos()) {
            <a class="link-secundario" routerLink="/estoque/movimentacoes">Ver movimentações</a>
          }
        </div>
        <div class="vinculo">
          <h3>Títulos a pagar</h3>
          @if (nota().financialEntries.length === 0) {
            <span class="secundario">Nenhum título gerado por esta nota.</span>
          } @else {
            <ul>
              @for (titulo of nota().financialEntries; track titulo.id) {
                <li>
                  @if (podeLerTitulos()) {
                    <a [routerLink]="['/financeiro/titulos', titulo.id]">{{ titulo.number }}</a>
                  } @else {
                    {{ titulo.number }}
                  }
                  · {{ moeda(titulo.netAmount) }}
                  <span class="secundario">{{ rotuloTitulo(titulo.status) }}</span>
                </li>
              }
            </ul>
          }
        </div>
      </div>

      <form class="bloco" (ngSubmit)="salvarVinculos()">
        <h3 class="subtitulo">Vínculos</h3>
        @if (!editavel()) {
          <p class="secundario">{{ motivoSomenteLeitura() }}</p>
        }
        <div class="grade-campos">
          @if (podeLerParceiros()) {
            <sge-search-select
              rotulo="Fornecedor emitente"
              name="issuerPartnerId"
              dica="Reconhecido pelo CNPJ quando já cadastrado"
              [buscar]="buscarFornecedor"
              [resolver]="resolverFornecedor"
              [ngModel]="form().issuerPartnerId || null"
              (ngModelChange)="mudar('issuerPartnerId', $event ?? '')"
              [disabled]="!editavel()"
            />
          }
          @if (podeLerPedidos()) {
            <sge-search-select
              rotulo="Pedido de compra"
              name="purchaseOrderId"
              dica="Pedidos do fornecedor vinculado"
              [buscar]="buscarPedido"
              [resolver]="resolverPedido"
              [ngModel]="form().purchaseOrderId || null"
              (ngModelChange)="mudar('purchaseOrderId', $event ?? '')"
              [disabled]="!editavel()"
            />
          }
          @if (podeLerFiliais()) {
            <sge-select-field
              rotulo="Filial de destino"
              name="branchId"
              [opcoes]="opcoesFilial()"
              [ngModel]="form().branchId || null"
              (ngModelChange)="mudar('branchId', $event ?? '')"
              [disabled]="!editavel()"
            />
          }
        </div>

        @if (nota().items.length > 0 && podeLerProdutos()) {
          <table class="tabela">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Item na nota</th>
                <th scope="col">Produto do catálogo</th>
              </tr>
            </thead>
            <tbody>
              @for (item of nota().items; track item.id) {
                <tr>
                  <td>{{ item.sequence }}</td>
                  <td>
                    {{ item.description }}
                    <span class="secundario">{{ item.supplierCode ?? 'sem código' }}</span>
                  </td>
                  <td class="produto">
                    <sge-search-select
                      rotulo="Produto"
                      [name]="'produto-' + item.id"
                      [buscar]="buscarProduto"
                      [resolver]="resolverProduto"
                      [ngModel]="form().itens[item.id] || null"
                      (ngModelChange)="mudarItem(item.id, $event ?? '')"
                      [disabled]="!itensEditaveis()"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }

        @if (editavel()) {
          <div class="rodape">
            <p-button
              label="Desfazer alterações"
              severity="secondary"
              [outlined]="true"
              [disabled]="salvando() || !alterado()"
              (onClick)="reiniciar()"
            />
            <p-button
              type="submit"
              label="Salvar vínculos"
              [loading]="salvando()"
              [disabled]="salvando() || !alterado()"
            />
          </div>
        }
      </form>

      @if (podeGerar()) {
        <div class="bloco">
          <h3 class="subtitulo">Gerar efeitos</h3>
          <p class="secundario">
            Sem pedido conferido, a nota é o fato de entrada. Estoque e título não se desfazem
            por aqui: o estorno é lançamento contrário e o título se cancela no Financeiro.
          </p>

          <div class="opcoes">
            @if (pendentes().estoque) {
              <label class="opcao">
                <input
                  type="checkbox"
                  name="gerarEstoque"
                  [checked]="efeitos().gerarEstoque"
                  (change)="mudarEfeito('gerarEstoque', $any($event.target).checked)"
                />
                Dar entrada no estoque
              </label>
            }
            @if (pendentes().titulo) {
              <label class="opcao">
                <input
                  type="checkbox"
                  name="gerarTitulo"
                  [checked]="efeitos().gerarTitulo"
                  (change)="mudarEfeito('gerarTitulo', $any($event.target).checked)"
                />
                Gerar título a pagar de {{ moeda(nota().totalAmount) }}
              </label>
            }
          </div>

          <div class="grade-campos">
            @if (efeitos().gerarEstoque) {
              <sge-select-field
                rotulo="Local de estoque"
                name="localId"
                [obrigatorio]="true"
                [opcoes]="opcoesLocal()"
                [ngModel]="efeitos().localId || null"
                (ngModelChange)="mudarEfeito('localId', $event ?? '')"
              />
            }
            @if (efeitos().gerarTitulo) {
              <sge-select-field
                rotulo="Categoria financeira"
                name="categoriaId"
                dica="Opcional — categorias de pagar que aceitam lançamento"
                [opcoes]="opcoesCategoria()"
                [ngModel]="efeitos().categoriaId || null"
                (ngModelChange)="mudarEfeito('categoriaId', $event ?? '')"
              />
              <sge-select-field
                rotulo="Condição de pagamento"
                name="condicaoId"
                dica="Define o parcelamento"
                [opcoes]="opcoesCondicao()"
                [ngModel]="efeitos().condicaoId || null"
                (ngModelChange)="mudarEfeito('condicaoId', $event ?? '')"
              />
              <sge-text-field
                rotulo="Primeiro vencimento"
                name="primeiroVencimento"
                tipo="date"
                [ngModel]="efeitos().primeiroVencimento"
                (ngModelChange)="mudarEfeito('primeiroVencimento', $event)"
              />
              <sge-text-field
                rotulo="Parcelas"
                name="parcelas"
                tipo="number"
                dica="Opcional, de 1 a 120"
                [ngModel]="efeitos().parcelas"
                (ngModelChange)="mudarEfeito('parcelas', $event === null ? '' : String($event))"
              />
              <sge-text-field
                rotulo="Observação do título"
                name="observacao"
                [ngModel]="efeitos().observacao"
                (ngModelChange)="mudarEfeito('observacao', $event)"
              />
            }
          </div>

          @if (alterado() && (efeitos().gerarEstoque || efeitos().gerarTitulo)) {
            <p class="secundario">Os efeitos usam os vínculos já salvos — salve os vínculos antes.</p>
          }
          @if (problemas().length > 0 && (efeitos().gerarEstoque || efeitos().gerarTitulo)) {
            <sge-alert tom="aviso" titulo="Antes de gerar" [detalhes]="problemas()" />
          }

          <div class="rodape">
            <p-button
              label="Gerar efeitos"
              icon="pi pi-check"
              [loading]="gerando()"
              [disabled]="gerando() || problemas().length > 0"
              (onClick)="confirmacaoAberta.set(true)"
            />
          </div>
        </div>
      }
    </section>

    <p-dialog
      [visible]="confirmacaoAberta()"
      (visibleChange)="confirmacaoAberta.set($event)"
      [modal]="true"
      [style]="{ width: '34rem' }"
      header="Gerar efeitos da nota"
    >
      <p class="confirmacao">{{ resumoEfeitos() }} Esta operação não se desfaz por aqui.</p>
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          (onClick)="confirmacaoAberta.set(false)"
        />
        <p-button
          label="Confirmar"
          [loading]="gerando()"
          [disabled]="gerando()"
          (onClick)="gerar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .bloco {
      margin-top: 1.25rem;
    }
    .subtitulo {
      margin: 0 0 0.5rem;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .efeitos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: 1rem;
    }
    .vinculo h3 {
      margin: 0 0 0.4rem;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .vinculo ul {
      margin: 0;
      padding-left: 1rem;
      display: grid;
      gap: 0.4rem;
      font-size: 0.85rem;
    }
    .secundario {
      display: block;
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
    }
    .link-secundario {
      display: block;
      margin-top: 0.3rem;
      font-size: 0.75rem;
    }
    .tabela {
      width: 100%;
      margin-top: 0.75rem;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .tabela th,
    .tabela td {
      padding: 0.45rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
      vertical-align: top;
    }
    .tabela th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .produto {
      min-width: 18rem;
    }
    .opcoes {
      display: flex;
      flex-wrap: wrap;
      gap: 1.25rem;
      margin: 0.75rem 0;
      font-size: 0.85rem;
    }
    .opcao {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
    .rodape {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }
    .confirmacao {
      margin: 0.5rem 0 0;
      font-size: 0.85rem;
    }
  `,
})
export class FiscalLinksPanel {
  private readonly api = inject(FiscalDocumentsApiService);
  private readonly parceiros = inject(PartnersApiService);
  private readonly compras = inject(PurchasingApiService);
  private readonly catalogo = inject(CatalogApiService);
  private readonly filiais = inject(BranchesApiService);
  private readonly estoque = inject(StockApiService);
  private readonly configuracoes = inject(ConfigurationsApiService);
  private readonly condicoes = inject(PaymentConditionsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly nota = input.required<FiscalDocument>();
  readonly atualizada = output<FiscalDocument>();

  protected readonly form = signal<FormVinculos>({
    issuerPartnerId: '',
    purchaseOrderId: '',
    branchId: '',
    itens: {},
  });
  protected readonly efeitos = signal<FormEfeitos>({ ...EFEITOS_VAZIO });
  protected readonly salvando = signal(false);
  protected readonly gerando = signal(false);
  protected readonly confirmacaoAberta = signal(false);
  protected readonly aviso = signal<string | null>(null);
  protected readonly erro = signal<unknown>(null);

  protected readonly opcoesFilial = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesLocal = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesCategoria = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesCondicao = signal<OpcaoFiltro[]>([]);

  protected readonly podeLerParceiros = () => this.permissoes.pode('partners:READ');
  protected readonly podeLerPedidos = () => this.permissoes.pode('purchase-orders:READ');
  protected readonly podeLerProdutos = () => this.permissoes.pode('products:READ');
  protected readonly podeLerFiliais = () => this.permissoes.pode('branches:READ');
  protected readonly podeLerRecebimentos = () => this.permissoes.pode('goods-receipts:READ');
  protected readonly podeLerMovimentos = () => this.permissoes.pode('stock-movements:READ');
  protected readonly podeLerTitulos = () => this.permissoes.pode('financial-entries:READ');

  protected readonly editavel = computed(
    () => this.permissoes.pode('fiscal-documents:UPDATE') && vinculavel(this.nota()),
  );

  /** O produto do item congela quando a nota dá entrada no estoque (bd/12). */
  protected readonly itensEditaveis = computed(() => this.editavel() && !this.nota().generatedStock);

  protected readonly motivoSomenteLeitura = computed(() =>
    !this.permissoes.pode('fiscal-documents:UPDATE')
      ? 'Seu perfil pode consultar, mas não alterar os vínculos.'
      : 'Documento descartado, denegado ou duplicado não aceita vínculos (RF-047).',
  );

  protected readonly pendentes = computed(() => efeitosPendentes(this.nota()));

  protected readonly podeGerar = computed(
    () =>
      this.permissoes.pode('fiscal-postings:CREATE') &&
      (this.pendentes().estoque || this.pendentes().titulo),
  );

  protected readonly alterado = computed(
    () => Object.keys(montarVinculos(this.nota(), this.form())).length > 0,
  );

  protected readonly problemas = computed(() => problemasEfeitos(this.nota(), this.efeitos()));

  protected readonly resumoEfeitos = computed(() => {
    const form = this.efeitos();
    const partes = [];
    if (form.gerarEstoque) partes.push('dar entrada no estoque dos itens');
    if (form.gerarTitulo) partes.push(`gerar título a pagar de ${formatCurrency(this.nota().totalAmount)}`);
    return `A nota vai ${partes.join(' e ')}.`;
  });

  protected readonly buscarFornecedor = (termo: string): Observable<OpcaoFiltro[]> =>
    this.parceiros
      .list({ q: termo, role: 'FORNECEDOR', isActive: true, pageSize: LIMITE_BUSCA })
      .pipe(map((r) => r.data.map((p) => ({ value: p.id, label: p.tradeName ?? p.legalName }))));

  protected readonly resolverFornecedor = (id: string): Observable<OpcaoFiltro> => {
    const parceiro = this.nota().issuerPartner;
    if (parceiro?.id === id) return of({ value: id, label: parceiro.tradeName ?? parceiro.legalName });
    return this.parceiros.get(id).pipe(map((p) => ({ value: p.id, label: p.tradeName ?? p.legalName })));
  };

  protected readonly buscarPedido = (termo: string): Observable<OpcaoFiltro[]> =>
    this.compras
      .listOrders({
        q: termo,
        partnerId: this.form().issuerPartnerId || undefined,
        pageSize: LIMITE_BUSCA,
      })
      .pipe(map((r) => r.data.map((p) => ({ value: p.id, label: p.number }))));

  protected readonly resolverPedido = (id: string): Observable<OpcaoFiltro> => {
    const pedido = this.nota().purchaseOrder;
    if (pedido?.id === id) return of({ value: id, label: pedido.number });
    return this.compras.getOrder(id).pipe(map((p) => ({ value: p.id, label: p.number })));
  };

  protected readonly buscarProduto = (termo: string): Observable<OpcaoFiltro[]> =>
    this.catalogo
      .list({ q: termo, isActive: true, pageSize: LIMITE_BUSCA })
      .pipe(map((r) => r.data.map((p) => ({ value: p.id, label: `${p.code} — ${p.description}` }))));

  protected readonly resolverProduto = (id: string): Observable<OpcaoFiltro> => {
    const produto = this.nota().items.find((item) => item.product?.id === id)?.product;
    if (produto) return of({ value: id, label: `${produto.code} — ${produto.description}` });
    return this.catalogo
      .get(id)
      .pipe(map((p) => ({ value: p.id, label: `${p.code} — ${p.description}` })));
  };

  constructor() {
    // Documento novo (salvo aqui, reprocessado no detalhe): o formulário recomeça dele.
    effect(() => {
      const nota = this.nota();
      untracked(() => {
        this.form.set(formVinculosDe(nota));
        this.efeitos.set({ ...EFEITOS_VAZIO });
      });
    });
    this.carregarOpcoes();
  }

  protected mudar(campo: 'issuerPartnerId' | 'purchaseOrderId' | 'branchId', valor: string): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarItem(itemId: string, produtoId: string): void {
    this.form.update((atual) => ({ ...atual, itens: { ...atual.itens, [itemId]: produtoId } }));
  }

  protected mudarEfeito<K extends keyof FormEfeitos>(campo: K, valor: FormEfeitos[K]): void {
    this.efeitos.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected reiniciar(): void {
    this.form.set(formVinculosDe(this.nota()));
  }

  protected salvarVinculos(): void {
    const corpo = montarVinculos(this.nota(), this.form());
    if (this.salvando() || Object.keys(corpo).length === 0) return;
    this.salvando.set(true);
    this.aviso.set(null);
    this.erro.set(null);
    this.api
      .link(this.nota().id, corpo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registro) => {
          this.salvando.set(false);
          this.atualizada.emit(registro);
          this.aviso.set('Vínculos salvos.');
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erro.set(falha);
        },
      });
  }

  /**
   * Um clique, uma requisição: o botão trava enquanto a chamada está no ar. A
   * garantia contra o efeito em dobro é do backend — as marcas `gerou_*` e os
   * índices únicos de bd/12 recusam o replay.
   */
  protected gerar(): void {
    if (this.gerando() || this.problemas().length > 0) return;
    this.confirmacaoAberta.set(false);
    this.gerando.set(true);
    this.aviso.set(null);
    this.erro.set(null);
    this.api
      .post(this.nota().id, montarEfeitos(this.efeitos()))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registro) => {
          this.gerando.set(false);
          this.atualizada.emit(registro);
          this.aviso.set('Efeitos gerados.');
        },
        error: (falha: unknown) => {
          this.gerando.set(false);
          this.erro.set(falha);
        },
      });
  }

  /** Listas curtas de apoio, cada uma só com a permissão que a API exige. */
  private carregarOpcoes(): void {
    if (this.podeLerFiliais()) {
      this.filiais
        .list({ pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesFilial.set(r.data.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` }))),
          error: () => this.opcoesFilial.set([]),
        });
    }
    if (!this.permissoes.pode('fiscal-postings:CREATE')) return;

    if (this.permissoes.pode('stock-locations:READ')) {
      this.estoque
        .listLocations({ pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesLocal.set(
              r.data
                .filter((l) => l.isActive)
                .map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` })),
            ),
          error: () => this.opcoesLocal.set([]),
        });
    }
    if (this.permissoes.pode('categories:READ')) {
      this.configuracoes
        .listCategories({ pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesCategoria.set(
              r.data
                .filter((c) => c.type === 'PAGAR' && c.acceptsEntry && c.isActive)
                .map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
            ),
          error: () => this.opcoesCategoria.set([]),
        });
    }
    if (this.permissoes.pode('payment-terms:READ')) {
      this.condicoes
        .listTerms({ pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesCondicao.set(r.data.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))),
          error: () => this.opcoesCondicao.set([]),
        });
    }
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected rotuloTitulo(status: keyof typeof ROTULO_STATUS_TITULO): string {
    return ROTULO_STATUS_TITULO[status] ?? status;
  }

  protected readonly String = String;
}
