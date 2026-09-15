import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';

import { NotificationsApiService } from '../core/api/notifications-api.service';
import type { AutomationRule, AutomationTrigger, NotificationChannel } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatDateTime } from '../core/lib/format';
import { Alert } from '../ui/alert';
import { ErrorAlert } from '../ui/error-alert';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  DESCRICAO_GATILHO,
  DIAS_PADRAO_VENCIMENTO,
  OPCOES_CANAL,
  ROTULO_GATILHO,
  aceitaCondicoes,
  resumoAcoes,
  resumoCondicoes,
} from './rotulos';

/**
 * Famílias de alerta na ordem em que o ERS as pede (RF-121 a RF-124).
 *
 * `PAGAMENTO_PROCESSADO` e `PAGAMENTO_FALHOU` são gatilhos distintos porque o
 * fato observado é outro — mas para quem configura, são a mesma preocupação:
 * "quero saber do pagamento". Ficam lado a lado por isso.
 */
const FAMILIAS: { trigger: AutomationTrigger; requisito: string }[] = [
  { trigger: 'TITULO_VENCENDO', requisito: 'RF-121' },
  { trigger: 'PAGAMENTO_PROCESSADO', requisito: 'RF-122' },
  { trigger: 'PAGAMENTO_FALHOU', requisito: 'RF-122' },
  { trigger: 'APROVACAO_PENDENTE', requisito: 'RF-123' },
  { trigger: 'DIVERGENCIA_CONCILIACAO', requisito: 'RF-124' },
];

/**
 * Preferências de alerta (RF-120 a RF-124 — UI-066).
 *
 * Esta tela é a leitura simples das regras de automação: uma linha por família
 * de alerta, com o que dá para mudar sem abrir o editor — ligar, desligar,
 * escolher o canal e, no alerta de vencimento, o horizonte em dias.
 *
 * Desligar aqui **não apaga** a regra: desativa. Apagar seria a maneira
 * silenciosa de fazer o aviso parar sem deixar rastro de quem o parou — e é por
 * isso que `automation-rules:UPDATE` não acompanha a leitura.
 *
 * Família com mais de uma regra não é editada aqui: duas regras do mesmo
 * gatilho têm condições e destinatários próprios, e resumir as duas num
 * controle só esconderia qual delas mudou. Essas vão para o editor (UI-067).
 */
@Component({
  selector: 'sge-alert-preferences-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    TagModule,
    Alert,
    ErrorAlert,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Automação / Preferências de alerta</p>

    <div class="pagehead">
      <div>
        <h1>Preferências de alerta</h1>
        <p>Quando o sistema avisa sobre vencimento, pagamento, aprovação e divergência.</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Editor de regras"
          icon="pi pi-sliders-h"
          severity="secondary"
          [outlined]="true"
          routerLink="/automacao/regras"
        />
      </div>
    </div>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }
    @if (problema(); as texto) {
      <div class="espaco"><sge-alert tom="aviso" [titulo]="texto" /></div>
    }
    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (!podeEditar()) {
      <div class="espaco">
        <sge-alert
          tom="info"
          titulo="Somente leitura"
          mensagem="Alterar gatilhos e destinatários exige a permissão de editar regras de automação."
        />
      </div>
    }

    @for (familia of familias(); track familia.trigger) {
      <section class="card espaco familia">
        <div class="familia__cabecalho">
          <div>
            <h2 class="familia__titulo">
              {{ familia.rotulo }}
              <span class="familia__requisito">{{ familia.requisito }}</span>
            </h2>
            <p class="familia__descricao">{{ familia.descricao }}</p>
          </div>
          @if (familia.regras.length === 0) {
            <p-tag value="Não configurado" severity="secondary" [rounded]="true" />
          } @else if (familia.ativa) {
            <p-tag value="Avisando" severity="success" [rounded]="true" />
          } @else {
            <p-tag value="Desligado" severity="warn" [rounded]="true" />
          }
        </div>

        @if (familia.regras.length === 0) {
          <p class="secundario">
            Nenhuma regra para este fato. Enquanto não houver, ninguém é avisado —
            @if (podeCriar()) {
              crie a regra no editor.
            } @else {
              peça a quem cadastra regras de automação.
            }
          </p>
        } @else if (familia.regras.length > 1) {
          <p class="secundario">
            {{ familia.regras.length }} regras configuradas para este fato, com destinatários
            próprios. A edição é no editor de regras, para não esconder qual delas mudou.
          </p>
          <ul class="resumo">
            @for (regra of familia.regras; track regra.id) {
              <li>
                <strong>{{ regra.name }}</strong> — {{ destinatarios(regra) }}
                @if (!regra.isActive) {
                  <span class="secundario">(desativada)</span>
                }
              </li>
            }
          </ul>
        } @else if (familia.unica; as regra) {
          <p class="secundario">
            {{ condicoes(regra) }} · {{ destinatarios(regra) }}
            @if (regra.lastRunAt) {
              · última varredura em {{ dataHora(regra.lastRunAt) }}
            }
          </p>

          <div class="controles">
            <sge-select-field
              rotulo="Canal do aviso"
              [obrigatorio]="true"
              [opcoes]="opcoesCanal"
              [disabled]="!podeEditar()"
              [ngModel]="canal(regra)"
              (ngModelChange)="mudarCanal(regra, $event)"
            />
            @if (temHorizonte(regra)) {
              <sge-text-field
                rotulo="Antecedência (dias)"
                [dica]="'Padrão do sistema: ' + diasPadrao + ' dias.'"
                [disabled]="!podeEditar()"
                [ngModel]="dias(regra)"
                (ngModelChange)="mudarDias(regra, $event ?? '')"
              />
            }
            <div class="controles__acoes">
              @if (podeEditar()) {
                <p-button
                  [label]="regra.isActive ? 'Desligar avisos' : 'Ligar avisos'"
                  [severity]="regra.isActive ? 'danger' : 'primary'"
                  [outlined]="regra.isActive"
                  size="small"
                  [disabled]="!!salvando()"
                  [loading]="salvando() === regra.id + ':ativo'"
                  (onClick)="alternar(regra)"
                />
                <p-button
                  label="Salvar"
                  icon="pi pi-check"
                  size="small"
                  [disabled]="!!salvando() || !mudou(regra)"
                  [loading]="salvando() === regra.id + ':dados'"
                  (onClick)="salvar(regra)"
                />
              }
            </div>
          </div>
        }
      </section>
    }
  `,
  styles: `
    .familia__cabecalho {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.875rem 0.875rem 0;
    }
    .familia__titulo {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin: 0;
      font-size: 0.95rem;
      font-weight: 600;
    }
    .familia__requisito {
      font-size: 0.7rem;
      font-weight: 500;
      color: var(--p-text-muted-color);
    }
    .familia__descricao {
      margin: 0.2rem 0 0;
      font-size: 0.8rem;
      color: var(--p-text-muted-color);
    }
    .secundario {
      margin: 0.5rem 0.875rem;
      font-size: 0.8rem;
      color: var(--p-text-muted-color);
    }
    .resumo {
      margin: 0 0.875rem 0.875rem;
      padding-left: 1.1rem;
      font-size: 0.8rem;
    }
    .controles {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 1rem;
      padding: 0 0.875rem 0.875rem;
    }
    .controles__acoes {
      display: flex;
      gap: 0.5rem;
      padding-bottom: 0.25rem;
    }
  `,
})
export class AlertPreferencesPage {
  private readonly api = inject(NotificationsApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly opcoesCanal = OPCOES_CANAL;
  protected readonly diasPadrao = DIAS_PADRAO_VENCIMENTO;
  protected readonly dataHora = formatDateTime;
  protected readonly condicoes = resumoCondicoes;
  protected readonly destinatarios = resumoAcoes;

  private readonly regras = signal<AutomationRule[]>([]);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly salvando = signal<string | null>(null);
  /** Validação local — não é falha da API, e o alerta não deve dizer que foi. */
  protected readonly problema = signal<string | null>(null);

  /** Alterações ainda não salvas, por regra. */
  private readonly rascunhos = signal<Record<string, { channel: NotificationChannel; daysAhead: string }>>(
    {},
  );

  protected readonly familias = computed(() =>
    FAMILIAS.map(({ trigger, requisito }) => {
      const regras = this.regras().filter((regra) => regra.triggerEvent === trigger);
      return {
        trigger,
        requisito,
        rotulo: ROTULO_GATILHO[trigger],
        descricao: DESCRICAO_GATILHO[trigger],
        regras,
        unica: regras.length === 1 ? regras[0] : null,
        ativa: regras.some((regra) => regra.isActive),
      };
    }),
  );

  protected readonly podeEditar = () => this.permissoes.pode('automation-rules:UPDATE');
  protected readonly podeCriar = () => this.permissoes.pode('automation-rules:CREATE');

  constructor() {
    this.carregar();
  }

  protected temHorizonte(regra: AutomationRule): boolean {
    return aceitaCondicoes(regra.triggerEvent);
  }

  protected canal(regra: AutomationRule): NotificationChannel {
    return this.rascunho(regra).channel;
  }

  protected dias(regra: AutomationRule): string {
    return this.rascunho(regra).daysAhead;
  }

  protected mudarCanal(regra: AutomationRule, canal: NotificationChannel | null): void {
    if (!canal) return;
    this.atualizarRascunho(regra, { channel: canal });
  }

  protected mudarDias(regra: AutomationRule, valor: string): void {
    this.atualizarRascunho(regra, { daysAhead: valor });
  }

  protected mudou(regra: AutomationRule): boolean {
    const rascunho = this.rascunhos()[regra.id];
    if (!rascunho) return false;
    const base = this.baseDe(regra);
    return rascunho.channel !== base.channel || rascunho.daysAhead !== base.daysAhead;
  }

  /**
   * Liga e desliga sem tocar em condição nem destinatário: é a única mudança
   * que a tela faz sozinha, e a que precisa ficar óbvia.
   */
  protected alternar(regra: AutomationRule): void {
    if (this.salvando()) return;
    this.salvando.set(`${regra.id}:ativo`);
    this.erro.set(null);
    this.api
      .updateRule(regra.id, { isActive: !regra.isActive })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (atualizada) => {
          this.salvando.set(null);
          this.substituir(atualizada);
          this.aviso.set(
            atualizada.isActive
              ? `${atualizada.name}: os avisos voltam a sair.`
              : `${atualizada.name}: os avisos deste fato param até ser religados.`,
          );
        },
        error: (falha: unknown) => {
          this.salvando.set(null);
          this.erro.set(falha);
        },
      });
  }

  protected salvar(regra: AutomationRule): void {
    if (this.salvando() || !this.mudou(regra)) return;
    const rascunho = this.rascunho(regra);

    if (rascunho.daysAhead !== '') {
      const dias = Number(rascunho.daysAhead);
      if (!Number.isInteger(dias) || dias < 0 || dias > 90) {
        this.problema.set('O horizonte do alerta vai de 0 a 90 dias.');
        return;
      }
    }
    this.problema.set(null);

    // As ações vão inteiras: o motor lê a lista de uma vez, e mandar metade
    // deixaria a regra endereçando um conjunto que ninguém escreveu.
    const acoes = regra.actions.map((acao) => ({ ...acao, channel: rascunho.channel }));
    const condicoes = aceitaCondicoes(regra.triggerEvent)
      ? {
          ...(regra.conditions ?? {}),
          ...(rascunho.daysAhead === ''
            ? {}
            : { daysAhead: Number(rascunho.daysAhead) }),
        }
      : undefined;

    this.salvando.set(`${regra.id}:dados`);
    this.erro.set(null);
    this.api
      .updateRule(regra.id, { actions: acoes, ...(condicoes ? { conditions: condicoes } : {}) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (atualizada) => {
          this.salvando.set(null);
          this.substituir(atualizada);
          this.rascunhos.update(({ [regra.id]: _descartado, ...resto }) => resto);
          this.aviso.set(`${atualizada.name} atualizada.`);
        },
        error: (falha: unknown) => {
          this.salvando.set(null);
          this.erro.set(falha);
        },
      });
  }

  private rascunho(regra: AutomationRule): { channel: NotificationChannel; daysAhead: string } {
    return this.rascunhos()[regra.id] ?? this.baseDe(regra);
  }

  private baseDe(regra: AutomationRule): { channel: NotificationChannel; daysAhead: string } {
    const dias = regra.conditions?.daysAhead;
    return {
      channel: regra.actions[0]?.channel ?? 'INTERNO',
      daysAhead: dias === undefined ? '' : String(dias),
    };
  }

  private atualizarRascunho(
    regra: AutomationRule,
    parcial: Partial<{ channel: NotificationChannel; daysAhead: string }>,
  ): void {
    const atual = this.rascunho(regra);
    this.rascunhos.update((rascunhos) => ({
      ...rascunhos,
      [regra.id]: { ...atual, ...parcial },
    }));
  }

  private substituir(regra: AutomationRule): void {
    this.regras.update((lista) =>
      lista.map((linha) => (linha.id === regra.id ? regra : linha)),
    );
  }

  private carregar(): void {
    this.erro.set(null);
    this.api
      .listRules({ pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pagina) => this.regras.set(pagina.data),
        error: (falha: unknown) => {
          this.regras.set([]);
          this.erro.set(falha);
        },
      });
  }
}
