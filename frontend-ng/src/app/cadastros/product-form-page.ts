import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { CatalogApiService } from '../core/api/catalog-api.service';
import { PartnersApiService } from '../core/api/partners-api.service';
import type {
  ItemType,
  Product,
  ProductInput,
  ProductSupplier,
  ProductSupplierInput,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency, formatDecimal } from '../core/lib/decimal';
import { Alert } from '../ui/alert';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { OPCOES_ITEM, OPCOES_ORIGEM, ROTULO_ITEM } from './rotulos';

interface Formulario {
  type: string;
  code: string;
  barcode: string;
  description: string;
  extraDescription: string;
  categoryId: string;
  unitId: string;
  ncm: string;
  cest: string;
  defaultInboundCfop: string;
  defaultOutboundCfop: string;
  goodsOrigin: string;
  serviceCodeLc116: string;
  salePrice: string;
  defaultMargin: string;
  tracksStock: boolean;
  minStock: string;
  maxStock: string;
}

const VAZIO: Formulario = {
  type: 'PRODUTO',
  code: '',
  barcode: '',
  description: '',
  extraDescription: '',
  categoryId: '',
  unitId: '',
  ncm: '',
  cest: '',
  defaultInboundCfop: '',
  defaultOutboundCfop: '',
  goodsOrigin: '',
  serviceCodeLc116: '',
  salePrice: '',
  defaultMargin: '',
  tracksStock: true,
  minStock: '',
  maxStock: '',
};

interface FormularioFornecedor {
  partnerId: string;
  supplierCode: string;
  referencePrice: string;
  deliveryDays: string;
  isPreferred: boolean;
}

const FORNECEDOR_VAZIO: FormularioFornecedor = {
  partnerId: '',
  supplierCode: '',
  referencePrice: '',
  deliveryDays: '',
  isPreferred: false,
};

/**
 * Cadastro do item do catálogo com dados fiscais (RF-028 a RF-030 — UI-020).
 *
 * Um formulário só para produto e serviço: o bloco fiscal troca conforme o
 * tipo, porque mercadoria usa NCM/CEST/CFOP e serviço usa o código da LC 116.
 * Mostrar os dois ao mesmo tempo convidaria a preencher o campo errado.
 *
 * Preço e quantidade têm até 6 casas decimais (`UNIT_VALUE_PATTERN`), e o custo
 * médio não é editável: ele é resultado da movimentação de estoque (RF-034).
 */
@Component({
  selector: 'sge-product-form-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    TagModule,
    Alert,
    DecimalField,
    ErrorAlert,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Cadastros / Catálogo / {{ titulo() }}</p>

    <div class="pagehead">
      <div>
        <h1>{{ titulo() }}</h1>
        <p>{{ subtitulo() }}</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          routerLink="/cadastros/catalogo"
        />
        @if (podeSalvar()) {
          <p-button
            label="Salvar"
            icon="pi pi-check"
            [loading]="salvando()"
            [disabled]="salvando()"
            (onClick)="salvar()"
          />
        }
      </div>
    </div>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    <section class="card secao">
      <h2 class="secao__titulo">Identificação</h2>
      <div class="grade-campos">
        <sge-select-field
          rotulo="Tipo"
          name="type"
          [opcoes]="OPCOES_ITEM"
          [obrigatorio]="true"
          [ngModel]="form().type"
          (ngModelChange)="mudar('type', $event ?? '')"
        />
        <sge-text-field
          rotulo="Código"
          name="code"
          [obrigatorio]="true"
          [ngModel]="form().code"
          (ngModelChange)="mudar('code', $event)"
        />
        <sge-text-field
          rotulo="Descrição"
          name="description"
          [obrigatorio]="true"
          [ngModel]="form().description"
          (ngModelChange)="mudar('description', $event)"
        />
        <sge-text-field
          rotulo="Descrição complementar"
          name="extraDescription"
          [ngModel]="form().extraDescription"
          (ngModelChange)="mudar('extraDescription', $event)"
        />
        <sge-text-field
          rotulo="Código de barras"
          name="barcode"
          dica="8 a 14 dígitos"
          [ngModel]="form().barcode"
          (ngModelChange)="mudar('barcode', $event)"
        />
        <sge-select-field
          rotulo="Categoria"
          name="categoryId"
          [opcoes]="opcoesCategoria()"
          [ngModel]="form().categoryId"
          (ngModelChange)="mudar('categoryId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Unidade de medida"
          name="unitId"
          [opcoes]="opcoesUnidade()"
          [ngModel]="form().unitId"
          (ngModelChange)="mudar('unitId', $event ?? '')"
        />
      </div>
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Dados fiscais</h2>
      @if (mercadoria()) {
        <div class="grade-campos">
          <sge-text-field
            rotulo="NCM"
            name="ncm"
            dica="8 dígitos"
            [ngModel]="form().ncm"
            (ngModelChange)="mudar('ncm', $event)"
          />
          <sge-text-field
            rotulo="CEST"
            name="cest"
            dica="7 dígitos"
            [ngModel]="form().cest"
            (ngModelChange)="mudar('cest', $event)"
          />
          <sge-text-field
            rotulo="CFOP padrão de entrada"
            name="defaultInboundCfop"
            dica="4 dígitos"
            [ngModel]="form().defaultInboundCfop"
            (ngModelChange)="mudar('defaultInboundCfop', $event)"
          />
          <sge-text-field
            rotulo="CFOP padrão de saída"
            name="defaultOutboundCfop"
            dica="4 dígitos"
            [ngModel]="form().defaultOutboundCfop"
            (ngModelChange)="mudar('defaultOutboundCfop', $event)"
          />
          <sge-select-field
            rotulo="Origem da mercadoria"
            name="goodsOrigin"
            [opcoes]="OPCOES_ORIGEM"
            [ngModel]="form().goodsOrigin"
            (ngModelChange)="mudar('goodsOrigin', $event ?? '')"
          />
        </div>
      } @else {
        <div class="grade-campos">
          <sge-text-field
            rotulo="Código do serviço (LC 116)"
            name="serviceCodeLc116"
            [ngModel]="form().serviceCodeLc116"
            (ngModelChange)="mudar('serviceCodeLc116', $event)"
          />
        </div>
        <p class="nota">
          Serviço não usa NCM, CEST nem CFOP: a tributação sai do código da LC 116.
        </p>
      }
    </section>

    <section class="card secao">
      <h2 class="secao__titulo">Preço e estoque</h2>
      <div class="grade-campos">
        <sge-decimal-field
          rotulo="Preço de venda"
          name="salePrice"
          [casas]="6"
          [ngModel]="form().salePrice"
          (ngModelChange)="mudar('salePrice', $event ?? '')"
        />
        <sge-decimal-field
          rotulo="Margem padrão (%)"
          name="defaultMargin"
          [casas]="6"
          [ngModel]="form().defaultMargin"
          (ngModelChange)="mudar('defaultMargin', $event ?? '')"
        />
        <label class="marcador">
          <p-checkbox
            name="tracksStock"
            [binary]="true"
            [ngModel]="form().tracksStock"
            (ngModelChange)="mudar('tracksStock', $event)"
          />
          <span>Controla estoque</span>
        </label>
        @if (form().tracksStock) {
          <sge-decimal-field
            rotulo="Estoque mínimo"
            name="minStock"
            [casas]="6"
            [ngModel]="form().minStock"
            (ngModelChange)="mudar('minStock', $event ?? '')"
          />
          <sge-decimal-field
            rotulo="Estoque máximo"
            name="maxStock"
            [casas]="6"
            [ngModel]="form().maxStock"
            (ngModelChange)="mudar('maxStock', $event ?? '')"
          />
        }
      </div>
      @if (registro(); as item) {
        <p class="nota">
          Custo médio atual: {{ moeda(item.averageCost) }}. Não é editável aqui — sai da
          movimentação de estoque (RF-034).
        </p>
      }
    </section>

    @if (registro(); as item) {
      <section class="card secao">
        <div class="table-card__head">
          <h2 class="secao__titulo">Fornecedores homologados (RF-030)</h2>
          @if (podeCriarFornecedor()) {
            <p-button
              label="Novo fornecedor"
              icon="pi pi-plus"
              size="small"
              [outlined]="true"
              (onClick)="abrirNovoFornecedor()"
            />
          }
        </div>

        @if (!podeVerFornecedores()) {
          <p class="nota">Sem permissão para ver os fornecedores deste item.</p>
        } @else if (fornecedores().length === 0) {
          <p class="nota">Nenhum fornecedor homologado.</p>
        } @else {
          <table class="filhos">
            <thead>
              <tr>
                <th scope="col">Fornecedor</th>
                <th scope="col">Código no fornecedor</th>
                <th scope="col" class="coluna--numerica">Preço de referência</th>
                <th scope="col">Prazo</th>
                <th scope="col">Preferencial</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              @for (fornecedor of fornecedores(); track fornecedor.id) {
                <tr>
                  <td>{{ fornecedor.partner?.legalName ?? fornecedor.partnerId }}</td>
                  <td>{{ fornecedor.supplierCode ?? '—' }}</td>
                  <td class="coluna--numerica">{{ referencia(fornecedor) }}</td>
                  <td>
                    {{ fornecedor.deliveryDays !== null ? fornecedor.deliveryDays + ' dias' : '—' }}
                  </td>
                  <td>
                    <p-tag
                      [value]="fornecedor.isPreferred ? 'Preferencial' : 'Alternativo'"
                      [severity]="fornecedor.isPreferred ? 'success' : 'secondary'"
                      [rounded]="true"
                    />
                  </td>
                  <td class="acoes">
                    @if (podeRemoverFornecedor()) {
                      <p-button
                        label="Remover"
                        severity="secondary"
                        [text]="true"
                        size="small"
                        (onClick)="removerFornecedor(fornecedor)"
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
      [visible]="fornecedorAberto()"
      (visibleChange)="fornecedorAberto.set($event)"
      [modal]="true"
      [style]="{ width: '40rem' }"
      header="Novo fornecedor homologado"
    >
      @if (erroFornecedor(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvarFornecedor()">
        <sge-select-field
          rotulo="Fornecedor"
          name="partnerId"
          [opcoes]="opcoesFornecedor()"
          [obrigatorio]="true"
          [ngModel]="formFornecedor().partnerId"
          (ngModelChange)="mudarFornecedor('partnerId', $event ?? '')"
        />
        <sge-text-field
          rotulo="Código no fornecedor"
          name="supplierCode"
          [ngModel]="formFornecedor().supplierCode"
          (ngModelChange)="mudarFornecedor('supplierCode', $event)"
        />
        <sge-decimal-field
          rotulo="Preço de referência"
          name="referencePrice"
          [casas]="6"
          [ngModel]="formFornecedor().referencePrice"
          (ngModelChange)="mudarFornecedor('referencePrice', $event ?? '')"
        />
        <sge-text-field
          rotulo="Prazo de entrega"
          name="deliveryDays"
          tipo="number"
          dica="Em dias"
          [ngModel]="formFornecedor().deliveryDays"
          (ngModelChange)="mudarFornecedor('deliveryDays', $event)"
        />
        <label class="marcador">
          <p-checkbox
            name="isPreferred"
            [binary]="true"
            [ngModel]="formFornecedor().isPreferred"
            (ngModelChange)="mudarFornecedor('isPreferred', $event)"
          />
          <span>Fornecedor preferencial</span>
        </label>
      </form>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="fornecedorAberto.set(false)"
        />
        <p-button
          label="Homologar"
          icon="pi pi-check"
          [loading]="salvandoFornecedor()"
          [disabled]="salvandoFornecedor()"
          (onClick)="salvarFornecedor()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.5rem;
    }
    .marcador {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--p-text-color);
    }
    .filhos {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .filhos th,
    .filhos td {
      padding: 0.5rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .filhos th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .filhos .coluna--numerica {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class ProductFormPage {
  private readonly api = inject(CatalogApiService);
  private readonly parceiros = inject(PartnersApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly OPCOES_ITEM = OPCOES_ITEM;
  protected readonly OPCOES_ORIGEM = OPCOES_ORIGEM;

  protected readonly novo = signal(false);
  protected readonly registro = signal<Product | null>(null);
  protected readonly form = signal<Formulario>({ ...VAZIO });
  protected readonly salvando = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly fornecedores = signal<ProductSupplier[]>([]);
  protected readonly fornecedorAberto = signal(false);
  protected readonly formFornecedor = signal<FormularioFornecedor>({ ...FORNECEDOR_VAZIO });
  protected readonly salvandoFornecedor = signal(false);
  protected readonly erroFornecedor = signal<unknown>(null);

  protected readonly opcoesCategoria = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesUnidade = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesFornecedor = signal<OpcaoFiltro[]>([]);

  protected readonly titulo = computed(() => this.registro()?.description ?? 'Novo item');

  protected readonly subtitulo = computed(() => {
    const item = this.registro();
    if (!item) return 'Catálogo com unidade, categoria, preço e dados fiscais (RF-028 a RF-030).';
    const partes = [
      item.code,
      ROTULO_ITEM[item.type],
      item.unit ? `unidade ${item.unit.symbol}` : null,
    ].filter(Boolean);
    return `${partes.join(' · ')}.`;
  });

  /** Serviço não tem NCM/CEST/CFOP: a tributação sai do código da LC 116. */
  protected readonly mercadoria = computed(() => this.form().type !== 'SERVICO');

  protected readonly podeSalvar = () =>
    this.novo() ? this.permissoes.pode('products:CREATE') : this.permissoes.pode('products:UPDATE');
  protected readonly podeVerFornecedores = () => this.permissoes.pode('product-suppliers:READ');
  protected readonly podeCriarFornecedor = () => this.permissoes.pode('product-suppliers:CREATE');
  protected readonly podeRemoverFornecedor = () => this.permissoes.pode('product-suppliers:DELETE');

  constructor() {
    const id = this.rota.snapshot.paramMap.get('id');
    if (id === 'novo' || id === null) {
      this.novo.set(true);
    } else {
      this.carregar(id);
    }
    this.carregarReferencias();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected referencia(fornecedor: ProductSupplier): string {
    return fornecedor.referencePrice ? `R$ ${formatDecimal(fornecedor.referencePrice, 6)}` : '—';
  }

  protected mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarFornecedor<K extends keyof FormularioFornecedor>(
    campo: K,
    valor: FormularioFornecedor[K],
  ): void {
    this.formFornecedor.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected salvar(): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erro.set(null);
    this.aviso.set(null);

    const alvo = this.registro();
    const corpo = this.paraDto();
    const requisicao = alvo
      ? this.api.update(alvo.id, corpo)
      : this.api.create(corpo as ProductInput);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (item) => {
        this.salvando.set(false);
        if (alvo) {
          this.aplicar(item);
          this.aviso.set('Item atualizado.');
        } else {
          // Vira edição: os fornecedores homologados só existem com o item criado.
          void this.router.navigate(['/cadastros/catalogo', item.id]);
        }
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erro.set(falha);
      },
    });
  }

  protected abrirNovoFornecedor(): void {
    this.formFornecedor.set({ ...FORNECEDOR_VAZIO });
    this.erroFornecedor.set(null);
    this.fornecedorAberto.set(true);
  }

  protected salvarFornecedor(): void {
    const item = this.registro();
    if (!item || this.salvandoFornecedor()) return;
    this.salvandoFornecedor.set(true);
    this.erroFornecedor.set(null);

    const form = this.formFornecedor();
    const corpo: ProductSupplierInput = {
      partnerId: form.partnerId,
      isPreferred: form.isPreferred,
    };
    if (form.supplierCode.trim() !== '') corpo.supplierCode = form.supplierCode.trim();
    if (form.referencePrice.trim() !== '') corpo.referencePrice = form.referencePrice;
    const prazo = form.deliveryDays.trim();
    if (prazo !== '' && /^\d+$/.test(prazo)) corpo.deliveryDays = Number(prazo);

    this.api
      .createSupplier(item.id, corpo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.salvandoFornecedor.set(false);
          this.fornecedorAberto.set(false);
          this.aviso.set('Fornecedor homologado.');
          this.carregarFornecedores(item.id);
        },
        error: (falha: unknown) => {
          this.salvandoFornecedor.set(false);
          this.erroFornecedor.set(falha);
        },
      });
  }

  protected removerFornecedor(fornecedor: ProductSupplier): void {
    const item = this.registro();
    if (!item) return;
    this.api
      .removeSupplier(item.id, fornecedor.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set('Fornecedor removido.');
          this.carregarFornecedores(item.id);
        },
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private carregar(id: string): void {
    this.api
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (item) => {
          this.aplicar(item);
          this.carregarFornecedores(item.id);
        },
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private carregarFornecedores(id: string): void {
    if (!this.podeVerFornecedores()) return;
    this.api
      .listSuppliers(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (linhas) => this.fornecedores.set(linhas),
        error: () => this.fornecedores.set([]),
      });
  }

  private aplicar(item: Product): void {
    this.registro.set(item);
    this.novo.set(false);
    this.form.set({
      type: item.type,
      code: item.code,
      barcode: item.barcode ?? '',
      description: item.description,
      extraDescription: item.extraDescription ?? '',
      categoryId: item.categoryId ?? '',
      unitId: item.unitId ?? '',
      ncm: item.ncm ?? '',
      cest: item.cest ?? '',
      defaultInboundCfop: item.defaultInboundCfop ?? '',
      defaultOutboundCfop: item.defaultOutboundCfop ?? '',
      goodsOrigin: item.goodsOrigin != null ? String(item.goodsOrigin) : '',
      serviceCodeLc116: item.serviceCodeLc116 ?? '',
      salePrice: item.salePrice ?? '',
      defaultMargin: item.defaultMargin ?? '',
      tracksStock: item.tracksStock,
      minStock: item.minStock,
      maxStock: item.maxStock ?? '',
    });
  }

  /**
   * Campo em branco não vai no corpo: o backend valida cada opcional com
   * `@Matches`, e mandar `""` num NCM vira 400 em vez de "não informado".
   *
   * Os campos fiscais do tipo que não está em uso também ficam de fora: um
   * serviço não pode viajar com NCM só porque o campo já foi preenchido antes.
   */
  private paraDto(): Partial<ProductInput> {
    const form = this.form();
    const dto: Partial<ProductInput> = {
      type: form.type as ItemType,
      code: form.code.trim(),
      description: form.description.trim(),
      tracksStock: form.tracksStock,
    };

    const opcionais: [keyof ProductInput, string][] = [
      ['barcode', form.barcode.replace(/\D/g, '')],
      ['extraDescription', form.extraDescription],
      ['categoryId', form.categoryId],
      ['unitId', form.unitId],
      ['salePrice', form.salePrice],
      ['defaultMargin', form.defaultMargin],
      ...(this.mercadoria()
        ? ([
            ['ncm', form.ncm.replace(/\D/g, '')],
            ['cest', form.cest.replace(/\D/g, '')],
            ['defaultInboundCfop', form.defaultInboundCfop.replace(/\D/g, '')],
            ['defaultOutboundCfop', form.defaultOutboundCfop.replace(/\D/g, '')],
          ] as [keyof ProductInput, string][])
        : ([['serviceCodeLc116', form.serviceCodeLc116]] as [keyof ProductInput, string][])),
      ...(form.tracksStock
        ? ([
            ['minStock', form.minStock],
            ['maxStock', form.maxStock],
          ] as [keyof ProductInput, string][])
        : []),
    ];
    for (const [chave, valor] of opcionais) {
      const limpo = valor.trim();
      if (limpo !== '') Object.assign(dto, { [chave]: limpo });
    }

    const origem = form.goodsOrigin.trim();
    if (this.mercadoria() && origem !== '' && /^\d$/.test(origem)) {
      dto.goodsOrigin = Number(origem);
    }
    return dto;
  }

  private carregarReferencias(): void {
    if (this.permissoes.pode('product-categories:READ')) {
      this.api
        .listCategories({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesCategoria.set(
              r.data.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
            ),
          error: () => this.opcoesCategoria.set([]),
        });
    }

    if (this.permissoes.pode('units-of-measure:READ')) {
      this.api
        .listUnits({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesUnidade.set(
              r.data.map((u) => ({ value: u.id, label: `${u.symbol} — ${u.description}` })),
            ),
          error: () => this.opcoesUnidade.set([]),
        });
    }

    if (this.permissoes.pode('partners:READ')) {
      // Só fornecedores: homologar um cliente puro seria erro de cadastro.
      this.parceiros
        .list({ pageSize: 100, isActive: true, role: 'FORNECEDOR' })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesFornecedor.set(
              r.data.map((p) => ({ value: p.id, label: p.tradeName ?? p.legalName })),
            ),
          error: () => this.opcoesFornecedor.set([]),
        });
    }
  }
}
