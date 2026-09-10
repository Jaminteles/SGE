import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { EmployeesApiService } from '../core/api/employees-api.service';
import { ReimbursementsApiService } from '../core/api/reimbursements-api.service';
import type {
  Reimbursement,
  ReimbursementInput,
  ReimbursementItem,
  ReimbursementItemInput,
  ReimbursementStatus,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency, parseDecimalInput } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar } from '../ui/filter-bar';
import { LIMITE_BUSCA, SearchSelect } from '../ui/search-select';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  FILTRO_STATUS_REEMBOLSO,
  ROTULO_REEMBOLSO,
  consultaReembolso,
  severidadeReembolso,
} from './rotulos';

/** Situações contadas na faixa de indicadores do topo. */
const CONTADORES: { status: ReimbursementStatus; rotulo: string }[] = [
  { status: 'SOLICITADO', rotulo: 'Aguardando análise' },
  { status: 'EM_ANALISE', rotulo: 'Em análise' },
  { status: 'APROVADO', rotulo: 'Aprovados' },
  { status: 'PAGO', rotulo: 'Pagos' },
];

/** Uma despesa em edição no formulário de nova solicitação. */
interface ItemFormulario {
  description: string;
  expenseDate: string;
  amount: string;
}

const ITEM_VAZIO: ItemFormulario = { description: '', expenseDate: '', amount: '' };

interface Formulario {
  employeeId: string;
  description: string;
  note: string;
  items: ItemFormulario[];
}

const VAZIO: Formulario = {
  employeeId: '',
  description: '',
  note: '',
  items: [{ ...ITEM_VAZIO }],
};

/** Tipos aceitos pelo backend no comprovante (RF-019). */
const TIPOS_COMPROVANTE = 'application/pdf,image/jpeg,image/png';

/**
 * Reembolsos com comprovante e fluxo de aprovação (RF-018/RF-019 — UI-017).
 *
 * O valor total não é digitado: sai da soma dos itens no servidor, e o número
 * é sequencial gerado pelo banco. Cada transição de estado é uma rota própria
 * (`submit`, `review`, `approve`, `reject`), nunca um PATCH de `status` — quem
 * valida a máquina de estados e a alçada é o backend.
 *
 * O comprovante não vira link direto: a rota exige token e cabeçalho de
 * empresa, então o download passa pelo cliente HTTP e a URL de objeto é
 * revogada logo em seguida.
 */
@Component({
  selector: 'sge-reimbursements-page',
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
    <p class="crumb">RH / Reembolsos</p>

    <div class="pagehead">
      <div>
        <h1>Reembolsos</h1>
        <p>Solicitações com comprovante e fluxo de aprovação (RF-018/RF-019).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Nova solicitação" icon="pi pi-plus" (onClick)="abrirNova()" />
        }
      </div>
    </div>

    <div class="kpis">
      @for (contador of contadores(); track contador.rotulo) {
        <div class="kpi">
          <p class="kpi__label">{{ contador.rotulo }}</p>
          <p class="kpi__value">{{ contador.total }}</p>
        </div>
      }
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar por número, solicitante ou descrição"
      [valores]="lista.filtros()"
      [filtros]="[FILTRO_STATUS_REEMBOLSO]"
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
        [mensagemVazia]="
          lista.temFiltro()
            ? 'Nenhuma solicitação encontrada com esses filtros.'
            : 'Nenhuma solicitação registrada.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-solicitacao>
          <tr>
            <td>{{ solicitacao.number }}</td>
            <td>{{ solicitacao.employee.name }}</td>
            <td>{{ solicitacao.description }}</td>
            <td class="coluna--numerica">{{ moeda(solicitacao.totalAmount) }}</td>
            <td>
              <p-tag
                [value]="comprovantes(solicitacao)"
                [severity]="temTodosComprovantes(solicitacao) ? 'success' : 'warn'"
                [rounded]="true"
              />
            </td>
            <td>
              <p-tag
                [value]="rotulo(solicitacao.status)"
                [severity]="severidade(solicitacao.status)"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              <p-button
                label="Abrir"
                severity="secondary"
                [text]="true"
                size="small"
                (onClick)="abrirDetalhe(solicitacao)"
              />
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>

    <p-dialog
      [visible]="detalheAberto()"
      (visibleChange)="detalheAberto.set($event)"
      [modal]="true"
      [style]="{ width: '52rem' }"
      [header]="cabecalhoDetalhe()"
    >
      @if (erroDetalhe(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      @if (detalhe(); as solicitacao) {
        <div class="resumo">
          <p><strong>Solicitante:</strong> {{ solicitacao.employee.name }}</p>
          <p><strong>Solicitado em:</strong> {{ data(solicitacao.requestDate) }}</p>
          <p><strong>Total:</strong> {{ moeda(solicitacao.totalAmount) }}</p>
          @if (solicitacao.approvedAmount) {
            <p><strong>Aprovado:</strong> {{ moeda(solicitacao.approvedAmount) }}</p>
          }
        </div>

        <table class="itens">
          <thead>
            <tr>
              <th scope="col">Despesa</th>
              <th scope="col">Data</th>
              <th scope="col" class="coluna--numerica">Valor</th>
              <th scope="col">Comprovante</th>
            </tr>
          </thead>
          <tbody>
            @for (item of solicitacao.items; track item.id) {
              <tr>
                <td>{{ item.description }}</td>
                <td>{{ data(item.expenseDate) }}</td>
                <td class="coluna--numerica">{{ moeda(item.amount) }}</td>
                <td class="acoes">
                  @if (item.document) {
                    <span class="secundario">{{ item.document.fileName }}</span>
                    <p-button
                      label="Baixar"
                      severity="secondary"
                      [text]="true"
                      size="small"
                      (onClick)="baixarComprovante(solicitacao, item)"
                    />
                  } @else if (podeAnexar() && aceitaAnexo(solicitacao)) {
                    <label class="anexo">
                      <span>Anexar</span>
                      <input
                        type="file"
                        [accept]="TIPOS_COMPROVANTE"
                        (change)="anexar(solicitacao, item, $event)"
                      />
                    </label>
                  } @else {
                    <span class="secundario">Ausente</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>

        @if (mostrarAprovacao()) {
          <div class="grade-campos formulario">
            <sge-decimal-field
              rotulo="Valor aprovado"
              name="approvedAmount"
              dica="Em branco = total solicitado. Nunca maior que ele."
              [ngModel]="valorAprovado()"
              (ngModelChange)="valorAprovado.set($event ?? '')"
            />
            <sge-text-field
              rotulo="Motivo da reprovação"
              name="motivo"
              dica="Obrigatório para reprovar"
              [ngModel]="motivo()"
              (ngModelChange)="motivo.set($event)"
            />
          </div>
        }
      }

      <ng-template #footer>
        <p-button
          label="Fechar"
          severity="secondary"
          [outlined]="true"
          (onClick)="detalheAberto.set(false)"
        />
        @if (detalhe(); as solicitacao) {
          @if (podeEnviar() && solicitacao.status === 'RASCUNHO') {
            <p-button
              label="Enviar para aprovação"
              [loading]="agindo()"
              [disabled]="agindo()"
              (onClick)="executar('submit')"
            />
          }
          @if (podeAprovar() && solicitacao.status === 'SOLICITADO') {
            <p-button
              label="Iniciar análise"
              severity="secondary"
              [loading]="agindo()"
              [disabled]="agindo()"
              (onClick)="executar('review')"
            />
          }
          @if (mostrarAprovacao()) {
            <p-button
              label="Reprovar"
              severity="danger"
              [outlined]="true"
              [loading]="agindo()"
              [disabled]="agindo() || motivo().trim().length < 3"
              (onClick)="executar('reject')"
            />
            <p-button
              label="Aprovar"
              icon="pi pi-check"
              [loading]="agindo()"
              [disabled]="agindo()"
              (onClick)="executar('approve')"
            />
          }
          @if (podeCancelar() && aceitaCancelamento(solicitacao)) {
            <p-button
              label="Cancelar solicitação"
              severity="danger"
              [text]="true"
              [loading]="agindo()"
              [disabled]="agindo()"
              (onClick)="executar('cancel')"
            />
          }
        }
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="novaAberta()"
      (visibleChange)="novaAberta.set($event)"
      [modal]="true"
      [style]="{ width: '52rem' }"
      header="Nova solicitação"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvar()">
        <sge-search-select
          rotulo="Solicitante"
          name="employeeId"
          [buscar]="buscarFuncionario"
          [obrigatorio]="true"
          [ngModel]="form().employeeId"
          (ngModelChange)="mudar('employeeId', $event ?? '')"
        />
        <sge-text-field
          rotulo="Descrição"
          name="description"
          [obrigatorio]="true"
          [ngModel]="form().description"
          (ngModelChange)="mudar('description', $event)"
        />
        <sge-text-field
          rotulo="Observação"
          name="note"
          [ngModel]="form().note"
          (ngModelChange)="mudar('note', $event)"
        />
      </form>

      <h3 class="secao__titulo">Despesas</h3>
      @for (item of form().items; track $index) {
        <div class="grade-campos item">
          <sge-text-field
            rotulo="Descrição da despesa"
            [name]="'itemDescription' + $index"
            [obrigatorio]="true"
            [ngModel]="item.description"
            (ngModelChange)="mudarItem($index, 'description', $event)"
          />
          <sge-text-field
            rotulo="Data"
            [name]="'itemDate' + $index"
            tipo="date"
            [obrigatorio]="true"
            [ngModel]="item.expenseDate"
            (ngModelChange)="mudarItem($index, 'expenseDate', $event)"
          />
          <sge-decimal-field
            rotulo="Valor"
            [name]="'itemAmount' + $index"
            [obrigatorio]="true"
            [ngModel]="item.amount"
            (ngModelChange)="mudarItem($index, 'amount', $event ?? '')"
          />
          @if (form().items.length > 1) {
            <p-button
              label="Remover"
              severity="secondary"
              [text]="true"
              size="small"
              (onClick)="removerItem($index)"
            />
          }
        </div>
      }

      <div class="rodape-itens">
        <p-button
          label="Adicionar despesa"
          icon="pi pi-plus"
          severity="secondary"
          [outlined]="true"
          size="small"
          (onClick)="adicionarItem()"
        />
        <p class="nota">
          Total calculado: {{ moeda(totalPrevisto()) }} — o valor oficial é o que o servidor somar.
        </p>
      </div>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="novaAberta.set(false)"
        />
        <p-button
          label="Criar solicitação"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando()"
          (onClick)="salvar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.5rem;
    }
    .resumo {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      font-size: 0.8rem;
      color: var(--p-text-color);
      margin-bottom: 0.75rem;
    }
    .resumo p {
      margin: 0;
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
    .anexo {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.75rem;
      color: var(--p-primary-color);
      cursor: pointer;
    }
    .item {
      align-items: end;
      padding-bottom: 0.5rem;
    }
    .rodape-itens {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding-top: 0.5rem;
    }
  `,
})
export class ReimbursementsPage {
  private readonly api = inject(ReimbursementsApiService);
  private readonly employees = inject(EmployeesApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_STATUS_REEMBOLSO = FILTRO_STATUS_REEMBOLSO;
  protected readonly TIPOS_COMPROVANTE = TIPOS_COMPROVANTE;

  protected readonly colunas: Coluna[] = [
    { campo: 'number', cabecalho: 'Nº', largura: '8rem' },
    { campo: 'employee', cabecalho: 'Solicitante' },
    { campo: 'description', cabecalho: 'Descrição' },
    { campo: 'totalAmount', cabecalho: 'Valor', numerica: true, largura: '9rem' },
    { campo: 'document', cabecalho: 'Comprovante', largura: '9rem' },
    { campo: 'status', cabecalho: 'Situação', largura: '9rem' },
    { campo: 'acoes', cabecalho: '', largura: '7rem' },
  ];

  protected readonly lista = new ListState<Reimbursement>(
    (consulta) => this.api.list(consulta),
    consultaReembolso,
  );

  protected readonly contadores = signal<{ rotulo: string; total: number }[]>([]);
  /** Solicitante: busca no quadro ativo inteiro, nunca "os primeiros 100". */
  protected readonly buscarFuncionario = (termo: string) =>
    this.employees
      .list({ q: termo, status: 'ATIVO', pageSize: LIMITE_BUSCA })
      .pipe(
        map((r) => r.data.map((e) => ({ value: e.id, label: `${e.registration} — ${e.name}` }))),
      );
  protected readonly aviso = signal<string | null>(null);

  protected readonly detalheAberto = signal(false);
  protected readonly detalhe = signal<Reimbursement | null>(null);
  protected readonly erroDetalhe = signal<unknown>(null);
  protected readonly agindo = signal(false);
  protected readonly valorAprovado = signal('');
  protected readonly motivo = signal('');

  protected readonly novaAberta = signal(false);
  protected readonly form = signal<Formulario>({ ...VAZIO, items: [{ ...ITEM_VAZIO }] });
  protected readonly salvando = signal(false);
  protected readonly erroForm = signal<unknown>(null);

  protected readonly podeCriar = () => this.permissoes.pode('reimbursements:CREATE');
  protected readonly podeEnviar = () => this.permissoes.pode('reimbursements:UPDATE');
  protected readonly podeAnexar = () => this.permissoes.pode('reimbursements:UPDATE');
  protected readonly podeAprovar = () => this.permissoes.pode('reimbursements:APPROVE');
  protected readonly podeCancelar = () => this.permissoes.pode('reimbursements:DELETE');

  protected readonly cabecalhoDetalhe = computed(() => {
    const solicitacao = this.detalhe();
    return solicitacao ? `Reembolso ${solicitacao.number}` : 'Reembolso';
  });

  /** Aprovar e reprovar só aparecem no estado em que o backend os aceita. */
  protected readonly mostrarAprovacao = computed(() => {
    const solicitacao = this.detalhe();
    if (!solicitacao || !this.podeAprovar()) return false;
    return solicitacao.status === 'EM_ANALISE';
  });

  /**
   * Prévia do total, só para o usuário conferir enquanto digita. O valor que
   * vale é o que o servidor soma — este nunca é enviado.
   */
  protected readonly totalPrevisto = computed(() => {
    let centavos = 0n;
    for (const item of this.form().items) {
      const analisado = parseDecimalInput(item.amount);
      if (analisado.value === null) continue;
      const [inteiro, decimal = '00'] = analisado.value.split('.');
      centavos += BigInt(`${inteiro}${decimal.padEnd(2, '0').slice(0, 2)}`);
    }
    const sinal = centavos < 0n ? '-' : '';
    const absoluto = (centavos < 0n ? -centavos : centavos).toString().padStart(3, '0');
    return `${sinal}${absoluto.slice(0, -2)}.${absoluto.slice(-2)}`;
  });

  constructor() {
    this.lista.carregar();
    this.carregarContadores();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected rotulo(status: ReimbursementStatus): string {
    return ROTULO_REEMBOLSO[status] ?? status;
  }

  protected severidade(status: ReimbursementStatus) {
    return severidadeReembolso(status);
  }

  protected comprovantes(solicitacao: Reimbursement): string {
    const anexados = solicitacao.items.filter((item) => item.document).length;
    return `${anexados}/${solicitacao.items.length}`;
  }

  protected temTodosComprovantes(solicitacao: Reimbursement): boolean {
    return solicitacao.items.length > 0 && solicitacao.items.every((item) => item.document);
  }

  /** Só faz sentido anexar enquanto a solicitação ainda pode ser analisada. */
  protected aceitaAnexo(solicitacao: Reimbursement): boolean {
    return ['RASCUNHO', 'SOLICITADO', 'EM_ANALISE'].includes(solicitacao.status);
  }

  protected aceitaCancelamento(solicitacao: Reimbursement): boolean {
    return ['RASCUNHO', 'SOLICITADO', 'EM_ANALISE', 'APROVADO'].includes(solicitacao.status);
  }

  protected abrirDetalhe(solicitacao: Reimbursement): void {
    this.detalhe.set(solicitacao);
    this.erroDetalhe.set(null);
    this.valorAprovado.set('');
    this.motivo.set('');
    this.detalheAberto.set(true);
    this.recarregarDetalhe(solicitacao.id);
  }

  protected executar(acao: 'submit' | 'review' | 'approve' | 'reject' | 'cancel'): void {
    const solicitacao = this.detalhe();
    if (!solicitacao || this.agindo()) return;
    this.agindo.set(true);
    this.erroDetalhe.set(null);

    const valor = this.valorAprovado().trim();
    const requisicao = {
      submit: () => this.api.submit(solicitacao.id),
      review: () => this.api.startReview(solicitacao.id),
      approve: () =>
        this.api.approve(solicitacao.id, valor !== '' ? { approvedAmount: valor } : {}),
      reject: () => this.api.reject(solicitacao.id, this.motivo().trim()),
      cancel: () => this.api.cancel(solicitacao.id, this.motivo().trim() || undefined),
    }[acao]();

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (atualizada) => {
        this.agindo.set(false);
        this.detalhe.set(atualizada);
        this.aviso.set(`Reembolso ${atualizada.number}: ${this.rotulo(atualizada.status)}.`);
        this.lista.carregar();
        this.carregarContadores();
      },
      error: (falha: unknown) => {
        this.agindo.set(false);
        this.erroDetalhe.set(falha);
      },
    });
  }

  protected anexar(solicitacao: Reimbursement, item: ReimbursementItem, evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    const arquivo = entrada.files?.[0];
    if (!arquivo) return;
    this.erroDetalhe.set(null);

    this.api
      .attachReceipt(solicitacao.id, item.id, arquivo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          entrada.value = '';
          this.aviso.set('Comprovante anexado.');
          this.recarregarDetalhe(solicitacao.id);
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          entrada.value = '';
          this.erroDetalhe.set(falha);
        },
      });
  }

  protected baixarComprovante(solicitacao: Reimbursement, item: ReimbursementItem): void {
    this.api
      .downloadReceipt(solicitacao.id, item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (conteudo) => {
          const url = URL.createObjectURL(conteudo);
          const ancora = document.createElement('a');
          ancora.href = url;
          ancora.download = item.document?.fileName ?? 'comprovante';
          ancora.click();
          // A URL de objeto some junto com o clique: mantê-la viva seria deixar
          // o comprovante acessível pelo endereço do documento.
          URL.revokeObjectURL(url);
        },
        error: (falha: unknown) => this.erroDetalhe.set(falha),
      });
  }

  protected abrirNova(): void {
    this.form.set({ ...VAZIO, items: [{ ...ITEM_VAZIO }] });
    this.erroForm.set(null);
    this.novaAberta.set(true);
  }

  protected mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarItem<K extends keyof ItemFormulario>(
    indice: number,
    campo: K,
    valor: ItemFormulario[K],
  ): void {
    this.form.update((atual) => ({
      ...atual,
      items: atual.items.map((item, i) => (i === indice ? { ...item, [campo]: valor } : item)),
    }));
  }

  protected adicionarItem(): void {
    this.form.update((atual) => ({ ...atual, items: [...atual.items, { ...ITEM_VAZIO }] }));
  }

  protected removerItem(indice: number): void {
    this.form.update((atual) => ({
      ...atual,
      items: atual.items.filter((_, i) => i !== indice),
    }));
  }

  protected salvar(): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erroForm.set(null);

    const form = this.form();
    const corpo: ReimbursementInput = {
      employeeId: form.employeeId,
      description: form.description.trim(),
      ...(form.note.trim() !== '' ? { note: form.note.trim() } : {}),
      items: form.items.map((item): ReimbursementItemInput => ({
        description: item.description.trim(),
        expenseDate: item.expenseDate,
        amount: item.amount,
      })),
    };

    this.api
      .create(corpo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (criada) => {
          this.salvando.set(false);
          this.novaAberta.set(false);
          this.aviso.set(`Reembolso ${criada.number} criado como rascunho.`);
          this.lista.carregar();
          this.carregarContadores();
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erroForm.set(falha);
        },
      });
  }

  /** A listagem não traz os itens completos; o detalhe consulta o registro. */
  private recarregarDetalhe(id: string): void {
    this.api
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (solicitacao) => this.detalhe.set(solicitacao),
        error: (falha: unknown) => this.erroDetalhe.set(falha),
      });
  }

  private carregarContadores(): void {
    forkJoin(
      CONTADORES.map((contador) =>
        this.api
          .list({ status: contador.status, page: 1, pageSize: 1 })
          .pipe(map((resultado) => ({ rotulo: contador.rotulo, total: resultado.total }))),
      ),
    )
      .pipe(
        catchError(() => of([])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((linhas) => this.contadores.set(linhas));
  }
}
