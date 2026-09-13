import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { BankingApiService } from '../core/api/banking-api.service';
import { ReconciliationApiService } from '../core/api/reconciliation-api.service';
import type {
  MatchCandidate,
  PaymentTransaction,
  ReconciliationInput,
  ReconciliationListItem,
  ReconciliationSuggestions,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate, formatDateTime } from '../core/lib/format';
import { ROTULO_CONCILIACAO, severidadeConciliacao } from '../bancos/rotulos';
import { ROTULO_METODO } from '../financeiro/rotulos';
import { adicionarDias, paraCentavos, subtrair } from '../financeiro/dinheiro';
import { Alert } from '../ui/alert';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { TextField } from '../ui/text-field';
import {
  ESTILO_TABELA,
  ROTULO_NATUREZA,
  ROTULO_ORIGEM,
  aceitaVinculo,
  alvoVinculo,
  problemaMotivo,
  problemaVinculo,
  restanteMovimento,
  rotuloDistancia,
  rotuloScore,
  rotuloSentido,
  severidadeScore,
  valorComSinal,
  valorProposto,
} from './rotulos';

/** O que o usuário escolheu vincular ao movimento. */
export interface AlvoVinculo {
  tipo: 'PARCELA' | 'ORDEM';
  id: string;
  rotulo: string;
  /** Saldo da parcela ou valor da ordem: base da diferença (RF-076). */
  esperado: string;
}

/**
 * Sugestões de correspondência e conciliação manual (RF-073/RF-074 — UI-049 e
 * UI-050).
 *
 * As candidatas vêm do servidor já ordenadas pelo score, com os motivos que o
 * compuseram — a tela não repontua nada. A tolerância de dias e valor só muda
 * a busca; quem decide o que é aceitável numa regra é o cadastro de regras.
 *
 * Vincular não baixa título nem mexe em saldo: afirma que a linha do extrato
 * corresponde a um lançamento que já existe. Valor diferente do lançamento
 * exige justificativa, e desfazer exige motivo — os dois vão para a auditoria.
 */
@Component({
  selector: 'sge-matching-page',
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
    <p class="crumb">
      <a routerLink="/conciliacao/movimentos">Conciliação / Movimentos</a> / Conciliar
    </p>

    <div class="pagehead">
      <div>
        <h1>{{ titulo() }}</h1>
        <p>{{ descricao || 'Candidatas com score, critério aplicado e vínculos do movimento (RF-073/RF-074).' }}</p>
      </div>
      <div class="pagehead__actions">
        @if (podeIgnorar()) {
          <p-button
            label="Marcar como sem par"
            icon="pi pi-eye-slash"
            severity="secondary"
            [outlined]="true"
            (onClick)="abrirIgnorar()"
          />
        }
        @if (podeReabrir()) {
          <p-button
            label="Reabrir para conciliação"
            icon="pi pi-replay"
            severity="secondary"
            [outlined]="true"
            [loading]="agindo()"
            (onClick)="reabrir()"
          />
        }
      </div>
    </div>

    @if (erro(); as falha) {
      <sge-error-alert [erro]="falha" />
    }
    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    @if (sugestoes(); as mov) {
      <div class="kpis espaco">
        <div class="kpi">
          <span class="kpi__label">Movimento</span>
          <span class="kpi__value" [class.saida]="mov.direction === 'DEBITO'">{{ valorSinal(mov) }}</span>
          <span class="kpi__detail">{{ sentido(mov.direction) }} em {{ data(mov.movementDate) }}</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Já conciliado</span>
          <span class="kpi__value">{{ moeda(conciliado()) }}</span>
          <span class="kpi__detail">{{ vivos().length }} vínculo(s) vigente(s)</span>
        </div>
        <div class="kpi">
          <span class="kpi__label">A conciliar</span>
          <span class="kpi__value">{{ moeda(restante()) }}</span>
          <span class="kpi__detail">
            <p-tag
              [value]="rotuloStatus(mov.reconciliationStatus)"
              [severity]="severidadeStatus(mov.reconciliationStatus)"
              [rounded]="true"
            />
          </span>
        </div>
        <div class="kpi">
          <span class="kpi__label">Identificação</span>
          <span class="kpi__value kpi__value--texto">{{ natureza(mov) }}</span>
          <span class="kpi__detail">
            {{ mov.identification.partnerName ?? mov.identification.counterpartName ?? 'Contraparte não reconhecida' }}
          </span>
        </div>
      </div>

      <section class="card secao espaco">
        <h2 class="secao__titulo">Sugestões de correspondência</h2>
        <div class="tolerancias">
          <sge-text-field
            rotulo="Tolerância de dias"
            tipo="number"
            dica="Janela em torno do vencimento (0 a 60)"
            [ngModel]="dias()"
            (ngModelChange)="dias.set($event ?? '')"
          />
          <sge-decimal-field
            rotulo="Tolerância de valor"
            dica="Diferença aceita na busca"
            [ngModel]="toleranciaValor()"
            (ngModelChange)="toleranciaValor.set($event)"
          />
          <p-button
            label="Buscar novamente"
            icon="pi pi-search"
            severity="secondary"
            [loading]="buscando()"
            (onClick)="buscar()"
          />
        </div>
        @if (problemaBusca(); as texto) {
          <div class="espaco"><sge-alert tom="aviso" [titulo]="texto" /></div>
        }

        <div class="tabela-rolagem espaco">
          <table class="tabela">
            <thead>
              <tr>
                <th>Confiança</th>
                <th>Título / parcela</th>
                <th>Vencimento</th>
                <th class="numero">Saldo</th>
                <th class="numero">Diferença</th>
                <th>Critérios aplicados</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (candidata of mov.candidates; track candidata.installmentId) {
                <tr>
                  <td>
                    <p-tag
                      [value]="score(candidata.score)"
                      [severity]="severidadeDoScore(candidata.score)"
                      [rounded]="true"
                    />
                  </td>
                  <td>
                    {{ candidata.entryNumber }} · {{ candidata.installmentNumber }}/{{ candidata.totalInstallments }}
                    <span class="secundario">{{ candidata.partnerName ?? candidata.description }}</span>
                  </td>
                  <td>
                    {{ data(candidata.dueDate) }}
                    <span class="secundario">{{ distancia(candidata.dayGap) }}</span>
                  </td>
                  <td class="numero">{{ moeda(candidata.balance) }}</td>
                  <td class="numero">{{ moeda(candidata.difference) }}</td>
                  <td>
                    <ul class="motivos">
                      @for (motivo of candidata.reasons; track motivo) {
                        <li>{{ motivo }}</li>
                      } @empty {
                        <li class="secundario">Nenhum critério pontuou</li>
                      }
                    </ul>
                  </td>
                  <td class="acoes">
                    @if (podeVincular()) {
                      <p-button label="Vincular" size="small" (onClick)="escolherParcela(candidata)" />
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" class="vazio">
                    Nenhuma parcela em aberto corresponde a este movimento dentro das tolerâncias.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      @if (podeVerOrdens()) {
        <section class="card secao espaco">
          <h2 class="secao__titulo">Ordens de pagamento confirmadas no período</h2>
          <div class="tabela-rolagem">
            <table class="tabela">
              <thead>
                <tr>
                  <th>Confirmada em</th>
                  <th>Modalidade</th>
                  <th>Favorecido / descrição</th>
                  <th class="numero">Valor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (item of ordens(); track item.id) {
                  <tr>
                    <td>{{ dataHora(item.confirmedAt ?? item.createdAt) }}</td>
                    <td>{{ metodo(item) }}</td>
                    <td>
                      {{ item.payeeName ?? '—' }}
                      <span class="secundario">{{ item.description ?? '' }}</span>
                    </td>
                    <td class="numero">{{ moeda(item.amount) }}</td>
                    <td class="acoes">
                      @if (podeVincular()) {
                        <p-button
                          label="Vincular"
                          size="small"
                          severity="secondary"
                          (onClick)="escolherOrdem(item)"
                        />
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="vazio">Nenhuma ordem confirmada no mesmo sentido e período.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <section class="card secao espaco">
        <h2 class="secao__titulo">Vínculos do movimento</h2>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead>
              <tr>
                <th>Criado em</th>
                <th>Alvo</th>
                <th>Origem</th>
                <th class="numero">Conciliado</th>
                <th class="numero">Diferença</th>
                <th>Justificativa / desfazimento</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (vinculo of vinculos(); track vinculo.id) {
                <tr [class.desfeito]="!!vinculo.undoneAt">
                  <td>{{ dataHora(vinculo.createdAt) }}</td>
                  <td>{{ alvo(vinculo) }}</td>
                  <td>{{ origem(vinculo) }}</td>
                  <td class="numero">{{ moeda(vinculo.reconciledAmount) }}</td>
                  <td class="numero">{{ vinculo.hasDivergence ? moeda(vinculo.difference) : '—' }}</td>
                  <td>
                    {{ vinculo.justification ?? '' }}
                    @if (vinculo.undoneAt) {
                      <span class="secundario">
                        Desfeito em {{ dataHora(vinculo.undoneAt) }}: {{ vinculo.undoReason }}
                      </span>
                    }
                  </td>
                  <td class="acoes">
                    @if (!vinculo.undoneAt && podeDesfazer()) {
                      <p-button
                        label="Desfazer"
                        size="small"
                        severity="danger"
                        [text]="true"
                        (onClick)="abrirDesfazer(vinculo)"
                      />
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" class="vazio">Este movimento ainda não foi conciliado.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    <p-dialog
      [visible]="!!escolha()"
      (visibleChange)="!$event && escolha.set(null)"
      [modal]="true"
      [style]="{ width: '32rem' }"
      header="Conciliar movimento"
    >
      @if (escolha(); as escolhido) {
        @if (erroDialogo(); as falha) {
          <sge-error-alert [erro]="falha" />
        }
        <p class="secundario">
          {{ escolhido.rotulo }} — lançamento de {{ moeda(escolhido.esperado) }}; restam
          {{ moeda(restante()) }} no movimento. Conciliar não gera baixa nem altera saldo.
        </p>
        <div class="grade-campos formulario">
          <sge-decimal-field
            rotulo="Valor conciliado"
            [obrigatorio]="true"
            [ngModel]="valorVinculo()"
            (ngModelChange)="valorVinculo.set($event)"
          />
          <sge-text-field
            rotulo="Justificativa da divergência"
            [dica]="diferencaVinculo() ? 'Obrigatória: diferença de ' + moeda(diferencaVinculo()!) : 'Só é exigida quando o valor difere'"
            [obrigatorio]="!!diferencaVinculo()"
            [ngModel]="justificativa()"
            (ngModelChange)="justificativa.set($event ?? '')"
          />
        </div>
        @if (problemaDoVinculo(); as texto) {
          <p class="campo__erro">{{ texto }}</p>
        }
      }
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          [disabled]="agindo()"
          (onClick)="escolha.set(null)"
        />
        <p-button
          label="Conciliar"
          icon="pi pi-link"
          [loading]="agindo()"
          [disabled]="agindo() || !!problemaDoVinculo()"
          (onClick)="vincular()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="!!desfazendo()"
      (visibleChange)="!$event && desfazendo.set(null)"
      [modal]="true"
      [style]="{ width: '30rem' }"
      header="Desfazer conciliação"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <p class="secundario">
        O vínculo não é apagado: fica no histórico com autor, data e motivo, e o movimento volta a
        pedir conciliação.
      </p>
      <sge-text-field
        rotulo="Motivo"
        [obrigatorio]="true"
        dica="Mínimo de 3 caracteres"
        [ngModel]="motivo()"
        (ngModelChange)="motivo.set($event ?? '')"
      />
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          [disabled]="agindo()"
          (onClick)="desfazendo.set(null)"
        />
        <p-button
          label="Desfazer"
          severity="danger"
          [loading]="agindo()"
          [disabled]="agindo() || !!problemaDoMotivo()"
          (onClick)="desfazer()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="ignorando()"
      (visibleChange)="ignorando.set($event)"
      [modal]="true"
      [style]="{ width: '30rem' }"
      header="Marcar movimento como sem par"
    >
      @if (erroDialogo(); as falha) {
        <sge-error-alert [erro]="falha" />
      }
      <p class="secundario">
        Para o que não tem título: tarifa, rendimento, transferência entre contas próprias. O
        movimento sai da fila de pendências e pode ser reaberto depois.
      </p>
      <sge-text-field
        rotulo="Motivo"
        [obrigatorio]="true"
        dica="Mínimo de 3 caracteres"
        [ngModel]="motivo()"
        (ngModelChange)="motivo.set($event ?? '')"
      />
      <ng-template #footer>
        <p-button
          label="Voltar"
          severity="secondary"
          [outlined]="true"
          [disabled]="agindo()"
          (onClick)="ignorando.set(false)"
        />
        <p-button
          label="Marcar como sem par"
          [loading]="agindo()"
          [disabled]="agindo() || !!problemaDoMotivo()"
          (onClick)="ignorar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    ESTILO_TABELA,
    `
      .kpi__value--texto {
        font-size: 0.95rem;
      }
      .tolerancias {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
        gap: 0.75rem;
        align-items: end;
      }
      .motivos {
        margin: 0;
        padding-left: 1rem;
      }
      .desfeito td {
        color: var(--p-text-muted-color);
      }
      .desfeito td:nth-child(4) {
        text-decoration: line-through;
      }
      .formulario {
        padding-top: 0.75rem;
      }
    `,
  ],
})
export class MatchingPage {
  private readonly api = inject(ReconciliationApiService);
  private readonly bancos = inject(BankingApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly movimentoId = this.rota.snapshot.paramMap.get('id') ?? '';
  /** Vem da lista pelo estado da navegação: a sugestão não devolve o histórico. */
  protected readonly descricao: string =
    typeof history !== 'undefined' && typeof history.state?.descricao === 'string'
      ? history.state.descricao
      : '';

  protected readonly sugestoes = signal<ReconciliationSuggestions | null>(null);
  protected readonly vinculos = signal<ReconciliationListItem[]>([]);
  protected readonly ordens = signal<PaymentTransaction[]>([]);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly buscando = signal(false);
  protected readonly agindo = signal(false);
  protected readonly erroDialogo = signal<unknown>(null);

  protected readonly dias = signal('5');
  protected readonly toleranciaValor = signal<string | null>('0.00');

  protected readonly escolha = signal<AlvoVinculo | null>(null);
  protected readonly valorVinculo = signal<string | null>(null);
  protected readonly justificativa = signal('');
  protected readonly desfazendo = signal<ReconciliationListItem | null>(null);
  protected readonly ignorando = signal(false);
  protected readonly motivo = signal('');

  protected readonly vivos = computed(() => this.vinculos().filter((v) => !v.undoneAt));

  protected readonly restante = computed(() => {
    const mov = this.sugestoes();
    return mov ? restanteMovimento(mov.amount, this.vinculos()) : '0.00';
  });

  protected readonly conciliado = computed(() => {
    const mov = this.sugestoes();
    return mov ? subtrair(mov.amount, this.restante()) : '0.00';
  });

  protected readonly titulo = computed(() => {
    const mov = this.sugestoes();
    return mov ? `Conciliar ${valorComSinal(mov)} de ${formatDate(mov.movementDate)}` : 'Conciliar movimento';
  });

  protected readonly problemaBusca = computed(() => {
    const texto = this.dias().toString().trim();
    if (!/^\d+$/.test(texto) || Number.parseInt(texto, 10) > 60) {
      return 'A tolerância de dias é um inteiro de 0 a 60.';
    }
    if (this.toleranciaValor() && paraCentavos(this.toleranciaValor()) < 0n) {
      return 'A tolerância de valor não pode ser negativa.';
    }
    return null;
  });

  protected readonly diferencaVinculo = computed(() => {
    const escolhido = this.escolha();
    const valor = this.valorVinculo();
    if (!escolhido || !valor) return null;
    const diferenca = subtrair(valor, escolhido.esperado);
    return paraCentavos(diferenca) === 0n ? null : diferenca;
  });

  protected readonly problemaDoVinculo = computed(() => {
    const escolhido = this.escolha();
    if (!escolhido) return null;
    return problemaVinculo({
      valor: this.valorVinculo(),
      restante: this.restante(),
      esperado: escolhido.esperado,
      justificativa: this.justificativa(),
    });
  });

  protected readonly problemaDoMotivo = computed(() => problemaMotivo(this.motivo()));

  protected readonly podeVincular = computed(() => {
    const mov = this.sugestoes();
    return (
      !!mov &&
      aceitaVinculo(mov.reconciliationStatus, this.restante()) &&
      this.permissoes.pode('reconciliation:CREATE')
    );
  });

  protected readonly podeDesfazer = () => this.permissoes.pode('reconciliation:DELETE');
  protected readonly podeVerOrdens = () => this.permissoes.pode('payments:READ');

  /** Sem par só o que não tem vínculo vivo — o servidor recusa o contrário (409). */
  protected readonly podeIgnorar = computed(() => {
    const mov = this.sugestoes();
    return (
      !!mov &&
      mov.reconciliationStatus !== 'IGNORADO' &&
      this.vivos().length === 0 &&
      this.permissoes.pode('reconciliation:CREATE')
    );
  });

  protected readonly podeReabrir = computed(() => {
    const mov = this.sugestoes();
    return !!mov && mov.reconciliationStatus === 'IGNORADO' && this.permissoes.pode('reconciliation:CREATE');
  });

  constructor() {
    this.buscar();
    this.carregarVinculos();
  }

  protected buscar(): void {
    if (this.problemaBusca()) return;
    this.buscando.set(true);
    this.erro.set(null);

    this.api
      .suggest(this.movimentoId, {
        dayTolerance: Number.parseInt(this.dias().toString(), 10),
        valueTolerance: this.toleranciaValor() ?? undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => {
          this.buscando.set(false);
          this.sugestoes.set(resultado);
          this.carregarOrdens(resultado);
        },
        error: (falha: unknown) => {
          this.buscando.set(false);
          this.erro.set(falha);
        },
      });
  }

  protected escolherParcela(candidata: MatchCandidate): void {
    this.abrirVinculo({
      tipo: 'PARCELA',
      id: candidata.installmentId,
      rotulo: `Título ${candidata.entryNumber}, parcela ${candidata.installmentNumber}/${candidata.totalInstallments}`,
      esperado: candidata.balance,
    });
  }

  protected escolherOrdem(ordem: PaymentTransaction): void {
    this.abrirVinculo({
      tipo: 'ORDEM',
      id: ordem.id,
      rotulo: `Ordem ${ROTULO_METODO[ordem.method] ?? ordem.method} para ${ordem.payeeName ?? '—'}`,
      esperado: ordem.amount,
    });
  }

  protected vincular(): void {
    const escolhido = this.escolha();
    const valor = this.valorVinculo();
    if (!escolhido || !valor || this.problemaDoVinculo()) return;

    const corpo: ReconciliationInput = { bankTransactionId: this.movimentoId, amount: valor };
    if (escolhido.tipo === 'PARCELA') corpo.installmentId = escolhido.id;
    else corpo.paymentTransactionId = escolhido.id;
    const justificativa = this.justificativa().trim();
    if (justificativa) corpo.justification = justificativa;

    this.agir(this.api.create(corpo), 'Movimento conciliado.', () => this.escolha.set(null));
  }

  protected abrirDesfazer(vinculo: ReconciliationListItem): void {
    this.motivo.set('');
    this.erroDialogo.set(null);
    this.desfazendo.set(vinculo);
  }

  protected desfazer(): void {
    const vinculo = this.desfazendo();
    if (!vinculo || this.problemaDoMotivo()) return;
    this.agir(this.api.undo(vinculo.id, this.motivo().trim()), 'Conciliação desfeita.', () =>
      this.desfazendo.set(null),
    );
  }

  protected abrirIgnorar(): void {
    this.motivo.set('');
    this.erroDialogo.set(null);
    this.ignorando.set(true);
  }

  protected ignorar(): void {
    if (this.problemaDoMotivo()) return;
    this.agir(
      this.api.ignore(this.movimentoId, this.motivo().trim()),
      'Movimento marcado como sem par.',
      () => this.ignorando.set(false),
    );
  }

  protected reabrir(): void {
    this.agir(this.api.reopen(this.movimentoId), 'Movimento devolvido à fila de conciliação.');
  }

  protected score(valor: string): string {
    return rotuloScore(valor);
  }

  protected severidadeDoScore(valor: string) {
    return severidadeScore(valor);
  }

  protected distancia(dias: number): string {
    return rotuloDistancia(dias);
  }

  protected natureza(mov: ReconciliationSuggestions): string {
    return ROTULO_NATUREZA[mov.identification.kind] ?? mov.identification.kind;
  }

  protected alvo(vinculo: ReconciliationListItem): string {
    return alvoVinculo(vinculo);
  }

  protected origem(vinculo: ReconciliationListItem): string {
    const texto = ROTULO_ORIGEM[vinculo.origin] ?? vinculo.origin;
    return vinculo.score ? `${texto} (${rotuloScore(vinculo.score)})` : texto;
  }

  protected metodo(ordem: PaymentTransaction): string {
    return ROTULO_METODO[ordem.method] ?? ordem.method;
  }

  protected valorSinal(mov: ReconciliationSuggestions): string {
    return valorComSinal(mov);
  }

  protected sentido(direcao: ReconciliationSuggestions['direction']): string {
    return rotuloSentido(direcao);
  }

  protected rotuloStatus(status: ReconciliationSuggestions['reconciliationStatus']): string {
    return ROTULO_CONCILIACAO[status] ?? status;
  }

  protected severidadeStatus(status: ReconciliationSuggestions['reconciliationStatus']) {
    return severidadeConciliacao(status);
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

  private abrirVinculo(alvo: AlvoVinculo): void {
    this.erroDialogo.set(null);
    this.justificativa.set('');
    this.valorVinculo.set(valorProposto(this.restante(), alvo.esperado));
    this.escolha.set(alvo);
  }

  private carregarVinculos(): void {
    this.api
      .list({ bankTransactionId: this.movimentoId, includeUndone: true, pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) => this.vinculos.set(resultado.data),
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  /** Ordens no mesmo sentido, confirmadas dentro da janela de dias da busca. */
  private carregarOrdens(mov: ReconciliationSuggestions): void {
    if (!this.podeVerOrdens()) return;
    const dia = mov.movementDate.slice(0, 10);
    const janela = Number.parseInt(this.dias().toString(), 10);
    this.bancos
      .listPayments({
        direction: mov.direction,
        status: 'CONFIRMADA',
        createdFrom: adicionarDias(dia, -janela),
        createdTo: adicionarDias(dia, janela),
        pageSize: 20,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      // As ordens são alvo opcional: sem elas as parcelas continuam valendo.
      .subscribe({
        next: (resultado) => this.ordens.set(resultado.data),
        error: () => this.ordens.set([]),
      });
  }

  /** Toda ação recarrega sugestões e vínculos: a situação é recalculada pelo trigger. */
  private agir(requisicao: Observable<unknown>, sucesso: string, fechar?: () => void): void {
    if (this.agindo()) return;
    this.agindo.set(true);
    this.aviso.set(null);
    this.erro.set(null);
    this.erroDialogo.set(null);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.agindo.set(false);
        fechar?.();
        this.aviso.set(sucesso);
        this.buscar();
        this.carregarVinculos();
      },
      error: (falha: unknown) => {
        this.agindo.set(false);
        if (fechar) this.erroDialogo.set(falha);
        else this.erro.set(falha);
      },
    });
  }
}
