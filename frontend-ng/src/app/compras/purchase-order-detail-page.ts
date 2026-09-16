import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import type { Observable } from 'rxjs';

import { ApprovalsApiService } from '../core/api/approvals-api.service';
import { FinanceApiService } from '../core/api/finance-api.service';
import { FiscalDocumentsApiService } from '../core/api/fiscal-documents-api.service';
import { PurchasingApiService } from '../core/api/purchasing-api.service';
import type {
  ApprovalEvaluation,
  FinancialEntry,
  FiscalDocumentSummary,
  GoodsReceipt,
  PurchaseOrder,
  PurchaseOrderItem,
} from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency, formatDecimal } from '../core/lib/decimal';
import { formatDate, formatDateTime } from '../core/lib/format';
import {
  ROTULO_APROVACAO,
  ROTULO_STATUS_TITULO,
  severidadeAprovacao,
  severidadeTitulo,
} from '../financeiro/rotulos';
import { Alert } from '../ui/alert';
import { PrintExport } from '../ui/print-export';
import { ErrorAlert } from '../ui/error-alert';
import { TextField } from '../ui/text-field';
import { CASAS_UNITARIAS, positivo, saldoPendente } from './calculo';
import {
  OPERACAO_PEDIDO,
  ROTULO_STATUS_PEDIDO,
  aceitaCancelamento,
  aceitaRecebimento,
  editavel,
  fornecedor,
  severidadePedido,
  solicitante,
} from './rotulos';

type Decisao = 'aprovar' | 'reprovar';

type EstadoEtapa = 'feita' | 'atual' | 'futura' | 'recusada';

interface Etapa {
  rotulo: string;
  detalhe: string;
  estado: EstadoEtapa;
}

/** Nota ligada ao pedido, venha ela do próprio documento ou da entrega que a trouxe. */
interface NotaVinculada {
  id: string;
  numero: string;
  emitente: string;
  valor: string | null;
  situacao: string | null;
}

/**
 * Detalhe do pedido de compra: acompanhamento, submissão à alçada, decisão e
 * vínculos (RF-036, RF-038, RF-041 — UI-031/UI-034).
 *
 * Os botões seguem o que o servidor aceitaria — situação do pedido, permissão
 * e RN-003 (quem pediu não aprova) —, mas a decisão é sempre dele: a tela só
 * evita prometer o que a API vai negar.
 *
 * Cada vínculo é consultado só com a permissão que a API exige para ele. O
 * título a pagar não tem filtro por pedido na API: a tela busca pelo número do
 * pedido (que o título gerado no recebimento traz na descrição) e confere o
 * `purchaseOrderId` de cada resultado.
 */
@Component({
  selector: 'sge-purchase-order-detail-page',
  imports: [
    PrintExport,
    FormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    TagModule,
    Alert,
    ErrorAlert,
    TextField,
  ],
  template: `
    <p class="crumb">Compras / Pedidos / {{ numero() }}</p>

    <div class="pagehead">
      <div>
        <h1>Pedido {{ numero() }}</h1>
        <p>{{ subtitulo() }}</p>
      </div>
      <div class="pagehead__actions">
        <sge-print-export />
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          routerLink="/compras/pedidos"
        />
        @if (pedido(); as registro) {
          @if (podeEditar()) {
            <p-button
              label="Editar"
              severity="secondary"
              [outlined]="true"
              [routerLink]="['/compras/pedidos', registro.id, 'editar']"
            />
            <p-button
              label="Enviar para aprovação"
              icon="pi pi-send"
              [loading]="agindo()"
              [disabled]="agindo()"
              (onClick)="abrirEnvio()"
            />
          }
          @if (podeDecidir()) {
            <p-button
              label="Aprovar"
              icon="pi pi-check"
              [disabled]="agindo() || proprioPedido()"
              [title]="proprioPedido() ? 'Quem solicitou a compra não pode aprová-la' : ''"
              (onClick)="abrirDecisao('aprovar')"
            />
            <p-button
              label="Reprovar"
              severity="danger"
              [outlined]="true"
              [disabled]="agindo() || proprioPedido()"
              (onClick)="abrirDecisao('reprovar')"
            />
          }
          @if (podeReceber()) {
            <p-button
              label="Receber mercadoria"
              icon="pi pi-inbox"
              [routerLink]="['/compras/pedidos', registro.id, 'receber']"
            />
          }
          @if (podeCancelar()) {
            <p-button
              label="Cancelar pedido"
              severity="danger"
              [text]="true"
              [disabled]="agindo()"
              (onClick)="abrirCancelamento()"
            />
          }
        }
      </div>
    </div>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }
    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    @if (pedido(); as registro) {
      @if (registro.approvalStatus === 'PENDENTE' && proprioPedido()) {
        <div class="espaco">
          <sge-alert
            tom="info"
            titulo="Aguardando aprovação de outra pessoa"
            mensagem="Quem solicitou a compra não decide sobre ela (RN-003)."
          />
        </div>
      }

      <section class="card secao espaco">
        <h2 class="secao__titulo">Acompanhamento</h2>
        <ol class="etapas">
          @for (etapa of etapas(); track etapa.rotulo) {
            <li class="etapa" [class]="'etapa etapa--' + etapa.estado">
              <span class="etapa__marca" aria-hidden="true"></span>
              <div>
                <strong>{{ etapa.rotulo }}</strong>
                <span class="etapa__detalhe">{{ etapa.detalhe }}</span>
              </div>
            </li>
          }
        </ol>
        <div class="tags">
          <p-tag [value]="rotuloStatus()" [severity]="severidadeStatus()" [rounded]="true" />
          <p-tag
            [value]="'Aprovação: ' + rotuloAprovacao()"
            [severity]="severidadeDaAprovacao()"
            [rounded]="true"
          />
        </div>
      </section>

      <div class="kpis espaco">
        <div class="kpi">
          <p class="kpi__label">Total do pedido</p>
          <p class="kpi__value">{{ moeda(registro.totalAmount) }}</p>
          <p class="kpi__detail">produtos {{ moeda(registro.productsAmount) }}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Itens entregues</p>
          <p class="kpi__value">{{ itensEntregues() }} de {{ registro.items.length }}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Entregas registradas</p>
          <p class="kpi__value">{{ registro.receipts.length }}</p>
          <p class="kpi__detail">{{ entregasDivergentes() }} com divergência</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Previsão de entrega</p>
          <p class="kpi__value">{{ registro.expectedDate ? data(registro.expectedDate) : '—' }}</p>
        </div>
      </div>

      <section class="card secao espaco">
        <h2 class="secao__titulo">Dados do pedido</h2>
        <dl class="dados">
          <div>
            <dt>Data</dt>
            <dd>{{ data(registro.orderDate) }}</dd>
          </div>
          <div>
            <dt>Solicitante</dt>
            <dd>{{ registro.requester?.name ?? '—' }}</dd>
          </div>
          <div>
            <dt>Comprador</dt>
            <dd>{{ registro.buyer?.name ?? '—' }}</dd>
          </div>
          <div>
            <dt>Condição de pagamento</dt>
            <dd>
              {{
                registro.paymentTerm
                  ? registro.paymentTerm.code + ' — ' + registro.paymentTerm.name
                  : '—'
              }}
            </dd>
          </div>
          <div>
            <dt>Forma de pagamento</dt>
            <dd>
              {{
                registro.paymentMethod
                  ? registro.paymentMethod.code + ' — ' + registro.paymentMethod.name
                  : '—'
              }}
            </dd>
          </div>
          <div>
            <dt>Categoria financeira</dt>
            <dd>
              {{
                registro.category ? registro.category.code + ' — ' + registro.category.name : '—'
              }}
            </dd>
          </div>
          <div>
            <dt>Centro de custo</dt>
            <dd>
              {{
                registro.costCenter
                  ? registro.costCenter.code + ' — ' + registro.costCenter.name
                  : '—'
              }}
            </dd>
          </div>
          @if (registro.approvedBy) {
            <div>
              <dt>
                {{ registro.approvalStatus === 'REPROVADO' ? 'Reprovado por' : 'Aprovado por' }}
              </dt>
              <dd>
                {{ registro.approvedBy.name }}
                @if (registro.approvedAt) {
                  em {{ dataHora(registro.approvedAt) }}
                }
              </dd>
            </div>
          }
          @if (registro.cancelReason) {
            <div class="dados__largo">
              <dt>Motivo do cancelamento</dt>
              <dd>{{ registro.cancelReason }}</dd>
            </div>
          }
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
              <th scope="col" class="numero">Pendente</th>
              <th scope="col" class="numero">Preço unit.</th>
              <th scope="col" class="numero">Desconto</th>
              <th scope="col" class="numero">Frete rateado</th>
              <th scope="col" class="numero">Valor</th>
            </tr>
          </thead>
          <tbody>
            @for (item of registro.items; track item.id) {
              <tr>
                <td>{{ item.sequence }}</td>
                <td>
                  {{ item.product ? item.product.code + ' — ' : '' }}{{ item.description }}
                  @if (item.location) {
                    <span class="secundario">Receber em {{ item.location.name }}</span>
                  }
                </td>
                <td class="numero">{{ quantidade(item.quantity) }}</td>
                <td class="numero">{{ quantidade(item.receivedQuantity) }}</td>
                <td class="numero" [class.pendente]="temPendencia(item)">
                  {{ quantidade(pendente(item)) }}
                </td>
                <td class="numero">{{ unitario(item.unitPrice) }}</td>
                <td class="numero">{{ moeda(item.discountAmount) }}</td>
                <td class="numero">{{ moeda(item.apportionedFreight) }}</td>
                <td class="numero">{{ moeda(item.lineAmount) }}</td>
              </tr>
            }
          </tbody>
        </table>
        <dl class="totais">
          <div>
            <dt>Produtos</dt>
            <dd>{{ moeda(registro.productsAmount) }}</dd>
          </div>
          <div>
            <dt>Desconto</dt>
            <dd>{{ moeda(registro.discountAmount) }}</dd>
          </div>
          <div>
            <dt>Frete</dt>
            <dd>{{ moeda(registro.freightAmount) }}</dd>
          </div>
          <div>
            <dt>Seguro</dt>
            <dd>{{ moeda(registro.insuranceAmount) }}</dd>
          </div>
          <div>
            <dt>Outras despesas</dt>
            <dd>{{ moeda(registro.otherExpenseAmount) }}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd class="totais__total">{{ moeda(registro.totalAmount) }}</dd>
          </div>
        </dl>
      </section>

      <section class="card secao espaco">
        <h2 class="secao__titulo">Vínculos (RF-041)</h2>
        <div class="vinculos">
          <div class="vinculo">
            <h3>Fornecedor</h3>
            @if (podeLerParceiros()) {
              <a [routerLink]="['/cadastros/parceiros', registro.partnerId]">{{
                nomeFornecedor()
              }}</a>
            } @else {
              <span>{{ nomeFornecedor() }}</span>
            }
          </div>

          <div class="vinculo">
            <h3>Notas fiscais</h3>
            @if (notasVinculadas().length === 0) {
              <span class="nota">{{ semNotas() }}</span>
            } @else {
              <ul>
                @for (nota of notasVinculadas(); track nota.id) {
                  <li>
                    NF {{ nota.numero }} · {{ nota.emitente }}
                    @if (nota.valor) {
                      · {{ moeda(nota.valor) }}
                    }
                    @if (nota.situacao) {
                      <span class="secundario">{{ nota.situacao }}</span>
                    }
                  </li>
                }
              </ul>
            }
          </div>

          <div class="vinculo">
            <h3>Recebimentos e estoque</h3>
            @if (registro.receipts.length === 0) {
              <span class="nota">Nenhuma entrega registrada.</span>
            } @else {
              <ul>
                @for (entrega of registro.receipts; track entrega.id) {
                  <li>
                    @if (podeLerRecebimentos()) {
                      <a [routerLink]="['/compras/recebimentos', entrega.id]">{{
                        entrega.number
                      }}</a>
                    } @else {
                      {{ entrega.number }}
                    }
                    · {{ dataHora(entrega.receivedAt) }}
                    <span class="marcas">
                      <p-tag
                        [value]="entrega.hasDivergence ? 'Com divergência' : 'Conferida'"
                        [severity]="entrega.hasDivergence ? 'warn' : 'success'"
                      />
                      <p-tag
                        [value]="
                          entrega.generatedStock ? 'Entrou no estoque' : 'Sem entrada de estoque'
                        "
                        [severity]="entrega.generatedStock ? 'info' : 'secondary'"
                      />
                      <p-tag
                        [value]="entrega.generatedPayable ? 'Gerou título' : 'Sem título'"
                        [severity]="entrega.generatedPayable ? 'info' : 'secondary'"
                      />
                    </span>
                  </li>
                }
              </ul>
              @if (podeLerMovimentos() && algumaEntradaDeEstoque()) {
                <a routerLink="/estoque/movimentacoes" class="secundario">
                  Ver as entradas no razão de estoque
                </a>
              }
            }
          </div>

          <div class="vinculo">
            <h3>Financeiro</h3>
            @if (!podeLerTitulos()) {
              <span class="nota">Sem permissão para consultar títulos.</span>
            } @else if (titulosVinculados().length === 0) {
              <span class="nota">Nenhum título a pagar gerado por este pedido.</span>
            } @else {
              <ul>
                @for (titulo of titulosVinculados(); track titulo.id) {
                  <li>
                    <a [routerLink]="['/financeiro/titulos', titulo.id]">{{ titulo.number }}</a>
                    · {{ moeda(titulo.netAmount) }} · saldo {{ moeda(titulo.balance) }}
                    <p-tag [value]="rotuloTitulo(titulo)" [severity]="severidadeDoTitulo(titulo)" />
                  </li>
                }
              </ul>
            }
          </div>
        </div>
      </section>
    }

    <p-dialog
      [visible]="envioAberto()"
      (visibleChange)="envioAberto.set($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      header="Enviar para aprovação"
    >
      @if (avaliacao(); as resultado) {
        @if (resultado.requiresApproval) {
          <sge-alert
            tom="aviso"
            titulo="O pedido vai para a alçada"
            [mensagem]="mensagemAlcada(resultado)"
          />
        } @else {
          <sge-alert
            tom="info"
            titulo="Abaixo da alçada"
            mensagem="O pedido será aprovado na hora e fica liberado para receber mercadoria."
          />
        }
      } @else {
        <sge-alert
          tom="info"
          titulo="O servidor decide o caminho"
          mensagem="Abaixo da alçada configurada o pedido é aprovado na hora; acima dela, aguarda a decisão de quem tem alçada (RF-038)."
        />
      }
      <p class="nota">Depois de enviado, o pedido não é mais editável.</p>
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          (onClick)="envioAberto.set(false)"
        />
        <p-button
          label="Enviar"
          icon="pi pi-send"
          [loading]="agindo()"
          [disabled]="agindo()"
          (onClick)="enviar()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="decisao() !== null"
      (visibleChange)="$event || decisao.set(null)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      [header]="decisao() === 'aprovar' ? 'Aprovar pedido' : 'Reprovar pedido'"
    >
      <form class="grade-campos formulario" (ngSubmit)="decidir()">
        <sge-text-field
          [rotulo]="decisao() === 'aprovar' ? 'Observação' : 'Motivo'"
          name="motivo"
          [obrigatorio]="decisao() === 'reprovar'"
          [dica]="decisao() === 'reprovar' ? 'Obrigatório — fica na trilha de auditoria' : ''"
          [ngModel]="motivo()"
          (ngModelChange)="motivo.set($event)"
        />
      </form>
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          (onClick)="decisao.set(null)"
        />
        <p-button
          [label]="decisao() === 'aprovar' ? 'Aprovar' : 'Reprovar'"
          [severity]="decisao() === 'aprovar' ? 'primary' : 'danger'"
          [loading]="agindo()"
          [disabled]="!decisaoValida()"
          (onClick)="decidir()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="cancelamentoAberto()"
      (visibleChange)="cancelamentoAberto.set($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      header="Cancelar pedido"
    >
      <form class="grade-campos formulario" (ngSubmit)="cancelar()">
        <sge-text-field
          rotulo="Motivo"
          name="motivoCancelamento"
          [obrigatorio]="true"
          dica="O pedido é preservado; o motivo fica registrado (RN-009)"
          [ngModel]="motivo()"
          (ngModelChange)="motivo.set($event)"
        />
      </form>
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          (onClick)="cancelamentoAberto.set(false)"
        />
        <p-button
          label="Cancelar pedido"
          severity="danger"
          [loading]="agindo()"
          [disabled]="agindo() || motivo().trim().length < 3"
          (onClick)="cancelar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.75rem;
    }
    .etapas {
      display: flex;
      flex-wrap: wrap;
      gap: 1.25rem;
      margin: 0 0 0.75rem;
      padding: 0;
      list-style: none;
    }
    .etapa {
      display: flex;
      gap: 0.5rem;
      align-items: flex-start;
      min-width: 11rem;
      font-size: 0.8rem;
    }
    .etapa__marca {
      width: 0.75rem;
      height: 0.75rem;
      margin-top: 0.2rem;
      border-radius: 50%;
      border: 2px solid var(--p-content-border-color);
      flex-shrink: 0;
    }
    .etapa--feita .etapa__marca {
      background: var(--p-green-500, #16a34a);
      border-color: var(--p-green-500, #16a34a);
    }
    .etapa--atual .etapa__marca {
      border-color: var(--p-primary-color);
      background: var(--p-primary-color);
    }
    .etapa--recusada .etapa__marca {
      background: var(--p-red-500, #dc2626);
      border-color: var(--p-red-500, #dc2626);
    }
    .etapa--futura {
      color: var(--p-text-muted-color);
    }
    .etapa__detalhe,
    .secundario {
      display: block;
      font-size: 0.75rem;
      color: var(--p-text-muted-color);
    }
    .tags,
    .marcas {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }
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
    .pendente {
      font-weight: 600;
    }
    .totais {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 1.5rem;
      margin: 0.75rem 0.6rem 0;
      font-size: 0.8rem;
    }
    .totais dt {
      color: var(--p-text-muted-color);
    }
    .totais dd {
      margin: 0.2rem 0 0;
      font-variant-numeric: tabular-nums;
    }
    .totais__total {
      font-weight: 600;
    }
    .vinculos {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
      gap: 1rem 1.5rem;
      font-size: 0.85rem;
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
    }
  `,
})
export class PurchaseOrderDetailPage {
  private readonly api = inject(PurchasingApiService);
  private readonly alcadas = inject(ApprovalsApiService);
  private readonly financeiro = inject(FinanceApiService);
  private readonly fiscais = inject(FiscalDocumentsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly auth = inject(AuthService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly orderId = this.rota.snapshot.paramMap.get('id') ?? '';

  protected readonly pedido = signal<PurchaseOrder | null>(null);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly agindo = signal(false);

  /** `null` = não consultado (sem permissão ou ainda carregando). */
  protected readonly recebimentos = signal<GoodsReceipt[] | null>(null);
  protected readonly notas = signal<FiscalDocumentSummary[] | null>(null);
  protected readonly titulos = signal<FinancialEntry[] | null>(null);

  protected readonly envioAberto = signal(false);
  protected readonly avaliacao = signal<ApprovalEvaluation | null>(null);
  protected readonly decisao = signal<Decisao | null>(null);
  protected readonly cancelamentoAberto = signal(false);
  protected readonly motivo = signal('');

  protected readonly podeLerParceiros = () => this.permissoes.pode('partners:READ');
  protected readonly podeLerRecebimentos = () => this.permissoes.pode('goods-receipts:READ');
  protected readonly podeLerMovimentos = () => this.permissoes.pode('stock-movements:READ');
  protected readonly podeLerTitulos = () => this.permissoes.pode('financial-entries:READ');
  private readonly podeLerNotas = () => this.permissoes.pode('fiscal-documents:READ');

  protected readonly numero = computed(() => this.pedido()?.number ?? '—');

  protected readonly subtitulo = computed(() => {
    const registro = this.pedido();
    if (!registro) return 'Acompanhamento, aprovação por alçada e vínculos do pedido.';
    return `${fornecedor(registro)} · ${ROTULO_STATUS_PEDIDO[registro.status]} · ${formatDate(registro.orderDate)}.`;
  });

  protected readonly nomeFornecedor = computed(() => {
    const registro = this.pedido();
    return registro ? fornecedor(registro) : '—';
  });

  protected readonly proprioPedido = computed(() => {
    const registro = this.pedido();
    const usuario = this.auth.usuario();
    return !!registro && !!usuario && solicitante(registro) === usuario.id;
  });

  protected readonly podeEditar = computed(() => {
    const registro = this.pedido();
    return !!registro && editavel(registro) && this.permissoes.pode('purchase-orders:UPDATE');
  });

  protected readonly podeDecidir = computed(
    () =>
      this.pedido()?.approvalStatus === 'PENDENTE' &&
      this.permissoes.pode('purchase-orders:APPROVE'),
  );

  protected readonly podeReceber = computed(() => {
    const registro = this.pedido();
    return (
      !!registro && aceitaRecebimento(registro) && this.permissoes.pode('goods-receipts:CREATE')
    );
  });

  protected readonly podeCancelar = computed(() => {
    const registro = this.pedido();
    return (
      !!registro && aceitaCancelamento(registro) && this.permissoes.pode('purchase-orders:DELETE')
    );
  });

  protected readonly decisaoValida = computed(
    () => !this.agindo() && (this.decisao() === 'aprovar' || this.motivo().trim().length >= 3),
  );

  protected readonly itensEntregues = computed(
    () => this.pedido()?.items.filter((item) => !this.temPendencia(item)).length ?? 0,
  );

  protected readonly entregasDivergentes = computed(
    () => this.pedido()?.receipts.filter((r) => r.hasDivergence).length ?? 0,
  );

  protected readonly algumaEntradaDeEstoque = computed(
    () => this.pedido()?.receipts.some((r) => r.generatedStock) ?? false,
  );

  /** A linha do tempo do pedido: criação → alçada → entrega → conclusão (RF-038). */
  protected readonly etapas = computed<Etapa[]>(() => {
    const registro = this.pedido();
    if (!registro) return [];
    const status = registro.status;

    const criacao: Etapa = {
      rotulo: 'Pedido criado',
      detalhe: `${formatDate(registro.orderDate)}${registro.requester ? ' · ' + registro.requester.name : ''}`,
      estado: status === 'RASCUNHO' ? 'atual' : 'feita',
    };

    const aprovacao: Etapa = { rotulo: 'Aprovação', detalhe: '', estado: 'futura' };
    if (status === 'AGUARDANDO_APROVACAO') {
      aprovacao.estado = 'atual';
      aprovacao.detalhe = 'Aguardando decisão da alçada';
    } else if (status === 'REPROVADO') {
      aprovacao.estado = 'recusada';
      aprovacao.detalhe = `Reprovado${registro.approvedBy ? ' por ' + registro.approvedBy.name : ''}`;
    } else if (registro.approvalStatus === 'APROVADO') {
      aprovacao.estado = 'feita';
      aprovacao.detalhe = `Aprovado${registro.approvedBy ? ' por ' + registro.approvedBy.name : ''}`;
    } else if (registro.approvalStatus === 'NAO_REQUERIDA' && status !== 'RASCUNHO') {
      aprovacao.estado = status === 'CANCELADO' ? 'futura' : 'feita';
      aprovacao.detalhe = 'Dispensada — abaixo da alçada';
    } else {
      aprovacao.detalhe = 'Ainda não enviado';
    }

    const entregas = registro.receipts.length;
    const recebimento: Etapa = {
      rotulo: 'Recebimento',
      detalhe: entregas === 0 ? 'Nenhuma entrega' : `${entregas} entrega(s) registrada(s)`,
      estado:
        status === 'RECEBIDO'
          ? 'feita'
          : status === 'APROVADO' || status === 'PARCIALMENTE_RECEBIDO'
            ? 'atual'
            : 'futura',
    };

    const fim: Etapa =
      status === 'CANCELADO'
        ? {
            rotulo: 'Cancelado',
            detalhe: registro.canceledAt ? formatDateTime(registro.canceledAt) : '',
            estado: 'recusada',
          }
        : {
            rotulo: 'Concluído',
            detalhe: status === 'RECEBIDO' ? 'Tudo entregue' : '',
            estado: status === 'RECEBIDO' ? 'feita' : 'futura',
          };

    return [criacao, aprovacao, recebimento, fim];
  });

  /** Notas do pedido e as trazidas pelas entregas, sem repetir a mesma nota. */
  protected readonly notasVinculadas = computed<NotaVinculada[]>(() => {
    const porId = new Map<string, NotaVinculada>();
    for (const nota of this.notas() ?? []) {
      porId.set(nota.id, {
        id: nota.id,
        numero: nota.series ? `${nota.number}/${nota.series}` : nota.number,
        emitente:
          nota.issuerPartner?.tradeName ?? nota.issuerPartner?.legalName ?? nota.issuerName ?? '—',
        valor: nota.totalAmount,
        situacao: nota.status,
      });
    }
    for (const entrega of this.recebimentos() ?? []) {
      const nota = entrega.fiscalDocument;
      if (!nota || porId.has(nota.id)) continue;
      porId.set(nota.id, {
        id: nota.id,
        numero: nota.series ? `${nota.number}/${nota.series}` : nota.number,
        emitente: `entrega ${entrega.number}`,
        valor: null,
        situacao: null,
      });
    }
    return [...porId.values()];
  });

  protected readonly titulosVinculados = computed(() =>
    (this.titulos() ?? []).filter((titulo) => titulo.purchaseOrderId === this.orderId),
  );

  constructor() {
    this.carregar();
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

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }

  protected pendente(item: PurchaseOrderItem): string {
    return saldoPendente(item);
  }

  protected temPendencia(item: PurchaseOrderItem): boolean {
    return positivo(saldoPendente(item));
  }

  protected rotuloStatus(): string {
    const registro = this.pedido();
    return registro ? ROTULO_STATUS_PEDIDO[registro.status] : '';
  }

  protected severidadeStatus() {
    const registro = this.pedido();
    return registro ? severidadePedido(registro.status) : 'secondary';
  }

  protected rotuloAprovacao(): string {
    const registro = this.pedido();
    return registro ? ROTULO_APROVACAO[registro.approvalStatus] : '';
  }

  protected severidadeDaAprovacao() {
    const registro = this.pedido();
    return registro ? severidadeAprovacao(registro.approvalStatus) : 'secondary';
  }

  protected rotuloTitulo(titulo: FinancialEntry): string {
    return ROTULO_STATUS_TITULO[titulo.status] ?? titulo.status;
  }

  protected severidadeDoTitulo(titulo: FinancialEntry) {
    return severidadeTitulo(titulo.status);
  }

  protected semNotas(): string {
    if (!this.podeLerNotas() && !this.podeLerRecebimentos()) {
      return 'Sem permissão para consultar documentos fiscais.';
    }
    return 'Nenhuma nota fiscal vinculada.';
  }

  protected mensagemAlcada(resultado: ApprovalEvaluation): string {
    const perfis = resultado.authorizedRoles.map((perfil) => perfil.name).join(', ');
    return perfis
      ? `Aguardará a decisão de um destes perfis: ${perfis}. Até lá, não aceita recebimento.`
      : 'Aguardará a decisão de quem tem alçada. Até lá, não aceita recebimento.';
  }

  /** A prévia da alçada só é pedida a quem pode consultá-la; o servidor decide igual. */
  protected abrirEnvio(): void {
    const registro = this.pedido();
    if (!registro) return;
    this.avaliacao.set(null);
    this.envioAberto.set(true);
    if (!this.permissoes.pode('approval-thresholds:READ')) return;
    this.alcadas
      .evaluate(OPERACAO_PEDIDO, registro.totalAmount)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => this.avaliacao.set(resultado),
        error: () => this.avaliacao.set(null),
      });
  }

  protected enviar(): void {
    this.envioAberto.set(false);
    this.executar(
      () => this.api.submitOrder(this.orderId),
      (pedido) =>
        pedido.status === 'APROVADO'
          ? 'Pedido aprovado na hora: está abaixo da alçada.'
          : 'Pedido enviado para aprovação.',
    );
  }

  protected abrirDecisao(tipo: Decisao): void {
    this.motivo.set('');
    this.decisao.set(tipo);
  }

  protected decidir(): void {
    const tipo = this.decisao();
    if (!tipo || !this.decisaoValida()) return;
    const texto = this.motivo().trim();
    this.decisao.set(null);
    if (tipo === 'aprovar') {
      this.executar(
        () => this.api.approveOrder(this.orderId, texto || undefined),
        () => 'Pedido aprovado.',
      );
    } else {
      this.executar(
        () => this.api.rejectOrder(this.orderId, texto),
        () => 'Pedido reprovado.',
      );
    }
  }

  protected abrirCancelamento(): void {
    this.motivo.set('');
    this.cancelamentoAberto.set(true);
  }

  protected cancelar(): void {
    const motivo = this.motivo().trim();
    if (motivo.length < 3) return;
    this.cancelamentoAberto.set(false);
    this.executar(
      () => this.api.cancelOrder(this.orderId, motivo),
      () => 'Pedido cancelado; o registro foi preservado.',
    );
  }

  private executar(
    acao: () => Observable<PurchaseOrder>,
    mensagem: (pedido: PurchaseOrder) => string,
  ): void {
    if (this.agindo()) return;
    this.agindo.set(true);
    this.erro.set(null);
    this.aviso.set(null);
    acao()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pedido) => {
          this.agindo.set(false);
          this.pedido.set(pedido);
          this.aviso.set(mensagem(pedido));
        },
        error: (falha: unknown) => {
          this.agindo.set(false);
          this.erro.set(falha);
        },
      });
  }

  private carregar(): void {
    this.api
      .getOrder(this.orderId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pedido) => {
          this.pedido.set(pedido);
          this.carregarVinculos(pedido);
        },
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  /** Cada vínculo, só com a permissão que a API exige para ele (UI-034). */
  private carregarVinculos(pedido: PurchaseOrder): void {
    if (this.podeLerRecebimentos() && pedido.receipts.length > 0) {
      this.api
        .listOrderReceipts(pedido.id, { pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) => this.recebimentos.set(r.data),
          error: () => this.recebimentos.set(null),
        });
    }
    if (this.podeLerNotas()) {
      this.fiscais
        .list({ purchaseOrderId: pedido.id, pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (r) => this.notas.set(r.data), error: () => this.notas.set(null) });
    }
    if (this.podeLerTitulos() && pedido.status !== 'RASCUNHO') {
      this.financeiro
        .listEntries({ q: pedido.number, type: 'PAGAR', pageSize: 100 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (r) => this.titulos.set(r.data), error: () => this.titulos.set(null) });
    }
  }
}
