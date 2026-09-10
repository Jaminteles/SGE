import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { FiscalDocumentsApiService } from '../core/api/fiscal-documents-api.service';
import { PurchasingApiService } from '../core/api/purchasing-api.service';
import { StockApiService } from '../core/api/stock-api.service';
import type {
  GoodsReceiptInput,
  GoodsReceiptItemInput,
  GoodsReceiptPayableInput,
  PurchaseOrder,
  PurchaseOrderItem,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency, formatDecimal } from '../core/lib/decimal';
import { dataValida, somar } from '../financeiro/dinheiro';
import { Alert } from '../ui/alert';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  CASAS_UNITARIAS,
  compararUnitario,
  positivo,
  saldoPendente,
  subtrairQuantidade,
  valorBruto,
} from './calculo';
import { aceitaRecebimento, fornecedor, type Severidade } from './rotulos';

/** Conferência de um item do pedido na tela. */
interface LinhaConferencia {
  itemId: string;
  /** Item que chegou nesta entrega; os demais não vão para o DTO. */
  incluir: boolean;
  receivedQuantity: string | null;
  /** Vazio = igual ao preço do pedido. */
  documentPrice: string | null;
  accepted: boolean;
  locationId: string;
  batch: string;
  note: string;
}

interface Cabecalho {
  receivedAt: string;
  locationId: string;
  fiscalDocumentId: string;
  note: string;
  generatePayable: boolean;
  firstDueDate: string;
  installmentCount: string;
  documentReference: string;
}

/** Resultado da conferência de uma linha, antes de enviar (RF-040). */
export interface Analise {
  pendente: string;
  /** Aceita acima do saldo: o servidor recusa (RF-039). */
  acimaDoSaldo: boolean;
  parcial: boolean;
  divergePreco: boolean;
  recusada: boolean;
  exigeJustificativa: boolean;
  situacao: string;
  severidade: Severidade;
}

function texto(valor: string): string | undefined {
  const limpo = valor.trim();
  return limpo === '' ? undefined : limpo;
}

/**
 * Confere uma linha contra o item do pedido, com a mesma régua do backend:
 * aceitar acima do saldo é recusado; entregar menos, pagar outro preço ou
 * recusar a mercadoria é divergência — e divergência exige justificativa, que
 * vai para a trilha do recebimento (UI-033).
 */
export function analisarLinha(item: PurchaseOrderItem, linha: LinhaConferencia): Analise {
  const pendente = saldoPendente(item);
  const recebida = linha.receivedQuantity;
  const recusada = !linha.accepted;
  const acimaDoSaldo = !recusada && compararUnitario(recebida, pendente) > 0;
  const parcial = !recusada && positivo(recebida) && compararUnitario(recebida, pendente) < 0;
  const divergePreco =
    linha.documentPrice !== null && compararUnitario(linha.documentPrice, item.unitPrice) !== 0;

  let situacao = 'Conferido';
  let severidade: Severidade = 'success';
  if (recusada) {
    situacao = 'Recusado';
    severidade = 'danger';
  } else if (acimaDoSaldo) {
    situacao = 'Acima do saldo';
    severidade = 'danger';
  } else if (parcial && divergePreco) {
    situacao = 'Parcial e preço divergente';
    severidade = 'warn';
  } else if (parcial) {
    situacao = `Parcial — ${formatDecimal(subtrairQuantidade(pendente, recebida), CASAS_UNITARIAS)} segue pendente`;
    severidade = 'warn';
  } else if (divergePreco) {
    situacao = 'Preço divergente';
    severidade = 'warn';
  }

  return {
    pendente,
    acimaDoSaldo,
    parcial,
    divergePreco,
    recusada,
    exigeJustificativa: recusada || parcial || divergePreco,
    situacao,
    severidade,
  };
}

/**
 * Recebimento total ou parcial com conferência de quantidade e preço
 * (RF-039/RF-040 — UI-032) e tratamento das divergências com justificativa
 * (RF-040 — UI-033).
 *
 * O recebimento é append-only no banco: corrigir uma conferência é registrar
 * outra. Por isso a tela confere tudo antes de enviar — saldo, preço, local de
 * estoque e justificativa — e mostra o valor da mercadoria como **prévia**: o
 * título a pagar leva também a parcela do frete, que o servidor calcula.
 *
 * O botão fica travado enquanto a requisição está no ar: a mesma entrega
 * enviada duas vezes seriam duas entradas no estoque.
 */
@Component({
  selector: 'sge-goods-receipt-form-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    TagModule,
    Alert,
    DecimalField,
    ErrorAlert,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Compras / Pedidos / {{ numero() }} / Receber</p>

    <div class="pagehead">
      <div>
        <h1>Receber pedido {{ numero() }}</h1>
        <p>{{ subtitulo() }}</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          [routerLink]="['/compras/pedidos', orderId]"
        />
        <p-button
          label="Registrar recebimento"
          icon="pi pi-check"
          [loading]="enviando()"
          [disabled]="enviando() || bloqueado() || problemas().length > 0"
          (onClick)="registrar()"
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
          titulo="Este pedido não aceita recebimento"
          mensagem="Só pedido aprovado ou parcialmente recebido recebe mercadoria (RF-038/RF-039)."
        />
      </div>
    }

    @if (tentouEnviar() && problemas().length > 0) {
      <div class="espaco">
        <sge-alert tom="aviso" titulo="Revise a conferência" [detalhes]="problemas()" />
      </div>
    }

    <div class="kpis">
      <div class="kpi">
        <p class="kpi__label">Itens nesta entrega</p>
        <p class="kpi__value">{{ incluidas() }} de {{ linhas().length }}</p>
      </div>
      <div class="kpi">
        <p class="kpi__label">Com divergência</p>
        <p class="kpi__value">{{ divergentes() }}</p>
        <p class="kpi__detail">parcial, preço ou recusa</p>
      </div>
      <div class="kpi">
        <p class="kpi__label">Valor da mercadoria aceita</p>
        <p class="kpi__value">{{ moeda(valorAceito()) }}</p>
        <p class="kpi__detail">prévia, sem o rateio do frete</p>
      </div>
    </div>

    <section class="card secao espaco">
      <h2 class="secao__titulo">Entrega</h2>
      <div class="grade-campos">
        <sge-text-field
          rotulo="Recebido em"
          name="receivedAt"
          tipo="datetime-local"
          dica="Vazio = agora"
          [ngModel]="cabecalho().receivedAt"
          (ngModelChange)="mudar('receivedAt', $event)"
        />
        @if (opcoesLocal().length > 0) {
          <sge-select-field
            rotulo="Local de estoque padrão"
            name="locationId"
            dica="Vale para o item sem local próprio"
            [opcoes]="opcoesLocal()"
            [ngModel]="cabecalho().locationId || null"
            (ngModelChange)="mudar('locationId', $event ?? '')"
          />
        }
        @if (podeLerNotas()) {
          <sge-select-field
            rotulo="Nota fiscal da entrega"
            name="fiscalDocumentId"
            dica="Notas processadas do fornecedor do pedido — não dá para vincular depois"
            [opcoes]="opcoesNota()"
            [ngModel]="cabecalho().fiscalDocumentId || null"
            (ngModelChange)="mudar('fiscalDocumentId', $event ?? '')"
          />
        }
        <sge-text-field
          rotulo="Observação"
          name="note"
          [ngModel]="cabecalho().note"
          (ngModelChange)="mudar('note', $event)"
        />
      </div>
    </section>

    <section class="card secao espaco">
      <h2 class="secao__titulo">Conferência (RF-040)</h2>
      @if (linhas().length === 0) {
        <p class="nota">Nenhum item com saldo pendente neste pedido.</p>
      }
      @for (linha of linhas(); track linha.itemId; let indice = $index) {
        @if (itemDe(linha); as item) {
          <div class="linha" [class.linha--fora]="!linha.incluir">
            <div class="linha__cabecalho">
              <label class="marcador">
                <input
                  type="checkbox"
                  [checked]="linha.incluir"
                  (change)="mudarLinha(indice, 'incluir', $any($event.target).checked)"
                />
                <strong>{{ item.sequence }}. {{ item.description }}</strong>
              </label>
              <span class="secundario">
                pedida {{ quantidade(item.quantity) }} · recebida
                {{ quantidade(item.receivedQuantity) }} · pendente
                {{ quantidade(analise(linha).pendente) }} · preço
                {{ unitario(item.unitPrice) }}
              </span>
              @if (linha.incluir) {
                <p-tag
                  [value]="analise(linha).situacao"
                  [severity]="analise(linha).severidade"
                  [rounded]="true"
                />
              }
            </div>
            @if (linha.incluir) {
              <div class="grade-campos">
                <sge-decimal-field
                  rotulo="Quantidade recebida"
                  [name]="'recebida-' + linha.itemId"
                  [casas]="casasUnitarias"
                  [obrigatorio]="true"
                  [ngModel]="linha.receivedQuantity"
                  (ngModelChange)="mudarLinha(indice, 'receivedQuantity', $event)"
                />
                <sge-decimal-field
                  rotulo="Preço no documento"
                  [name]="'preco-' + linha.itemId"
                  [casas]="casasUnitarias"
                  dica="Vazio = igual ao pedido"
                  [ngModel]="linha.documentPrice"
                  (ngModelChange)="mudarLinha(indice, 'documentPrice', $event)"
                />
                @if (opcoesLocal().length > 0 && item.product?.tracksStock) {
                  <sge-select-field
                    rotulo="Local de estoque"
                    [name]="'local-' + linha.itemId"
                    [opcoes]="opcoesLocal()"
                    [ngModel]="linha.locationId || null"
                    (ngModelChange)="mudarLinha(indice, 'locationId', $event ?? '')"
                  />
                }
                <sge-text-field
                  rotulo="Lote / série"
                  [name]="'lote-' + linha.itemId"
                  [ngModel]="linha.batch"
                  (ngModelChange)="mudarLinha(indice, 'batch', $event)"
                />
                <sge-text-field
                  [rotulo]="
                    analise(linha).exigeJustificativa
                      ? 'Justificativa da divergência'
                      : 'Observação'
                  "
                  [name]="'nota-' + linha.itemId"
                  [obrigatorio]="analise(linha).exigeJustificativa"
                  [dica]="
                    analise(linha).exigeJustificativa
                      ? 'Obrigatória: fica registrada na conferência'
                      : ''
                  "
                  [ngModel]="linha.note"
                  (ngModelChange)="mudarLinha(indice, 'note', $event)"
                />
                <label class="marcador marcador--campo">
                  <input
                    type="checkbox"
                    [checked]="!linha.accepted"
                    (change)="mudarLinha(indice, 'accepted', !$any($event.target).checked)"
                  />
                  Recusar a mercadoria desta linha
                </label>
              </div>
            }
          </div>
        }
      }
      <p class="nota">
        Linha recusada fica registrada, mas não abate o pedido nem entra no estoque. O recebimento
        não é editável depois: corrigir é registrar outra conferência.
      </p>
    </section>

    <section class="card secao espaco">
      <h2 class="secao__titulo">Financeiro (RF-041)</h2>
      <label class="marcador">
        <input
          type="checkbox"
          [checked]="cabecalho().generatePayable"
          (change)="mudar('generatePayable', $any($event.target).checked)"
        />
        Gerar o título a pagar do que foi aceito
      </label>
      @if (cabecalho().generatePayable) {
        <div class="grade-campos espaco">
          <sge-text-field
            rotulo="1º vencimento"
            name="firstDueDate"
            tipo="date"
            [dica]="dicaCondicao()"
            [ngModel]="cabecalho().firstDueDate"
            (ngModelChange)="mudar('firstDueDate', $event)"
          />
          <sge-text-field
            rotulo="Parcelas"
            name="installmentCount"
            tipo="number"
            dica="Vazio = a condição do pedido"
            [ngModel]="cabecalho().installmentCount"
            (ngModelChange)="mudar('installmentCount', '' + ($event ?? ''))"
          />
          <sge-text-field
            rotulo="Documento de referência"
            name="documentReference"
            dica="NF ou outro documento do fornecedor"
            [ngModel]="cabecalho().documentReference"
            (ngModelChange)="mudar('documentReference', $event)"
          />
        </div>
        <p class="nota">
          O valor do título é o que chegou, pelo preço do documento, mais a parcela do frete e das
          despesas do pedido — calculado pelo servidor, não digitado.
        </p>
      }
    </section>
  `,
  styles: `
    .linha {
      padding: 0.75rem 0;
      border-top: 1px solid var(--p-content-border-color);
    }
    .linha--fora {
      opacity: 0.6;
    }
    .linha__cabecalho {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
      margin-bottom: 0.5rem;
      font-size: 0.85rem;
    }
    .secundario {
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
    }
    .marcador {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .marcador--campo {
      align-self: end;
      padding-bottom: 0.5rem;
    }
  `,
})
export class GoodsReceiptFormPage {
  private readonly api = inject(PurchasingApiService);
  private readonly fiscais = inject(FiscalDocumentsApiService);
  private readonly estoque = inject(StockApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly orderId = this.rota.snapshot.paramMap.get('id') ?? '';
  protected readonly casasUnitarias = CASAS_UNITARIAS;

  protected readonly pedido = signal<PurchaseOrder | null>(null);
  protected readonly linhas = signal<LinhaConferencia[]>([]);
  protected readonly cabecalho = signal<Cabecalho>({
    receivedAt: '',
    locationId: '',
    fiscalDocumentId: '',
    note: '',
    generatePayable: false,
    firstDueDate: '',
    installmentCount: '',
    documentReference: '',
  });
  protected readonly enviando = signal(false);
  protected readonly tentouEnviar = signal(false);
  protected readonly erro = signal<unknown>(null);

  protected readonly opcoesLocal = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesNota = signal<OpcaoFiltro[]>([]);

  protected readonly podeLerNotas = () => this.permissoes.pode('fiscal-documents:READ');

  protected readonly numero = computed(() => this.pedido()?.number ?? '—');

  protected readonly subtitulo = computed(() => {
    const registro = this.pedido();
    if (!registro) return 'Recebimento total ou parcial, com conferência de quantidade e preço.';
    return `${fornecedor(registro)} · recebimento total ou parcial, com conferência (RF-039/RF-040).`;
  });

  protected readonly bloqueado = computed(() => {
    const registro = this.pedido();
    return registro !== null && !aceitaRecebimento(registro);
  });

  private readonly itens = computed(
    () => new Map((this.pedido()?.items ?? []).map((item) => [item.id, item])),
  );

  private readonly analises = computed(() => {
    const itens = this.itens();
    return new Map(
      this.linhas().flatMap((linha) => {
        const item = itens.get(linha.itemId);
        return item ? [[linha.itemId, analisarLinha(item, linha)] as const] : [];
      }),
    );
  });

  protected readonly incluidas = computed(() => this.linhas().filter((l) => l.incluir).length);

  protected readonly divergentes = computed(
    () =>
      this.linhas().filter((l) => l.incluir && this.analises().get(l.itemId)?.exigeJustificativa)
        .length,
  );

  /** Mercadoria aceita pelo preço do documento (ou do pedido) — prévia, em centavos. */
  protected readonly valorAceito = computed(() => {
    const itens = this.itens();
    return somar(
      ...this.linhas()
        .filter((linha) => linha.incluir && linha.accepted)
        .map((linha) => {
          const item = itens.get(linha.itemId);
          return item
            ? valorBruto(linha.receivedQuantity, linha.documentPrice ?? item.unitPrice)
            : '0';
        }),
    );
  });

  protected readonly dicaCondicao = computed(() => {
    const condicao = this.pedido()?.paymentTerm;
    return condicao ? `Vazio = pela condição do pedido (${condicao.name})` : 'Vazio = hoje';
  });

  /** Tudo que impede o envio, em linguagem de usuário. Vazio = pode registrar. */
  protected readonly problemas = computed<string[]>(() => {
    const lista: string[] = [];
    const itens = this.itens();
    const cabecalho = this.cabecalho();
    const incluidas = this.linhas().filter((linha) => linha.incluir);

    if (incluidas.length === 0) lista.push('Marque ao menos um item que chegou nesta entrega.');

    for (const linha of incluidas) {
      const item = itens.get(linha.itemId);
      const analise = this.analises().get(linha.itemId);
      if (!item || !analise) continue;
      const n = item.sequence;
      if (!positivo(linha.receivedQuantity)) {
        lista.push(`A quantidade recebida do item ${n} deve ser maior que zero.`);
      }
      if (analise.acimaDoSaldo) {
        lista.push(
          `O item ${n} tem ${formatDecimal(analise.pendente, CASAS_UNITARIAS)} pendente(s): aceitar mais que isso é recusado (RF-039).`,
        );
      }
      if (linha.documentPrice !== null && !positivo(linha.documentPrice)) {
        lista.push(`O preço no documento do item ${n} deve ser maior que zero.`);
      }
      if (analise.exigeJustificativa && linha.note.trim() === '') {
        lista.push(`Justifique a divergência do item ${n} (RF-040).`);
      }
      const temLocal = linha.locationId || item.locationId || cabecalho.locationId;
      if (linha.accepted && item.product?.tracksStock && !temLocal) {
        lista.push(`Informe o local de estoque que recebeu o item ${n} (RF-031).`);
      }
    }

    if (cabecalho.generatePayable) {
      if (!incluidas.some((linha) => linha.accepted)) {
        lista.push('Nenhuma linha aceita: não há valor a pagar (RF-041).');
      }
      if (cabecalho.firstDueDate !== '' && !dataValida(cabecalho.firstDueDate)) {
        lista.push('1º vencimento inválido.');
      }
      const parcelas = cabecalho.installmentCount.trim();
      if (parcelas !== '' && !/^([1-9]\d?|1[01]\d|120)$/.test(parcelas)) {
        lista.push('As parcelas vão de 1 a 120.');
      }
    }
    return lista;
  });

  constructor() {
    this.carregar();
    this.carregarLocais();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected quantidade(valor: string): string {
    return formatDecimal(valor, CASAS_UNITARIAS);
  }

  protected unitario(valor: string): string {
    return `R$ ${formatDecimal(valor, CASAS_UNITARIAS)}`;
  }

  protected itemDe(linha: LinhaConferencia): PurchaseOrderItem | undefined {
    return this.itens().get(linha.itemId);
  }

  protected analise(linha: LinhaConferencia): Analise {
    return this.analises().get(linha.itemId)!;
  }

  protected mudar<K extends keyof Cabecalho>(campo: K, valor: Cabecalho[K]): void {
    this.cabecalho.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarLinha<K extends keyof LinhaConferencia>(
    indice: number,
    campo: K,
    valor: LinhaConferencia[K],
  ): void {
    this.linhas.update((atual) =>
      atual.map((linha, i) => (i === indice ? { ...linha, [campo]: valor } : linha)),
    );
  }

  protected registrar(): void {
    this.tentouEnviar.set(true);
    if (this.enviando() || this.bloqueado() || this.problemas().length > 0) return;
    this.enviando.set(true);
    this.erro.set(null);

    this.api
      .createReceipt(this.orderId, this.montar())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (recebimento) => {
          // Sem destravar o botão: a tela sai dela, e um segundo clique aqui
          // seria uma segunda entrega.
          const destino = this.permissoes.pode('goods-receipts:READ')
            ? ['/compras/recebimentos', recebimento.id]
            : ['/compras/pedidos', this.orderId];
          void this.router.navigate(destino);
        },
        error: (falha: unknown) => {
          this.enviando.set(false);
          this.erro.set(falha);
        },
      });
  }

  private montar(): GoodsReceiptInput {
    const cabecalho = this.cabecalho();
    const items: GoodsReceiptItemInput[] = this.linhas()
      .filter((linha) => linha.incluir)
      .map((linha) =>
        this.semIndefinidos<GoodsReceiptItemInput>({
          orderItemId: linha.itemId,
          receivedQuantity: linha.receivedQuantity ?? '0',
          documentPrice: linha.documentPrice ?? undefined,
          accepted: linha.accepted ? undefined : false,
          locationId: texto(linha.locationId),
          batch: texto(linha.batch),
          note: texto(linha.note),
        }),
      );

    let payable: GoodsReceiptPayableInput | undefined;
    if (cabecalho.generatePayable) {
      const parcelas = cabecalho.installmentCount.trim();
      payable = this.semIndefinidos<GoodsReceiptPayableInput>({
        firstDueDate: texto(cabecalho.firstDueDate),
        installmentCount: parcelas === '' ? undefined : Number.parseInt(parcelas, 10),
        documentReference: texto(cabecalho.documentReference),
      });
    }

    return this.semIndefinidos<GoodsReceiptInput>({
      // `datetime-local` é hora do navegador; a API recebe o instante.
      receivedAt: cabecalho.receivedAt ? new Date(cabecalho.receivedAt).toISOString() : undefined,
      locationId: texto(cabecalho.locationId),
      fiscalDocumentId: texto(cabecalho.fiscalDocumentId),
      note: texto(cabecalho.note),
      generatePayable: cabecalho.generatePayable || undefined,
      payable,
      items,
    });
  }

  private semIndefinidos<T extends object>(objeto: T): T {
    return Object.fromEntries(
      Object.entries(objeto).filter(([, valor]) => valor !== undefined),
    ) as T;
  }

  private carregar(): void {
    this.api
      .getOrder(this.orderId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pedido) => {
          this.pedido.set(pedido);
          // Só o que ainda falta chegar; a quantidade sugerida é o saldo inteiro.
          this.linhas.set(
            pedido.items
              .filter((item) => positivo(saldoPendente(item)))
              .map((item) => ({
                itemId: item.id,
                incluir: true,
                receivedQuantity: saldoPendente(item),
                documentPrice: null,
                accepted: true,
                locationId: item.locationId ?? '',
                batch: '',
                note: '',
              })),
          );
          this.carregarNotas(pedido);
        },
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  /** Notas processadas do fornecedor, livres ou já ligadas a este pedido (RF-047). */
  private carregarNotas(pedido: PurchaseOrder): void {
    if (!this.podeLerNotas()) return;
    this.fiscais
      .list({ issuerPartnerId: pedido.partnerId, status: 'PROCESSADO', pageSize: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) =>
          this.opcoesNota.set(
            r.data
              .filter((nota) => !nota.purchaseOrderId || nota.purchaseOrderId === pedido.id)
              .map((nota) => ({
                value: nota.id,
                label: `NF ${nota.number}${nota.series ? '/' + nota.series : ''} · ${formatCurrency(nota.totalAmount)}`,
              })),
          ),
        error: () => this.opcoesNota.set([]),
      });
  }

  private carregarLocais(): void {
    if (!this.permissoes.pode('stock-locations:READ')) return;
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
