import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import type { Observable } from 'rxjs';

import { BankingApiService } from '../core/api/banking-api.service';
import type { ConfirmPaymentInput, PaymentTransaction } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { CompanyService } from '../core/company/company.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatCnpj, formatDate, formatDateTime } from '../core/lib/format';
import { ROTULO_METODO } from '../financeiro/rotulos';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { TextField } from '../ui/text-field';
import {
  ROTULO_SENTIDO,
  ROTULO_STATUS_ORDEM,
  aceitaCancelamento,
  aceitaConfirmacao,
  aceitaConsulta,
  emRetentativa,
  favorecido,
  ordemTerminal,
  severidadeOrdem,
} from './rotulos';

export interface Etapa {
  rotulo: string;
  quando: string | null;
  estado: 'feita' | 'pendente' | 'falha';
}

/** Linha do tempo da ordem, com os instantes que o backend registra. */
export function etapasOrdem(ordem: PaymentTransaction): Etapa[] {
  const etapas: Etapa[] = [{ rotulo: 'Criada', quando: ordem.createdAt, estado: 'feita' }];
  if (ordem.scheduledFor) {
    etapas.push({
      rotulo: `Agendada para ${formatDate(ordem.scheduledFor)}`,
      quando: null,
      estado: ordem.executedAt || ordemTerminal(ordem) ? 'feita' : 'pendente',
    });
  }
  etapas.push({
    rotulo: 'Enviada ao banco',
    quando: ordem.executedAt,
    estado: ordem.executedAt ? 'feita' : 'pendente',
  });
  switch (ordem.status) {
    case 'CONFIRMADA':
      etapas.push({ rotulo: 'Confirmada', quando: ordem.confirmedAt, estado: 'feita' });
      break;
    case 'CANCELADA':
      etapas.push({ rotulo: 'Cancelada', quando: ordem.cancelledAt, estado: 'falha' });
      break;
    case 'FALHA':
      etapas.push({ rotulo: 'Falhou', quando: ordem.updatedAt, estado: 'falha' });
      break;
    case 'ESTORNADA':
    case 'EXPIRADA':
      etapas.push({ rotulo: ROTULO_STATUS_ORDEM[ordem.status], quando: ordem.updatedAt, estado: 'falha' });
      break;
    default:
      etapas.push({ rotulo: 'Confirmação do banco', quando: null, estado: 'pendente' });
  }
  return etapas;
}

interface FormConfirmacao {
  externalId: string;
  /** `datetime-local` do navegador; vazio = agora. */
  confirmedAt: string;
  note: string;
}

/**
 * Detalhe da ordem: situação, identificador externo e comprovante (RF-068 —
 * UI-045), com as ações de consulta, cancelamento e confirmação (RF-064/RF-065
 * — UI-044).
 *
 * Cada ação devolve a ordem inteira do servidor, e é ela que a tela passa a
 * mostrar: nenhuma situação é deduzida aqui. Os botões seguem as regras do
 * backend, que decide de novo a cada requisição.
 */
@Component({
  selector: 'sge-payment-detail-page',
  imports: [FormsModule, RouterLink, ButtonModule, DialogModule, TagModule, Alert, ErrorAlert, TextField],
  template: `
    <p class="crumb">Bancos / Ordens / {{ titulo() }}</p>

    <div class="pagehead">
      <div>
        <h1>{{ titulo() }}</h1>
        <p>{{ subtitulo() }}</p>
      </div>
      <div class="pagehead__actions">
        <p-button label="Voltar" severity="secondary" [outlined]="true" routerLink="/bancos/ordens" />
        <p-button
          label="Recarregar"
          icon="pi pi-refresh"
          severity="secondary"
          [outlined]="true"
          [disabled]="agindo()"
          (onClick)="carregar()"
        />
        @if (podeConsultar()) {
          <p-button
            label="Consultar no banco"
            icon="pi pi-sync"
            severity="secondary"
            [loading]="agindo()"
            [disabled]="agindo()"
            (onClick)="consultar()"
          />
        }
        @if (podeConfirmar()) {
          <p-button
            label="Confirmar manualmente"
            severity="secondary"
            [disabled]="agindo()"
            (onClick)="abrirConfirmacao()"
          />
        }
        @if (podeCancelar()) {
          <p-button
            label="Cancelar ordem"
            icon="pi pi-times"
            severity="danger"
            [outlined]="true"
            [disabled]="agindo()"
            (onClick)="abrirCancelamento()"
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

    @if (ordem(); as registro) {
      @if (registro.status === 'FALHA') {
        <div class="espaco">
          <sge-alert
            tom="erro"
            titulo="O banco recusou a ordem"
            [mensagem]="(registro.errorCode ? registro.errorCode + ': ' : '') + (registro.errorMessage ?? 'Sem detalhe do provedor.')"
          />
        </div>
      } @else if (retentando()) {
        <div class="espaco">
          <sge-alert
            tom="aviso"
            [titulo]="'Envio em nova tentativa (' + registro.attempts + ' de ' + registro.maxAttempts + ')'"
            [mensagem]="registro.errorMessage ?? 'A última tentativa falhou; a fila tenta de novo com intervalo crescente (RF-070).'"
          />
        </div>
      }
      @if (registro.status === 'CANCELADA' && registro.cancellationReason) {
        <div class="espaco">
          <sge-alert tom="aviso" titulo="Ordem cancelada" [mensagem]="registro.cancellationReason" />
        </div>
      }

      <div class="kpis">
        <div class="kpi">
          <p class="kpi__label">Valor</p>
          <p class="kpi__value">{{ moeda(registro.amount) }}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Situação</p>
          <p class="kpi__value kpi__value--texto">
            <p-tag
              [value]="rotuloStatus()"
              [severity]="severidadeStatus()"
              [rounded]="true"
            />
          </p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Tentativas de envio</p>
          <p class="kpi__value">{{ registro.attempts }} / {{ registro.maxAttempts }}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Cancelamento após envio</p>
          <p class="kpi__value kpi__value--texto">
            {{ registro.cancellable ? 'Suportado' : 'Não suportado' }}
          </p>
        </div>
      </div>

      <section class="card secao espaco">
        <h2 class="secao__titulo">Acompanhamento</h2>
        <ol class="etapas">
          @for (etapa of etapas(); track etapa.rotulo) {
            <li [class]="'etapa etapa--' + etapa.estado">
              <span class="etapa__rotulo">{{ etapa.rotulo }}</span>
              <span class="secundario">{{ etapa.quando ? dataHora(etapa.quando) : etapa.estado === 'pendente' ? 'Aguardando' : '' }}</span>
            </li>
          }
        </ol>
      </section>

      <section class="card secao espaco">
        <h2 class="secao__titulo">Ordem</h2>
        <dl class="dados">
          <div>
            <dt>Modalidade</dt>
            <dd>{{ metodo() }} · {{ sentido() }}</dd>
          </div>
          <div>
            <dt>Conta</dt>
            <dd>{{ registro.bankAccount?.description ?? '—' }}</dd>
          </div>
          <div>
            <dt>Agendamento</dt>
            <dd>{{ registro.scheduledFor ? data(registro.scheduledFor) : 'Execução imediata' }}</dd>
          </div>
          <div>
            <dt>Descrição</dt>
            <dd>{{ registro.description ?? '—' }}</dd>
          </div>
          <div>
            <dt>Identificador no banco</dt>
            <dd class="codigo">{{ registro.externalId ?? 'Ainda não informado pelo provedor' }}</dd>
          </div>
          <div>
            <dt>End-to-end (PIX)</dt>
            <dd class="codigo">{{ registro.endToEndId ?? '—' }}</dd>
          </div>
          <div>
            <dt>Chave de idempotência</dt>
            <dd class="codigo">{{ registro.idempotencyKey }}</dd>
          </div>
          @if (registro.installmentId) {
            <div>
              <dt>Parcela liquidada</dt>
              <dd>A baixa do título é gerada na confirmação</dd>
            </div>
          }
        </dl>
      </section>

      <section class="card secao espaco">
        <h2 class="secao__titulo">{{ registro.direction === 'CREDITO' ? 'Pagador' : 'Favorecido' }}</h2>
        <dl class="dados">
          <div>
            <dt>Nome</dt>
            <dd>{{ registro.payeeName ?? '—' }}</dd>
          </div>
          <div>
            <dt>CPF/CNPJ</dt>
            <dd>{{ documento(registro.payeeDocument) }}</dd>
          </div>
          @if (registro.pixKey) {
            <div>
              <dt>Chave PIX</dt>
              <dd>{{ registro.pixKey }}</dd>
            </div>
          }
          @if (registro.barcode) {
            <div class="dados__largo">
              <dt>Código de barras</dt>
              <dd class="codigo">{{ registro.barcode }}</dd>
            </div>
          }
          @if (registro.payeeAccount) {
            <div>
              <dt>Banco / agência / conta</dt>
              <dd>
                {{ registro.payeeBankCode ?? '—' }} / {{ registro.payeeAgency ?? '—' }} /
                {{ registro.payeeAccount }}
              </dd>
            </div>
          }
        </dl>
      </section>

      @if (registro.settlements?.length) {
        <section class="card secao espaco">
          <h2 class="secao__titulo">Baixas geradas</h2>
          <ul class="baixas">
            @for (baixa of registro.settlements; track baixa.id) {
              <li>{{ data(baixa.settlementDate) }} · {{ moeda(baixa.totalAmount) }}</li>
            }
          </ul>
        </section>
      }

      @if (registro.status === 'CONFIRMADA') {
        <section class="card secao espaco comprovante">
          <div class="comprovante__topo">
            <h2 class="secao__titulo">
              Comprovante de {{ registro.direction === 'CREDITO' ? 'recebimento' : 'pagamento' }}
            </h2>
            <p-button
              label="Imprimir comprovante"
              icon="pi pi-print"
              severity="secondary"
              [outlined]="true"
              size="small"
              (onClick)="imprimir()"
            />
          </div>
          <dl class="dados">
            <div>
              <dt>Empresa</dt>
              <dd>{{ empresa() }}</dd>
            </div>
            <div>
              <dt>Valor</dt>
              <dd>{{ moeda(registro.amount) }}</dd>
            </div>
            <div>
              <dt>Confirmado em</dt>
              <dd>{{ registro.confirmedAt ? dataHora(registro.confirmedAt) : '—' }}</dd>
            </div>
            <div>
              <dt>Modalidade</dt>
              <dd>{{ metodo() }}</dd>
            </div>
            <div>
              <dt>Conta</dt>
              <dd>{{ registro.bankAccount?.description ?? '—' }}</dd>
            </div>
            <div>
              <dt>{{ registro.direction === 'CREDITO' ? 'Pagador' : 'Favorecido' }}</dt>
              <dd>{{ nomeFavorecido() }} {{ registro.payeeDocument ? '· ' + documento(registro.payeeDocument) : '' }}</dd>
            </div>
            <div>
              <dt>Identificador no banco</dt>
              <dd class="codigo">{{ registro.externalId ?? '—' }}</dd>
            </div>
            <div>
              <dt>End-to-end</dt>
              <dd class="codigo">{{ registro.endToEndId ?? '—' }}</dd>
            </div>
            <div>
              <dt>Ordem no SGE</dt>
              <dd class="codigo">{{ registro.id }}</dd>
            </div>
          </dl>
          <p class="nota">
            Emitido pelo SGE com os dados devolvidos pelo provedor. O comprovante oficial é o do
            banco, localizável pelo identificador acima.
          </p>
        </section>
      }
    }

    <p-dialog
      [visible]="cancelando()"
      (visibleChange)="cancelando.set($event)"
      [modal]="true"
      [style]="{ width: '30rem' }"
      header="Cancelar ordem"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <p class="secundario">
        O motivo vai para a trilha de auditoria e, se a ordem já saiu, para o provedor.
      </p>
      <sge-text-field
        rotulo="Motivo"
        [obrigatorio]="true"
        dica="Mínimo de 5 caracteres"
        [ngModel]="motivo()"
        (ngModelChange)="motivo.set($event)"
      />
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          [disabled]="agindo()"
          (onClick)="cancelando.set(false)"
        />
        <p-button
          label="Cancelar ordem"
          severity="danger"
          [loading]="agindo()"
          [disabled]="agindo() || motivo().trim().length < 5"
          (onClick)="cancelar()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="confirmandoManual()"
      (visibleChange)="confirmandoManual.set($event)"
      [modal]="true"
      [style]="{ width: '34rem' }"
      header="Confirmar pagamento manualmente"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <sge-alert
        tom="aviso"
        titulo="Esta confirmação gera a baixa do título"
        mensagem="Use apenas quando o banco já confirmou a operação por outro canal."
      />
      <div class="grade-campos formulario">
        <sge-text-field
          rotulo="Identificador no banco"
          [ngModel]="formConfirmacao().externalId"
          (ngModelChange)="mudarConfirmacao('externalId', $event)"
        />
        <sge-text-field
          rotulo="Confirmado em"
          tipo="datetime-local"
          dica="Vazio: agora"
          [ngModel]="formConfirmacao().confirmedAt"
          (ngModelChange)="mudarConfirmacao('confirmedAt', $event ?? '')"
        />
        <sge-text-field
          rotulo="Observação"
          [ngModel]="formConfirmacao().note"
          (ngModelChange)="mudarConfirmacao('note', $event)"
        />
      </div>
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          [disabled]="agindo()"
          (onClick)="confirmandoManual.set(false)"
        />
        <p-button
          label="Confirmar"
          icon="pi pi-check"
          [loading]="agindo()"
          [disabled]="agindo()"
          (onClick)="confirmar()"
        />
      </ng-template>
    </p-dialog>
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
      overflow-wrap: anywhere;
    }
    .dados__largo {
      grid-column: 1 / -1;
    }
    .codigo {
      font-family: var(--p-font-family-mono, monospace);
      font-size: 0.8rem;
    }
    .kpi__value--texto {
      font-size: 0.95rem;
    }
    .etapas {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1.5rem;
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: 0.85rem;
    }
    .etapa {
      padding-left: 0.75rem;
      border-left: 3px solid var(--p-content-border-color);
    }
    .etapa--feita {
      border-left-color: var(--p-green-500, var(--p-primary-color));
    }
    .etapa--falha {
      border-left-color: var(--p-red-500, var(--p-text-color));
    }
    .etapa--pendente .etapa__rotulo {
      color: var(--p-text-muted-color);
    }
    .baixas {
      margin: 0;
      padding-left: 1.1rem;
      font-size: 0.85rem;
    }
    .comprovante__topo {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .formulario {
      padding-top: 0.75rem;
    }
    @media print {
      .comprovante__topo p-button {
        display: none;
      }
    }
  `,
})
export class PaymentDetailPage {
  private readonly api = inject(BankingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly empresas = inject(CompanyService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly paymentId = this.rota.snapshot.paramMap.get('id') ?? '';

  protected readonly ordem = signal<PaymentTransaction | null>(null);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly agindo = signal(false);
  protected readonly erroDialogo = signal<unknown>(null);
  protected readonly cancelando = signal(false);
  protected readonly motivo = signal('');
  protected readonly confirmandoManual = signal(false);
  protected readonly formConfirmacao = signal<FormConfirmacao>({
    externalId: '',
    confirmedAt: '',
    note: '',
  });

  protected readonly titulo = computed(() => {
    const registro = this.ordem();
    return registro ? `${ROTULO_METODO[registro.method]} de ${formatCurrency(registro.amount)}` : 'Ordem';
  });

  protected readonly subtitulo = computed(() => {
    const registro = this.ordem();
    if (!registro) return 'Situação, identificador externo e comprovante (RF-068).';
    return `${ROTULO_SENTIDO[registro.direction]} para ${favorecido(registro)} · criada em ${formatDateTime(registro.createdAt)}.`;
  });

  protected readonly etapas = computed(() => {
    const registro = this.ordem();
    return registro ? etapasOrdem(registro) : [];
  });

  protected readonly rotuloStatus = computed(() => {
    const registro = this.ordem();
    return registro ? ROTULO_STATUS_ORDEM[registro.status] : '';
  });

  protected readonly severidadeStatus = computed(() => {
    const registro = this.ordem();
    return registro ? severidadeOrdem(registro.status) : 'secondary';
  });

  protected readonly metodo = computed(() => {
    const registro = this.ordem();
    return registro ? ROTULO_METODO[registro.method] : '';
  });

  protected readonly sentido = computed(() => {
    const registro = this.ordem();
    return registro ? ROTULO_SENTIDO[registro.direction] : '';
  });

  protected readonly nomeFavorecido = computed(() => {
    const registro = this.ordem();
    return registro ? favorecido(registro) : '—';
  });

  protected readonly retentando = computed(() => {
    const registro = this.ordem();
    return !!registro && emRetentativa(registro);
  });

  protected readonly empresa = computed(() => {
    const ativa = this.empresas.ativa()?.company;
    return ativa ? `${ativa.legalName} · ${formatCnpj(ativa.taxId)}` : '—';
  });

  protected readonly podeConsultar = computed(() => {
    const registro = this.ordem();
    return !!registro && aceitaConsulta(registro) && this.permissoes.pode('payments:UPDATE');
  });

  protected readonly podeCancelar = computed(() => {
    const registro = this.ordem();
    return !!registro && aceitaCancelamento(registro) && this.permissoes.pode('payments:DELETE');
  });

  protected readonly podeConfirmar = computed(() => {
    const registro = this.ordem();
    return !!registro && aceitaConfirmacao(registro) && this.permissoes.pode('payments:APPROVE');
  });

  constructor() {
    this.carregar();
  }

  protected carregar(): void {
    this.erro.set(null);
    this.api
      .getPayment(this.paymentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registro) => this.ordem.set(registro),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  protected consultar(): void {
    this.agir(this.api.syncPayment(this.paymentId), 'Situação atualizada com o retorno do banco.');
  }

  protected abrirCancelamento(): void {
    this.motivo.set('');
    this.erroDialogo.set(null);
    this.cancelando.set(true);
  }

  protected cancelar(): void {
    const motivo = this.motivo().trim();
    if (motivo.length < 5) return;
    this.agir(this.api.cancelPayment(this.paymentId, motivo), 'Ordem cancelada.', () =>
      this.cancelando.set(false),
    );
  }

  protected abrirConfirmacao(): void {
    this.formConfirmacao.set({ externalId: this.ordem()?.externalId ?? '', confirmedAt: '', note: '' });
    this.erroDialogo.set(null);
    this.confirmandoManual.set(true);
  }

  protected mudarConfirmacao<K extends keyof FormConfirmacao>(campo: K, valor: FormConfirmacao[K]): void {
    this.formConfirmacao.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected confirmar(): void {
    const form = this.formConfirmacao();
    const dto: ConfirmPaymentInput = {};
    if (form.externalId.trim()) dto.externalId = form.externalId.trim();
    if (form.note.trim()) dto.note = form.note.trim();
    if (form.confirmedAt) {
      const instante = new Date(form.confirmedAt);
      if (!Number.isNaN(instante.getTime())) dto.confirmedAt = instante.toISOString();
    }
    this.agir(this.api.confirmPayment(this.paymentId, dto), 'Confirmação registrada.', () =>
      this.confirmandoManual.set(false),
    );
  }

  /** Só o bloco do comprovante sai no papel (regra em `styles.scss`). */
  protected imprimir(): void {
    const corpo = document.body;
    const limpar = () => corpo.classList.remove('imprimindo-comprovante');
    corpo.classList.add('imprimindo-comprovante');
    window.addEventListener('afterprint', limpar, { once: true });
    window.print();
    limpar();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }

  protected documento(valor: string | null): string {
    if (!valor) return '—';
    if (valor.length === 14) return formatCnpj(valor);
    if (valor.length === 11) return valor.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return valor;
  }

  private agir(requisicao: Observable<PaymentTransaction>, sucesso: string, fechar?: () => void): void {
    if (this.agindo()) return;
    this.agindo.set(true);
    this.aviso.set(null);
    this.erro.set(null);
    this.erroDialogo.set(null);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (registro) => {
        this.agindo.set(false);
        this.ordem.set(registro);
        fechar?.();
        this.aviso.set(sucesso);
      },
      error: (falha: unknown) => {
        this.agindo.set(false);
        if (fechar) this.erroDialogo.set(falha);
        else this.erro.set(falha);
      },
    });
  }
}
