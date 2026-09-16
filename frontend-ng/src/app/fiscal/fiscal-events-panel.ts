import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { FiscalApiService } from '../core/api/fiscal-api.service';
import type { FiscalEvent, FiscalEventType } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatDateTime } from '../core/lib/format';
import { ESTILO_TABELA } from '../conciliacao/rotulos';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  MINIMO_JUSTIFICATIVA,
  OPCOES_TIPO_EVENTO,
  ROTULO_STATUS_EVENTO,
  ROTULO_TIPO_EVENTO,
  exigeJustificativa,
  problemaEvento,
  severidadeEvento,
  transmissivel,
} from './tributos';

/**
 * Eventos fiscais do documento (RF-092/RF-094 — UI-063).
 *
 * O evento nasce REGISTRADO: registrar é declarar o que se pretende transmitir,
 * e é isso que fica como prova. Protocolo e situação vêm do fisco — a tela não
 * os digita, exceto na baixa manual de quem transmitiu por fora, onde o
 * protocolo é obrigatório porque resposta sem protocolo não é resposta.
 *
 * Situação só anda para frente: autorizado e rejeitado são terminais, e por
 * isso o botão de transmitir some quando o fisco já respondeu.
 */
@Component({
  selector: 'sge-fiscal-events-panel',
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    TagModule,
    Alert,
    ErrorAlert,
    SelectField,
    TextField,
  ],
  template: `
    <section class="card secao espaco">
      <div class="secao__cabecalho">
        <h2 class="secao__titulo">Eventos fiscais</h2>
        @if (podeRegistrar()) {
          <p-button
            label="Registrar evento"
            icon="pi pi-plus"
            size="small"
            severity="secondary"
            [outlined]="true"
            (onClick)="abrirRegistro()"
          />
        }
      </div>

      @if (aviso(); as texto) {
        <div class="bloco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
      }
      @if (erro(); as falha) {
        <div class="bloco"><sge-error-alert [erro]="falha" /></div>
      }

      <div class="tabela-rolagem">
        <table class="tabela">
          <thead>
            <tr>
              <th scope="col">Evento</th>
              <th scope="col">Situação</th>
              <th scope="col">Protocolo</th>
              <th scope="col">Ocorrido em</th>
              <th scope="col">Justificativa</th>
              @if (podeTransmitir()) {
                <th class="coluna-acoes" scope="col">Ações</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (evento of eventos(); track evento.id) {
              <tr>
                <td>{{ rotuloTipo(evento) }} #{{ evento.sequence }}</td>
                <td>
                  <p-tag
                    [value]="rotuloStatus(evento)"
                    [severity]="severidade(evento)"
                    [rounded]="true"
                  />
                </td>
                <td class="codigo">{{ evento.protocol ?? '—' }}</td>
                <td>{{ dataHora(evento.occurredAt) }}</td>
                <td>{{ evento.justification ?? '—' }}</td>
                @if (podeTransmitir()) {
                  <td class="coluna-acoes">
                    @if (podeSeguir(evento)) {
                      <p-button
                        label="Transmitir"
                        size="small"
                        [text]="true"
                        [disabled]="!!agindo()"
                        [loading]="agindo() === evento.id"
                        (onClick)="transmitir(evento)"
                      />
                      <p-button
                        label="Lançar retorno"
                        size="small"
                        severity="secondary"
                        [text]="true"
                        [disabled]="!!agindo()"
                        (onClick)="abrirBaixa(evento)"
                      />
                    }
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="vazio">
                  @if (carregando()) {
                    Carregando…
                  } @else {
                    Nenhum evento fiscal registrado para este documento.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <p-dialog
      [visible]="registrando()"
      (visibleChange)="registrando.set($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      header="Registrar evento fiscal"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <div class="grade-campos">
        <sge-select-field
          rotulo="Tipo do evento"
          [obrigatorio]="true"
          [opcoes]="opcoesTipo"
          [ngModel]="form().type"
          (ngModelChange)="mudarTipo($event ?? 'CANCELAMENTO')"
        />
      </div>

      @if (justificativaObrigatoria()) {
        <sge-text-field
          rotulo="Justificativa"
          [obrigatorio]="true"
          [dica]="'Pelo menos ' + minimoJustificativa + ' caracteres — é o mínimo do layout da SEFAZ.'"
          [ngModel]="form().justification"
          (ngModelChange)="mudarJustificativa($event ?? '')"
        />
      }

      <p class="secundario">
        O evento nasce registrado. Protocolo e situação vêm do fisco — não são digitados aqui.
      </p>

      @if (problema(); as texto) {
        <p class="campo__erro">{{ texto }}</p>
      }

      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          [disabled]="salvando()"
          (onClick)="registrando.set(false)"
        />
        <p-button
          label="Registrar"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando() || !!problema()"
          (onClick)="registrar()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="!!baixando()"
      (visibleChange)="fecharBaixa($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      header="Lançar o retorno do fisco"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <p class="secundario">
        Para quem transmitiu por fora — pelo emissor da contabilidade, por exemplo. A situação
        lançada aqui é terminal: não há retentativa depois dela.
      </p>

      <div class="grade-campos">
        <sge-select-field
          rotulo="Situação"
          [obrigatorio]="true"
          [opcoes]="opcoesRetorno"
          [ngModel]="retorno().status"
          (ngModelChange)="mudarRetorno('status', $event ?? 'AUTORIZADO')"
        />
        <sge-text-field
          rotulo="Protocolo"
          [obrigatorio]="true"
          [ngModel]="retorno().protocol"
          (ngModelChange)="mudarRetorno('protocol', $event ?? '')"
        />
        <sge-text-field
          rotulo="Mensagem do fisco"
          [ngModel]="retorno().message"
          (ngModelChange)="mudarRetorno('message', $event ?? '')"
        />
      </div>

      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          [disabled]="salvando()"
          (onClick)="fecharBaixa(false)"
        />
        <p-button
          label="Lançar"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando() || !retorno().protocol.trim()"
          (onClick)="lancarRetorno()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    ESTILO_TABELA,
    `
      .secao__cabecalho {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }
      .bloco {
        margin: 0.75rem 0;
      }
      .codigo {
        font-variant-numeric: tabular-nums;
      }
      .coluna-acoes {
        white-space: nowrap;
        text-align: right;
      }
    `,
  ],
})
export class FiscalEventsPanel {
  readonly documentoId = input.required<string>();

  private readonly api = inject(FiscalApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly opcoesTipo = OPCOES_TIPO_EVENTO;
  protected readonly opcoesRetorno = [
    { value: 'AUTORIZADO', label: 'Autorizado' },
    { value: 'REJEITADO', label: 'Rejeitado' },
  ];
  protected readonly minimoJustificativa = MINIMO_JUSTIFICATIVA;
  protected readonly dataHora = formatDateTime;

  protected readonly eventos = signal<FiscalEvent[]>([]);
  protected readonly carregando = signal(false);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly agindo = signal<string | null>(null);

  protected readonly registrando = signal(false);
  protected readonly salvando = signal(false);
  protected readonly erroDialogo = signal<unknown>(null);
  protected readonly form = signal<{ type: FiscalEventType; justification: string }>({
    type: 'CANCELAMENTO',
    justification: '',
  });

  protected readonly baixando = signal<FiscalEvent | null>(null);
  protected readonly retorno = signal<{
    status: 'AUTORIZADO' | 'REJEITADO';
    protocol: string;
    message: string;
  }>({ status: 'AUTORIZADO', protocol: '', message: '' });

  protected readonly justificativaObrigatoria = computed(() => exigeJustificativa(this.form().type));
  protected readonly problema = computed(() => problemaEvento(this.form(), true));

  protected readonly podeRegistrar = () => this.permissoes.pode('fiscal-events:CREATE');
  protected readonly podeTransmitir = () => this.permissoes.pode('fiscal-events:APPROVE');

  constructor() {
    effect(() => {
      const id = this.documentoId();
      if (id) untracked(() => this.carregar(id));
    });
  }

  protected rotuloTipo(evento: FiscalEvent): string {
    return ROTULO_TIPO_EVENTO[evento.type];
  }

  protected rotuloStatus(evento: FiscalEvent): string {
    return ROTULO_STATUS_EVENTO[evento.status];
  }

  protected severidade(evento: FiscalEvent) {
    return severidadeEvento(evento.status);
  }

  protected podeSeguir(evento: FiscalEvent): boolean {
    return transmissivel(evento.status);
  }

  protected abrirRegistro(): void {
    this.form.set({ type: 'CANCELAMENTO', justification: '' });
    this.erroDialogo.set(null);
    this.registrando.set(true);
  }

  protected mudarTipo(tipo: FiscalEventType): void {
    this.form.update((atual) => ({ ...atual, type: tipo }));
  }

  protected mudarJustificativa(texto: string): void {
    this.form.update((atual) => ({ ...atual, justification: texto }));
  }

  protected registrar(): void {
    if (this.salvando() || this.problema()) return;
    const form = this.form();

    this.salvando.set(true);
    this.erroDialogo.set(null);
    this.api
      .createEvent({
        type: form.type,
        documentId: this.documentoId(),
        ...(form.justification.trim() ? { justification: form.justification.trim() } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.registrando.set(false);
          this.aviso.set('Evento registrado. Transmita quando quiser enviá-lo ao fisco.');
          this.carregar(this.documentoId());
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erroDialogo.set(falha);
        },
      });
  }

  protected transmitir(evento: FiscalEvent): void {
    if (this.agindo()) return;
    this.agindo.set(evento.id);
    this.erro.set(null);
    this.api
      .transmitEvent(evento.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.agindo.set(null);
          this.aviso.set('Transmissão enfileirada. A resposta do fisco aparece aqui.');
          this.carregar(this.documentoId());
        },
        error: (falha: unknown) => {
          this.agindo.set(null);
          this.erro.set(falha);
        },
      });
  }

  protected abrirBaixa(evento: FiscalEvent): void {
    this.retorno.set({ status: 'AUTORIZADO', protocol: '', message: '' });
    this.erroDialogo.set(null);
    this.baixando.set(evento);
  }

  protected fecharBaixa(aberto: boolean): void {
    if (!aberto) this.baixando.set(null);
  }

  protected mudarRetorno(campo: 'status' | 'protocol' | 'message', valor: string): void {
    this.retorno.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected lancarRetorno(): void {
    const evento = this.baixando();
    const retorno = this.retorno();
    if (!evento || this.salvando() || !retorno.protocol.trim()) return;

    this.salvando.set(true);
    this.erroDialogo.set(null);
    this.api
      .settleEvent(evento.id, {
        status: retorno.status,
        protocol: retorno.protocol.trim(),
        ...(retorno.message.trim() ? { message: retorno.message.trim() } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.baixando.set(null);
          this.aviso.set('Retorno do fisco registrado.');
          this.carregar(this.documentoId());
        },
        error: (falha: unknown) => {
          this.salvando.set(false);
          this.erroDialogo.set(falha);
        },
      });
  }

  private carregar(documentoId: string): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.api
      .listEvents({ documentId: documentoId, pageSize: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pagina) => {
          this.eventos.set(pagina.data);
          this.carregando.set(false);
        },
        error: (falha: unknown) => {
          this.eventos.set([]);
          this.erro.set(falha);
          this.carregando.set(false);
        },
      });
  }
}
