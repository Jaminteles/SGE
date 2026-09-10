import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { StockApiService } from '../core/api/stock-api.service';
import type { Inventory, InventoryCountInput, InventoryItem } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency, formatDecimal, parseDecimalInput } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { Alert } from '../ui/alert';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { TextField } from '../ui/text-field';
import { ROTULO_INVENTARIO } from './rotulos';

/** Decimal canônico em inteiro escalado, sem passar por `number`. */
function paraInteiro(valor: string): { valor: bigint; escala: number } {
  const negativo = valor.startsWith('-');
  const semSinal = negativo ? valor.slice(1) : valor;
  const [inteiro = '0', fracao = ''] = semSinal.split('.');
  const digitos = `${inteiro}${fracao}`;
  const bruto = digitos === '' ? 0n : BigInt(digitos);
  return { valor: negativo ? -bruto : bruto, escala: fracao.length };
}

function formatarCentavos(centavos: bigint): string {
  const negativo = centavos < 0n;
  const absoluto = (negativo ? -centavos : centavos).toString().padStart(3, '0');
  return `${negativo ? '-' : ''}${absoluto.slice(0, -2)}.${absoluto.slice(-2)}`;
}

/**
 * Multiplica dois decimais canônicos e devolve o resultado com 2 casas.
 *
 * Em `bigint`, não em `number`: o impacto é dinheiro, e `0.1 * 3` em ponto
 * flutuante já não fecharia com o `numeric(18,2)` do banco (RN-012).
 */
function multiplicar(a: string, b: string): string {
  const x = paraInteiro(a);
  const y = paraInteiro(b);
  let produto = x.valor * y.valor;
  const escala = x.escala + y.escala;

  if (escala > 2) {
    const divisor = 10n ** BigInt(escala - 2);
    const negativo = produto < 0n;
    const absoluto = negativo ? -produto : produto;
    const quociente = absoluto / divisor;
    const resto = absoluto % divisor;
    const arredondado = resto * 2n >= divisor ? quociente + 1n : quociente;
    produto = negativo ? -arredondado : arredondado;
  } else if (escala < 2) {
    produto *= 10n ** BigInt(2 - escala);
  }
  return formatarCentavos(produto);
}

/** Diferença entre contagem e sistema, preservando as 6 casas da quantidade. */
function subtrair(contado: string, sistema: string): string {
  const a = paraInteiro(contado);
  const b = paraInteiro(sistema);
  const escala = Math.max(a.escala, b.escala);
  const normaliza = (n: { valor: bigint; escala: number }) =>
    n.valor * 10n ** BigInt(escala - n.escala);
  const diferenca = normaliza(a) - normaliza(b);

  if (escala === 0) return diferenca.toString();
  const negativo = diferenca < 0n;
  const absoluto = (negativo ? -diferenca : diferenca).toString().padStart(escala + 1, '0');
  const texto = `${absoluto.slice(0, -escala)}.${absoluto.slice(-escala)}`;
  return `${negativo ? '-' : ''}${texto}`;
}

/**
 * Contagem, divergências e conclusão do inventário (RF-033 — UI-023).
 *
 * A diferença e o impacto exibidos são **projeção da tela**, calculada em
 * `bigint` sobre o custo unitário fotografado na abertura. O número que vale é
 * o que o backend apura ao concluir — é ele quem gera os movimentos de ajuste,
 * dentro de uma transação.
 *
 * Concluir exige permissão de aprovação (`inventories:APPROVE`), à parte de
 * lançar contagem: quem conta não é quem homologa o ajuste de patrimônio.
 */
@Component({
  selector: 'sge-inventory-detail-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    TagModule,
    Alert,
    DecimalField,
    ErrorAlert,
    TextField,
  ],
  template: `
    <p class="crumb">Estoque / Inventário / {{ numero() }}</p>

    <div class="pagehead">
      <div>
        <h1>Inventário {{ numero() }}</h1>
        <p>{{ subtitulo() }}</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          routerLink="/estoque/inventarios"
        />
        @if (inventario(); as registro) {
          @if (podeContar() && registro.status === 'ABERTO') {
            <p-button
              label="Liberar contagem"
              severity="secondary"
              [outlined]="true"
              [loading]="agindo()"
              [disabled]="agindo()"
              (onClick)="liberar()"
            />
          }
          @if (podeContar() && registro.status === 'EM_CONTAGEM') {
            <p-button
              label="Salvar contagem"
              icon="pi pi-check"
              [loading]="agindo()"
              [disabled]="agindo() || contagensPendentes().length === 0"
              (onClick)="salvarContagem()"
            />
          }
          @if (podeConcluir() && registro.status === 'EM_CONTAGEM') {
            <p-button
              label="Concluir inventário"
              [loading]="agindo()"
              [disabled]="agindo()"
              (onClick)="abrirConclusao()"
            />
          }
          @if (
            podeCancelar() && registro.status !== 'CONCLUIDO' && registro.status !== 'CANCELADO'
          ) {
            <p-button
              label="Cancelar"
              severity="danger"
              [text]="true"
              [loading]="agindo()"
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

    <div class="kpis">
      <div class="kpi">
        <p class="kpi__label">Itens no escopo</p>
        <p class="kpi__value">{{ itens().length }}</p>
        <p class="kpi__detail">{{ inventario()?.location?.name ?? '—' }}</p>
      </div>
      <div class="kpi">
        <p class="kpi__label">Contados</p>
        <p class="kpi__value">{{ contados() }}</p>
        <p class="kpi__detail">{{ percentualContado() }} concluído</p>
      </div>
      <div class="kpi">
        <p class="kpi__label">Com divergência</p>
        <p class="kpi__value">{{ divergentes() }}</p>
      </div>
      <div class="kpi">
        <p class="kpi__label">Ajuste projetado</p>
        <p class="kpi__value">{{ moeda(ajusteProjetado()) }}</p>
        <p class="kpi__detail">sobre o custo médio fotografado</p>
      </div>
    </div>

    <section class="card table-card espaco">
      @if (itens().length === 0) {
        <p class="nota">Nenhum item no escopo deste inventário.</p>
      } @else {
        <table class="itens">
          <thead>
            <tr>
              <th scope="col">Código</th>
              <th scope="col">Descrição</th>
              <th scope="col" class="coluna--numerica">Saldo sistema</th>
              <th scope="col">Contagem</th>
              <th scope="col" class="coluna--numerica">Diferença</th>
              <th scope="col" class="coluna--numerica">Impacto</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            @for (item of itens(); track item.id) {
              <tr>
                <td>{{ item.product?.code ?? '—' }}</td>
                <td>{{ item.product?.description ?? '—' }}</td>
                <td class="coluna--numerica">{{ quantidade(item.systemQuantity) }}</td>
                <td class="celula-contagem">
                  @if (emContagem()) {
                    <sge-decimal-field
                      rotulo="Contagem"
                      [name]="'contagem-' + item.id"
                      [casas]="6"
                      [ngModel]="valorContado(item)"
                      (ngModelChange)="registrarContagem(item, $event)"
                    />
                  } @else {
                    {{ item.countedQuantity ? quantidade(item.countedQuantity) : '—' }}
                  }
                </td>
                <td class="coluna--numerica">{{ diferenca(item) }}</td>
                <td class="coluna--numerica">{{ impacto(item) }}</td>
                <td>
                  <p-tag
                    [value]="situacao(item)"
                    [severity]="severidadeItem(item)"
                    [rounded]="true"
                  />
                </td>
              </tr>
            }
          </tbody>
        </table>
        <p class="nota">
          Diferença e impacto são projeção da tela; o ajuste oficial é apurado pelo servidor ao
          concluir (RF-033).
        </p>
      }
    </section>

    <p-dialog
      [visible]="conclusaoAberta()"
      (visibleChange)="conclusaoAberta.set($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      header="Concluir inventário"
    >
      <sge-alert
        tom="aviso"
        titulo="A conclusão gera movimentos de ajuste"
        mensagem="Cada divergência vira um ajuste no razão de estoque, dentro de uma transação. O inventário não reabre."
      />
      @if (naoContados() > 0) {
        <sge-alert
          tom="info"
          [titulo]="naoContados() + ' item(ns) sem contagem'"
          mensagem="Itens sem contagem não geram ajuste."
        />
      }
      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="conclusaoAberta.set(false)"
        />
        <p-button
          label="Concluir e ajustar"
          icon="pi pi-check"
          [loading]="agindo()"
          [disabled]="agindo()"
          (onClick)="concluir()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="cancelamentoAberto()"
      (visibleChange)="cancelamentoAberto.set($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      header="Cancelar inventário"
    >
      <form class="grade-campos formulario" (ngSubmit)="cancelar()">
        <sge-text-field
          rotulo="Motivo"
          name="motivo"
          [obrigatorio]="true"
          dica="O registro é preservado (RN-009)"
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
          label="Cancelar inventário"
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
    .itens {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .itens th,
    .itens td {
      padding: 0.5rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .itens th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .itens .coluna--numerica {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .celula-contagem {
      width: 11rem;
    }
  `,
})
export class InventoryDetailPage {
  private readonly api = inject(StockApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly inventoryId = this.rota.snapshot.paramMap.get('id') ?? '';

  protected readonly inventario = signal<Inventory | null>(null);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly agindo = signal(false);

  /** Contagens digitadas mas ainda não enviadas, por item. */
  protected readonly rascunho = signal<Record<string, string>>({});

  protected readonly conclusaoAberta = signal(false);
  protected readonly cancelamentoAberto = signal(false);
  protected readonly motivo = signal('');

  protected readonly itens = computed(() => this.inventario()?.items ?? []);

  protected readonly numero = computed(() => this.inventario()?.number ?? '—');

  protected readonly emContagem = computed(
    () => this.inventario()?.status === 'EM_CONTAGEM' && this.podeContar(),
  );

  protected readonly subtitulo = computed(() => {
    const registro = this.inventario();
    if (!registro) return 'Contagem, divergências e conclusão com ajuste automático (RF-033).';
    const partes = [
      registro.location?.name,
      ROTULO_INVENTARIO[registro.status],
      `aberto em ${formatDate(registro.startedAt)}`,
    ].filter(Boolean);
    return `${partes.join(' · ')}.`;
  });

  protected readonly contados = computed(
    () => this.itens().filter((item) => this.valorContado(item) !== '').length,
  );

  protected readonly naoContados = computed(() => this.itens().length - this.contados());

  protected readonly percentualContado = computed(() => {
    const total = this.itens().length;
    if (total === 0) return '0%';
    return `${Math.round((this.contados() / total) * 100)}%`;
  });

  protected readonly divergentes = computed(
    () => this.itens().filter((item) => this.diferencaCanonica(item) !== null).length,
  );

  /** Soma dos impactos projetados, em centavos — sem ponto flutuante. */
  protected readonly ajusteProjetado = computed(() => {
    let centavos = 0n;
    for (const item of this.itens()) {
      const impacto = this.impactoCanonico(item);
      if (impacto === null) continue;
      centavos += paraInteiro(impacto).valor;
    }
    return formatarCentavos(centavos);
  });

  /** Itens com contagem digitada e ainda não enviada ao servidor. */
  protected readonly contagensPendentes = computed(() =>
    Object.entries(this.rascunho())
      .filter(([, valor]) => valor.trim() !== '')
      .map(([itemId, countedQuantity]) => ({ itemId, countedQuantity })),
  );

  protected readonly podeContar = () => this.permissoes.pode('inventories:UPDATE');
  protected readonly podeConcluir = () => this.permissoes.pode('inventories:APPROVE');
  protected readonly podeCancelar = () => this.permissoes.pode('inventories:DELETE');

  constructor() {
    this.carregar();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected quantidade(valor: string): string {
    return formatDecimal(valor, 6);
  }

  /** O que está na tela: o rascunho, se houver, senão o que veio do servidor. */
  protected valorContado(item: InventoryItem): string {
    return this.rascunho()[item.id] ?? item.countedQuantity ?? '';
  }

  protected registrarContagem(item: InventoryItem, valor: string | null): void {
    this.rascunho.update((atual) => ({ ...atual, [item.id]: valor ?? '' }));
  }

  protected diferenca(item: InventoryItem): string {
    const valor = this.diferencaCanonica(item);
    if (valor === null) return this.valorContado(item) === '' ? '—' : '0';
    const texto = formatDecimal(valor, 6);
    return valor.startsWith('-') ? texto : `+${texto}`;
  }

  protected impacto(item: InventoryItem): string {
    const valor = this.impactoCanonico(item);
    if (valor === null) return this.valorContado(item) === '' ? '—' : formatCurrency('0');
    return formatCurrency(valor);
  }

  protected situacao(item: InventoryItem): string {
    if (this.valorContado(item) === '') return 'Pendente';
    return this.diferencaCanonica(item) === null ? 'Conferido' : 'Divergente';
  }

  protected severidadeItem(item: InventoryItem) {
    if (this.valorContado(item) === '') return 'secondary' as const;
    return this.diferencaCanonica(item) === null ? ('success' as const) : ('warn' as const);
  }

  protected liberar(): void {
    this.executar(() => this.api.startInventory(this.inventoryId), 'Contagem liberada.');
  }

  protected salvarContagem(): void {
    const pendentes = this.contagensPendentes();
    if (pendentes.length === 0 || this.agindo()) return;

    const itens = new Map(this.itens().map((item) => [item.id, item]));
    const counts: InventoryCountInput['counts'] = [];
    for (const pendente of pendentes) {
      const item = itens.get(pendente.itemId);
      if (!item) continue;
      const analisado = parseDecimalInput(pendente.countedQuantity, { casas: 6 });
      if (analisado.value === null) continue;
      counts.push({ productId: item.productId, countedQuantity: analisado.value });
    }
    if (counts.length === 0) return;

    this.agindo.set(true);
    this.erro.set(null);
    this.api
      .countInventory(this.inventoryId, { counts })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registro) => {
          this.agindo.set(false);
          this.inventario.set(registro);
          // O servidor devolve a contagem gravada: o rascunho já cumpriu o papel.
          this.rascunho.set({});
          this.aviso.set(`${counts.length} contagem(ns) registrada(s).`);
        },
        error: (falha: unknown) => {
          this.agindo.set(false);
          this.erro.set(falha);
        },
      });
  }

  protected abrirConclusao(): void {
    this.conclusaoAberta.set(true);
  }

  protected concluir(): void {
    this.conclusaoAberta.set(false);
    this.executar(
      () => this.api.closeInventory(this.inventoryId),
      'Inventário concluído: os ajustes foram lançados no razão.',
    );
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
      () => this.api.cancelInventory(this.inventoryId, motivo),
      'Inventário cancelado; o registro foi preservado.',
    );
  }

  /** `null` quando não há contagem ou quando ela bate com o sistema. */
  private diferencaCanonica(item: InventoryItem): string | null {
    const contado = this.valorContado(item);
    if (contado.trim() === '') return null;
    const analisado = parseDecimalInput(contado, { casas: 6 });
    if (analisado.value === null) return null;
    const diferenca = subtrair(analisado.value, item.systemQuantity);
    return paraInteiro(diferenca).valor === 0n ? null : diferenca;
  }

  private impactoCanonico(item: InventoryItem): string | null {
    const diferenca = this.diferencaCanonica(item);
    if (diferenca === null) return null;
    return multiplicar(diferenca, item.unitCost ?? '0');
  }

  private executar(
    acao: () => ReturnType<StockApiService['startInventory']>,
    mensagem: string,
  ): void {
    if (this.agindo()) return;
    this.agindo.set(true);
    this.erro.set(null);
    acao()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registro) => {
          this.agindo.set(false);
          this.inventario.set(registro);
          this.rascunho.set({});
          this.aviso.set(mensagem);
        },
        error: (falha: unknown) => {
          this.agindo.set(false);
          this.erro.set(falha);
        },
      });
  }

  private carregar(): void {
    this.api
      .getInventory(this.inventoryId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registro) => this.inventario.set(registro),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }
}
