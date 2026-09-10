import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { map } from 'rxjs/operators';

import { CatalogApiService } from '../core/api/catalog-api.service';
import { StockApiService } from '../core/api/stock-api.service';
import type {
  StockEntryType,
  StockMovement,
  StockMovementInput,
  StockMovementType,
  StockTransferInput,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency, formatDecimal } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type OpcaoFiltro } from '../ui/filter-bar';
import { LIMITE_BUSCA, SearchSelect } from '../ui/search-select';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  FILTRO_TIPO_MOVIMENTO,
  OPCOES_LANCAMENTO,
  ROTULO_MOVIMENTO,
  consultaMovimento,
  exigeJustificativa,
  reduzSaldo,
  severidadeMovimento,
} from './rotulos';

interface FormularioMovimento {
  type: string;
  productId: string;
  locationId: string;
  quantity: string;
  unitCost: string;
  movementDate: string;
  note: string;
}

const MOVIMENTO_VAZIO: FormularioMovimento = {
  type: '',
  productId: '',
  locationId: '',
  quantity: '',
  unitCost: '',
  movementDate: '',
  note: '',
};

interface FormularioTransferencia {
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: string;
  movementDate: string;
  note: string;
}

const TRANSFERENCIA_VAZIA: FormularioTransferencia = {
  productId: '',
  fromLocationId: '',
  toLocationId: '',
  quantity: '',
  movementDate: '',
  note: '',
};

/**
 * Movimentações, transferências e ajustes (RF-032 — UI-022).
 *
 * O razão é **append-only**: não há editar nem apagar movimento. Um erro é
 * corrigido por um ajuste — que também fica registrado, com justificativa
 * obrigatória, porque um saldo que muda sem explicação é um saldo que ninguém
 * consegue auditar.
 *
 * A transferência tem rota própria (`POST /stock/transfers`): é uma operação
 * com duas pernas, que precisam nascer juntas. Lançar saída e entrada
 * separadamente deixaria o estoque inconsistente entre as duas chamadas.
 */
@Component({
  selector: 'sge-stock-movements-page',
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
    SearchSelect,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Estoque / Movimentações</p>

    <div class="pagehead">
      <div>
        <h1>Movimentações</h1>
        <p>Entradas, saídas, transferências e ajustes num razão append-only (RF-032).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeLancar()) {
          <p-button
            label="Transferência"
            severity="secondary"
            [outlined]="true"
            (onClick)="abrirTransferencia()"
          />
          <p-button label="Nova movimentação" icon="pi pi-plus" (onClick)="abrirMovimento()" />
        }
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar item ou documento"
      [valores]="lista.filtros()"
      [filtros]="[FILTRO_TIPO_MOVIMENTO, filtroLocal()]"
      [periodo]="true"
      (mudou)="lista.aplicarFiltros($event)"
    />

    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    <section class="card table-card espaco">
      <sge-data-table
        [colunas]="colunas"
        [linhas]="lista.linhas()"
        [total]="lista.total()"
        [pagina]="lista.pagina()"
        [tamanhoPagina]="lista.tamanhoPagina()"
        [carregando]="lista.carregando()"
        mensagemVazia="Nenhum movimento nesses filtros."
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-movimento>
          <tr>
            <td>{{ data(movimento.movementDate) }}</td>
            <td>
              <p-tag
                [value]="rotulo(movimento.type)"
                [severity]="severidade(movimento.type)"
                [rounded]="true"
              />
            </td>
            <td>{{ movimento.product?.description ?? '—' }}</td>
            <td>{{ local(movimento) }}</td>
            <td class="coluna--numerica">{{ quantidadeComSinal(movimento) }}</td>
            <td class="coluna--numerica">{{ moeda(movimento.unitCost) }}</td>
            <td>{{ origem(movimento) }}</td>
          </tr>
        </ng-template>
      </sge-data-table>
      <p class="nota">
        Razão append-only: movimento não é editado nem apagado — corrija com um ajuste (RF-032).
      </p>
    </section>

    <p-dialog
      [visible]="movimentoAberto()"
      (visibleChange)="movimentoAberto.set($event)"
      [modal]="true"
      [style]="{ width: '42rem' }"
      header="Nova movimentação"
    >
      @if (erroMovimento(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvarMovimento()">
        <sge-select-field
          rotulo="Tipo"
          name="type"
          [opcoes]="OPCOES_LANCAMENTO"
          [obrigatorio]="true"
          [ngModel]="formMovimento().type"
          (ngModelChange)="mudarMovimento('type', $event ?? '')"
        />
        <sge-search-select
          rotulo="Item"
          name="productId"
          [buscar]="buscarProduto"
          [obrigatorio]="true"
          [ngModel]="formMovimento().productId"
          (ngModelChange)="mudarMovimento('productId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Local"
          name="locationId"
          [opcoes]="opcoesLocal()"
          [obrigatorio]="true"
          [ngModel]="formMovimento().locationId"
          (ngModelChange)="mudarMovimento('locationId', $event ?? '')"
        />
        <sge-decimal-field
          rotulo="Quantidade"
          name="quantity"
          [casas]="6"
          [obrigatorio]="true"
          dica="Sempre positiva — o tipo define o sinal"
          [ngModel]="formMovimento().quantity"
          (ngModelChange)="mudarMovimento('quantity', $event ?? '')"
        />
        <sge-decimal-field
          rotulo="Custo unitário"
          name="unitCost"
          [casas]="6"
          dica="Só na entrada; a saída usa o custo médio"
          [ngModel]="formMovimento().unitCost"
          (ngModelChange)="mudarMovimento('unitCost', $event ?? '')"
        />
        <sge-text-field
          rotulo="Data do movimento"
          name="movementDate"
          tipo="date"
          [ngModel]="formMovimento().movementDate"
          (ngModelChange)="mudarMovimento('movementDate', $event)"
        />
        <sge-text-field
          rotulo="Justificativa"
          name="note"
          [obrigatorio]="justificativaObrigatoria()"
          [dica]="
            justificativaObrigatoria() ? 'Obrigatória no ajuste — vai para a auditoria' : 'Opcional'
          "
          [ngModel]="formMovimento().note"
          (ngModelChange)="mudarMovimento('note', $event)"
        />
      </form>

      @if (justificativaObrigatoria()) {
        <sge-alert
          tom="aviso"
          titulo="Ajuste altera o saldo sem documento de origem"
          mensagem="A justificativa fica no razão e na trilha de auditoria."
        />
      }

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="movimentoAberto.set(false)"
        />
        <p-button
          label="Lançar"
          icon="pi pi-check"
          [loading]="salvandoMovimento()"
          [disabled]="salvandoMovimento() || !movimentoValido()"
          (onClick)="salvarMovimento()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="transferenciaAberta()"
      (visibleChange)="transferenciaAberta.set($event)"
      [modal]="true"
      [style]="{ width: '42rem' }"
      header="Transferência entre locais"
    >
      @if (erroTransferencia(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvarTransferencia()">
        <sge-search-select
          rotulo="Item"
          name="transferProductId"
          [buscar]="buscarProduto"
          [obrigatorio]="true"
          [ngModel]="formTransferencia().productId"
          (ngModelChange)="mudarTransferencia('productId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Local de origem"
          name="fromLocationId"
          [opcoes]="opcoesLocal()"
          [obrigatorio]="true"
          [ngModel]="formTransferencia().fromLocationId"
          (ngModelChange)="mudarTransferencia('fromLocationId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Local de destino"
          name="toLocationId"
          [opcoes]="opcoesLocal()"
          [obrigatorio]="true"
          [ngModel]="formTransferencia().toLocationId"
          (ngModelChange)="mudarTransferencia('toLocationId', $event ?? '')"
        />
        <sge-decimal-field
          rotulo="Quantidade"
          name="transferQuantity"
          [casas]="6"
          [obrigatorio]="true"
          [ngModel]="formTransferencia().quantity"
          (ngModelChange)="mudarTransferencia('quantity', $event ?? '')"
        />
        <sge-text-field
          rotulo="Data do movimento"
          name="transferDate"
          tipo="date"
          [ngModel]="formTransferencia().movementDate"
          (ngModelChange)="mudarTransferencia('movementDate', $event)"
        />
        <sge-text-field
          rotulo="Observação"
          name="transferNote"
          [ngModel]="formTransferencia().note"
          (ngModelChange)="mudarTransferencia('note', $event)"
        />
      </form>

      @if (mesmoLocal()) {
        <sge-alert
          tom="aviso"
          titulo="Origem e destino são o mesmo local"
          mensagem="A transferência precisa de dois locais diferentes."
        />
      }

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="transferenciaAberta.set(false)"
        />
        <p-button
          label="Transferir"
          icon="pi pi-check"
          [loading]="salvandoTransferencia()"
          [disabled]="salvandoTransferencia() || !transferenciaValida()"
          (onClick)="salvarTransferencia()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.5rem;
    }
  `,
})
export class StockMovementsPage {
  private readonly api = inject(StockApiService);
  private readonly catalogo = inject(CatalogApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_TIPO_MOVIMENTO = FILTRO_TIPO_MOVIMENTO;
  protected readonly OPCOES_LANCAMENTO = OPCOES_LANCAMENTO;

  protected readonly colunas: Coluna[] = [
    { campo: 'movementDate', cabecalho: 'Data', largura: '8rem' },
    { campo: 'type', cabecalho: 'Tipo', largura: '12rem' },
    { campo: 'product', cabecalho: 'Item' },
    { campo: 'location', cabecalho: 'Local', largura: '14rem' },
    { campo: 'quantity', cabecalho: 'Qtd.', numerica: true, largura: '9rem' },
    { campo: 'unitCost', cabecalho: 'Custo unit.', numerica: true, largura: '10rem' },
    { campo: 'origin', cabecalho: 'Origem', largura: '12rem' },
  ];

  protected readonly lista = new ListState<StockMovement>(
    (consulta) => this.api.listMovements(consulta),
    consultaMovimento,
  );

  protected readonly aviso = signal<string | null>(null);
  protected readonly opcoesLocal = signal<OpcaoFiltro[]>([]);
  /** Busca no catálogo inteiro pelo termo — nunca "os primeiros 100". */
  protected readonly buscarProduto = (termo: string) =>
    this.catalogo
      .list({ q: termo, pageSize: LIMITE_BUSCA, isActive: true })
      .pipe(
        map((r) => r.data.map((p) => ({ value: p.id, label: `${p.code} — ${p.description}` }))),
      );

  protected readonly movimentoAberto = signal(false);
  protected readonly formMovimento = signal<FormularioMovimento>({ ...MOVIMENTO_VAZIO });
  protected readonly salvandoMovimento = signal(false);
  protected readonly erroMovimento = signal<unknown>(null);

  protected readonly transferenciaAberta = signal(false);
  protected readonly formTransferencia = signal<FormularioTransferencia>({
    ...TRANSFERENCIA_VAZIA,
  });
  protected readonly salvandoTransferencia = signal(false);
  protected readonly erroTransferencia = signal<unknown>(null);

  protected readonly podeLancar = () => this.permissoes.pode('stock-movements:CREATE');

  protected readonly justificativaObrigatoria = computed(() =>
    exigeJustificativa(this.formMovimento().type),
  );

  protected readonly movimentoValido = computed(() => {
    const form = this.formMovimento();
    if (form.type === '' || form.productId === '' || form.locationId === '') return false;
    if (form.quantity.trim() === '') return false;
    return !this.justificativaObrigatoria() || form.note.trim().length >= 3;
  });

  protected readonly mesmoLocal = computed(() => {
    const form = this.formTransferencia();
    return form.fromLocationId !== '' && form.fromLocationId === form.toLocationId;
  });

  protected readonly transferenciaValida = computed(() => {
    const form = this.formTransferencia();
    return (
      form.productId !== '' &&
      form.fromLocationId !== '' &&
      form.toLocationId !== '' &&
      !this.mesmoLocal() &&
      form.quantity.trim() !== ''
    );
  });

  constructor() {
    this.lista.carregar();
    this.carregarReferencias();
  }

  protected filtroLocal() {
    return {
      name: 'locationId',
      label: 'Local',
      placeholder: 'Local',
      options: this.opcoesLocal(),
    };
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected rotulo(tipo: StockMovementType): string {
    return ROTULO_MOVIMENTO[tipo] ?? tipo;
  }

  protected severidade(tipo: StockMovementType) {
    return severidadeMovimento(tipo);
  }

  /** Transferência mostra origem → destino; os demais, só o local. */
  protected local(movimento: StockMovement): string {
    const nome = movimento.location?.name ?? '—';
    if (!movimento.counterpart) return nome;
    return movimento.type === 'TRANSFERENCIA_SAIDA'
      ? `${nome} → ${movimento.counterpart.name}`
      : `${movimento.counterpart.name} → ${nome}`;
  }

  /** O sinal vem do tipo: a quantidade é sempre gravada positiva. */
  protected quantidadeComSinal(movimento: StockMovement): string {
    const quantidade = formatDecimal(movimento.quantity, 6);
    if (reduzSaldo(movimento.type)) return `−${quantidade}`;
    if (movimento.type === 'ENTRADA' || movimento.type === 'AJUSTE_POSITIVO') {
      return `+${quantidade}`;
    }
    return quantidade;
  }

  protected origem(movimento: StockMovement): string {
    return movimento.origin ?? movimento.note ?? '—';
  }

  protected mudarMovimento<K extends keyof FormularioMovimento>(
    campo: K,
    valor: FormularioMovimento[K],
  ): void {
    this.formMovimento.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarTransferencia<K extends keyof FormularioTransferencia>(
    campo: K,
    valor: FormularioTransferencia[K],
  ): void {
    this.formTransferencia.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrirMovimento(): void {
    this.formMovimento.set({ ...MOVIMENTO_VAZIO });
    this.erroMovimento.set(null);
    this.movimentoAberto.set(true);
  }

  protected abrirTransferencia(): void {
    this.formTransferencia.set({ ...TRANSFERENCIA_VAZIA });
    this.erroTransferencia.set(null);
    this.transferenciaAberta.set(true);
  }

  protected salvarMovimento(): void {
    if (this.salvandoMovimento() || !this.movimentoValido()) return;
    this.salvandoMovimento.set(true);
    this.erroMovimento.set(null);

    const form = this.formMovimento();
    const corpo: StockMovementInput = {
      type: form.type as StockEntryType,
      productId: form.productId,
      locationId: form.locationId,
      quantity: form.quantity,
    };
    if (form.unitCost.trim() !== '') corpo.unitCost = form.unitCost;
    if (form.movementDate !== '') corpo.movementDate = form.movementDate;
    if (form.note.trim() !== '') corpo.note = form.note.trim();

    this.api
      .createMovement(corpo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.salvandoMovimento.set(false);
          this.movimentoAberto.set(false);
          this.aviso.set('Movimento lançado.');
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.salvandoMovimento.set(false);
          this.erroMovimento.set(falha);
        },
      });
  }

  protected salvarTransferencia(): void {
    if (this.salvandoTransferencia() || !this.transferenciaValida()) return;
    this.salvandoTransferencia.set(true);
    this.erroTransferencia.set(null);

    const form = this.formTransferencia();
    const corpo: StockTransferInput = {
      productId: form.productId,
      fromLocationId: form.fromLocationId,
      toLocationId: form.toLocationId,
      quantity: form.quantity,
    };
    if (form.movementDate !== '') corpo.movementDate = form.movementDate;
    if (form.note.trim() !== '') corpo.note = form.note.trim();

    this.api
      .createTransfer(corpo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.salvandoTransferencia.set(false);
          this.transferenciaAberta.set(false);
          this.aviso.set('Transferência registrada com as duas pernas.');
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.salvandoTransferencia.set(false);
          this.erroTransferencia.set(falha);
        },
      });
  }

  private carregarReferencias(): void {
    if (this.permissoes.pode('stock-locations:READ')) {
      this.api
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
