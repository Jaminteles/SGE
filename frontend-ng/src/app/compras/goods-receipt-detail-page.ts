import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { PurchasingApiService } from '../core/api/purchasing-api.service';
import type { GoodsReceipt, GoodsReceiptItem } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatDecimal } from '../core/lib/decimal';
import { formatDateTime } from '../core/lib/format';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { CASAS_UNITARIAS, compararUnitario, variacaoPercentual } from './calculo';
import { ROTULO_DIVERGENCIA, aceitaRecebimento, severidadeDivergencia } from './rotulos';

/**
 * Conferência de uma entrega e suas divergências (RF-040 — UI-033).
 *
 * O recebimento é imutável (bd/11): divergência não se "corrige" aqui. O que a
 * tela oferece é o tratamento possível — ver a justificativa de cada linha e,
 * se o pedido ainda aceita entrega, registrar a próxima conferência do saldo.
 */
@Component({
  selector: 'sge-goods-receipt-detail-page',
  imports: [RouterLink, ButtonModule, TagModule, Alert, ErrorAlert],
  template: `
    <p class="crumb">Compras / Recebimentos / {{ numero() }}</p>

    <div class="pagehead">
      <div>
        <h1>Recebimento {{ numero() }}</h1>
        <p>{{ subtitulo() }}</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          routerLink="/compras/recebimentos"
        />
        @if (recebimento()?.order; as pedido) {
          @if (podeLerPedidos()) {
            <p-button
              label="Abrir pedido"
              severity="secondary"
              [outlined]="true"
              [routerLink]="['/compras/pedidos', pedido.id]"
            />
          }
          @if (podeReceberSaldo()) {
            <p-button
              label="Receber saldo pendente"
              icon="pi pi-inbox"
              [routerLink]="['/compras/pedidos', pedido.id, 'receber']"
            />
          }
        }
      </div>
    </div>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (recebimento(); as registro) {
      @if (registro.hasDivergence) {
        <div class="espaco">
          <sge-alert
            tom="aviso"
            titulo="Entrega com divergência"
            mensagem="A conferência não é editável: o que faltou continua pendente no pedido, e a mercadoria recusada não entrou no estoque. Trate o saldo registrando uma nova entrega ou cancele o restante com o fornecedor."
          />
        </div>
      }

      <div class="kpis">
        <div class="kpi">
          <p class="kpi__label">Linhas conferidas</p>
          <p class="kpi__value">{{ registro.items.length }}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Com divergência</p>
          <p class="kpi__value">{{ divergentes() }}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Recusadas</p>
          <p class="kpi__value">{{ recusadas() }}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Efeitos</p>
          <p class="kpi__value kpi__value--texto">
            {{ registro.generatedStock ? 'Estoque' : 'Sem estoque' }} ·
            {{ registro.generatedPayable ? 'Título a pagar' : 'Sem título' }}
          </p>
        </div>
      </div>

      <section class="card secao espaco">
        <h2 class="secao__titulo">Entrega</h2>
        <dl class="dados">
          <div>
            <dt>Recebido em</dt>
            <dd>{{ dataHora(registro.receivedAt) }}</dd>
          </div>
          <div>
            <dt>Pedido</dt>
            <dd>{{ registro.order?.number ?? '—' }}</dd>
          </div>
          <div>
            <dt>Conferente</dt>
            <dd>{{ registro.inspector?.name ?? '—' }}</dd>
          </div>
          <div>
            <dt>Local padrão</dt>
            <dd>{{ registro.location?.name ?? '—' }}</dd>
          </div>
          <div>
            <dt>Nota fiscal</dt>
            <dd>{{ notaFiscal() }}</dd>
          </div>
          @if (registro.note) {
            <div class="dados__largo">
              <dt>Observação</dt>
              <dd>{{ registro.note }}</dd>
            </div>
          }
        </dl>
      </section>

      <section class="card table-card espaco">
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Item</th>
              <th scope="col" class="numero">Pedida</th>
              <th scope="col" class="numero">Recebida</th>
              <th scope="col" class="numero">Diferença</th>
              <th scope="col" class="numero">Preço pedido</th>
              <th scope="col" class="numero">Preço documento</th>
              <th scope="col">Conferência</th>
              <th scope="col">Justificativa</th>
            </tr>
          </thead>
          <tbody>
            @for (linha of registro.items; track linha.id) {
              <tr [class.recusada]="!linha.accepted">
                <td>{{ linha.orderItem?.sequence ?? '—' }}</td>
                <td>{{ linha.product ? linha.product.code + ' — ' : '' }}{{ descricao(linha) }}</td>
                <td class="numero">{{ quantidade(linha.orderedQuantity) }}</td>
                <td class="numero">{{ quantidade(linha.receivedQuantity) }}</td>
                <td class="numero">{{ quantidade(linha.quantityDivergence) }}</td>
                <td class="numero">{{ unitario(linha.orderedPrice) }}</td>
                <td class="numero">
                  {{ unitario(linha.documentPrice ?? linha.orderedPrice) }}
                  @if (variacaoPreco(linha); as variacao) {
                    <span class="secundario">{{ variacao }}</span>
                  }
                </td>
                <td>
                  <span class="marcas">
                    <p-tag
                      [value]="rotuloDivergencia(linha)"
                      [severity]="severidadeLinha(linha)"
                      [rounded]="true"
                    />
                    @if (!linha.accepted) {
                      <p-tag value="Recusada" severity="danger" [rounded]="true" />
                    }
                  </span>
                </td>
                <td>{{ linha.note ?? '—' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    }
  `,
  styles: `
    .dados {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
      gap: 0.75rem 1.5rem;
      margin: 0;
      font-size: 0.85rem;
    }
    .dados dt {
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
    }
    .dados dd {
      margin: 0.2rem 0 0;
    }
    .dados__largo {
      grid-column: 1 / -1;
    }
    .kpi__value--texto {
      font-size: 0.95rem;
    }
    .tabela {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .tabela th,
    .tabela td {
      padding: 0.5rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .tabela th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .tabela .numero {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .recusada {
      color: var(--p-text-muted-color);
    }
    .secundario {
      display: block;
      font-size: 0.7rem;
      color: var(--p-text-muted-color);
    }
    .marcas {
      display: inline-flex;
      gap: 0.3rem;
    }
  `,
})
export class GoodsReceiptDetailPage {
  private readonly api = inject(PurchasingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly receiptId = this.rota.snapshot.paramMap.get('id') ?? '';

  protected readonly recebimento = signal<GoodsReceipt | null>(null);
  protected readonly erro = signal<unknown>(null);

  protected readonly podeLerPedidos = () => this.permissoes.pode('purchase-orders:READ');

  protected readonly numero = computed(() => this.recebimento()?.number ?? '—');

  protected readonly subtitulo = computed(() => {
    const registro = this.recebimento();
    if (!registro) return 'Conferência de quantidade e preço de uma entrega (RF-040).';
    return `Pedido ${registro.order?.number ?? '—'} · ${formatDateTime(registro.receivedAt)}.`;
  });

  /** Saldo só se recebe com o pedido ainda aberto para entrega (RF-039). */
  protected readonly podeReceberSaldo = computed(() => {
    const pedido = this.recebimento()?.order;
    return (
      !!pedido &&
      aceitaRecebimento(pedido) &&
      this.permissoes.pode('purchase-orders:READ') &&
      this.permissoes.pode('goods-receipts:CREATE')
    );
  });

  protected readonly divergentes = computed(
    () =>
      this.recebimento()?.items.filter(
        (linha) => (linha.divergenceType && linha.divergenceType !== 'NENHUMA') || !linha.accepted,
      ).length ?? 0,
  );

  protected readonly recusadas = computed(
    () => this.recebimento()?.items.filter((linha) => !linha.accepted).length ?? 0,
  );

  protected readonly notaFiscal = computed(() => {
    const nota = this.recebimento()?.fiscalDocument;
    if (!nota) return 'Sem nota vinculada';
    return nota.series ? `NF ${nota.number}/${nota.series}` : `NF ${nota.number}`;
  });

  constructor() {
    this.api
      .getReceipt(this.receiptId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registro) => this.recebimento.set(registro),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }

  protected quantidade(valor: string | null): string {
    return valor === null ? '—' : formatDecimal(valor, CASAS_UNITARIAS);
  }

  protected unitario(valor: string | null): string {
    return valor === null ? '—' : `R$ ${formatDecimal(valor, CASAS_UNITARIAS)}`;
  }

  protected descricao(linha: GoodsReceiptItem): string {
    return linha.orderItem?.description ?? linha.product?.description ?? '—';
  }

  protected rotuloDivergencia(linha: GoodsReceiptItem): string {
    return linha.divergenceType ? ROTULO_DIVERGENCIA[linha.divergenceType] : 'Conferido';
  }

  protected severidadeLinha(linha: GoodsReceiptItem) {
    return severidadeDivergencia(linha.divergenceType ?? 'NENHUMA');
  }

  /** "+5,00% sobre o pedido" quando o documento cobrou outro preço. */
  protected variacaoPreco(linha: GoodsReceiptItem): string | null {
    if (linha.documentPrice === null || linha.orderedPrice === null) return null;
    if (compararUnitario(linha.documentPrice, linha.orderedPrice) === 0) return null;
    const variacao = variacaoPercentual(linha.documentPrice, linha.orderedPrice);
    if (variacao === null) return null;
    const texto = formatDecimal(variacao);
    return `${variacao.startsWith('-') ? texto : '+' + texto}% sobre o pedido`;
  }
}
