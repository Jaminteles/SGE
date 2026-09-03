import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { AuditApiService } from '../core/api/audit-api.service';
import type { AuditEntry, AuditEventType } from '../core/api/types';
import { ListState } from '../core/lib/list-state';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';

/** Eventos do enum `AuditEvent` do backend (RF-114). */
const EVENTOS: { value: AuditEventType; label: string }[] = [
  { value: 'CRIACAO', label: 'Criação' },
  { value: 'ALTERACAO', label: 'Alteração' },
  { value: 'EXCLUSAO', label: 'Exclusão' },
  { value: 'APROVACAO', label: 'Aprovação' },
  { value: 'REPROVACAO', label: 'Reprovação' },
  { value: 'PAGAMENTO', label: 'Pagamento' },
  { value: 'RECEBIMENTO', label: 'Recebimento' },
  { value: 'CANCELAMENTO', label: 'Cancelamento' },
  { value: 'ESTORNO', label: 'Estorno' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'LOGOUT', label: 'Logout' },
  { value: 'ACESSO_NEGADO', label: 'Acesso negado' },
  { value: 'EXPORTACAO', label: 'Exportação' },
  { value: 'IMPORTACAO', label: 'Importação' },
  { value: 'FECHAMENTO', label: 'Fechamento' },
  { value: 'REABERTURA', label: 'Reabertura' },
];

const OPCOES_EVENTO: OpcaoFiltro[] = EVENTOS.map((e) => ({ value: e.value, label: e.label }));

const ROTULO_EVENTO = new Map(EVENTOS.map((e) => [e.value, e.label]));

/** Eventos que merecem destaque na lista — dinheiro e acesso negado. */
const SEVERIDADE: Partial<Record<AuditEventType, 'success' | 'warn' | 'danger' | 'info'>> = {
  CRIACAO: 'success',
  EXCLUSAO: 'danger',
  ACESSO_NEGADO: 'danger',
  APROVACAO: 'success',
  REPROVACAO: 'warn',
  PAGAMENTO: 'info',
  RECEBIMENTO: 'info',
  ESTORNO: 'warn',
  CANCELAMENTO: 'warn',
};

/**
 * Trilha de auditoria (RF-114 a RF-118 — UI-012).
 *
 * Consulta pura: a trilha é append-only e o backend não expõe escrita nenhuma.
 * O período é enviado como intervalo `from`/`to` — `to` é exclusivo, então o
 * fim do dia escolhido vira a meia-noite do dia seguinte.
 */
@Component({
  selector: 'sge-audit-page',
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    TagModule,
    DataTable,
    ErrorAlert,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Auditoria / Trilha de eventos</p>

    <div class="pagehead">
      <div>
        <h1>Trilha de auditoria</h1>
        <p>Registro append-only de quem fez o quê, quando e de onde (RF-114 a RF-118).</p>
      </div>
    </div>

    <div class="card periodo">
      <sge-text-field
        rotulo="De"
        tipo="date"
        name="de"
        [ngModel]="de()"
        (ngModelChange)="mudarPeriodo('de', $event)"
      />
      <sge-text-field
        rotulo="Até"
        tipo="date"
        name="ate"
        dica="Inclusivo"
        [ngModel]="ate()"
        (ngModelChange)="mudarPeriodo('ate', $event)"
      />
      <sge-text-field
        rotulo="Entidade"
        name="entidade"
        dica="Tabela auditada, ex.: titulo"
        [ngModel]="entidade()"
        (ngModelChange)="mudarEntidade($event)"
      />
      <sge-select-field
        rotulo="Evento"
        name="evento"
        placeholder="Todos"
        [opcoes]="opcoesEvento"
        [ngModel]="evento()"
        (ngModelChange)="mudarEvento($event ?? '')"
      />
      <p-button
        label="Limpar filtros"
        severity="secondary"
        [outlined]="true"
        (onClick)="limpar()"
      />
    </div>

    @if (lista.erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    <section class="card table-card espaco">
      <sge-data-table
        [colunas]="colunas"
        [linhas]="lista.linhas()"
        [total]="lista.total()"
        [pagina]="lista.pagina()"
        [tamanhoPagina]="lista.tamanhoPagina()"
        [carregando]="lista.carregando()"
        mensagemVazia="Nenhum evento no período e nos filtros escolhidos."
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-item>
          <tr>
            <td>{{ dataHora(item.occurredAt) }}</td>
            <td>{{ item.userName ?? 'Sistema' }}</td>
            <td>
              <p-tag
                [value]="rotuloEvento(item.event)"
                [severity]="severidade(item.event)"
                [rounded]="true"
              />
            </td>
            <td>
              <code>{{ item.entity }}</code>
              @if (item.entityId) {
                <span class="secundario">{{ item.entityId }}</span>
              }
            </td>
            <td>{{ origem(item) }}</td>
            <td class="acoes">
              @if (item.changedFields.length > 0 || item.currentValue) {
                <p-button
                  label="Ver diferença"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  (onClick)="abrir(item)"
                />
              } @else {
                <span class="secundario">—</span>
              }
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
      <p class="nota nota--recuo">
        Registro protegido contra alteração: a trilha é append-only (RF-116).
      </p>
    </section>

    <p-dialog
      [visible]="detalhe() !== null"
      (visibleChange)="fechar($event)"
      [modal]="true"
      [style]="{ width: '46rem' }"
      header="Diferença do evento"
    >
      @if (detalhe(); as evento) {
        <dl class="detalhe">
          <dt>Ocorrido em</dt>
          <dd>{{ dataHora(evento.occurredAt) }}</dd>
          <dt>Autor</dt>
          <dd>{{ evento.userName ?? 'Sistema' }}</dd>
          <dt>Entidade</dt>
          <dd>
            <code>{{ evento.entity }}</code> {{ evento.entityId ?? '' }}
          </dd>
          <dt>Campos alterados</dt>
          <dd>{{ evento.changedFields.join(', ') || '—' }}</dd>
        </dl>

        <div class="valores">
          <div>
            <h3>Antes</h3>
            <pre>{{ json(evento.previousValue) }}</pre>
          </div>
          <div>
            <h3>Depois</h3>
            <pre>{{ json(evento.currentValue) }}</pre>
          </div>
        </div>
      }
    </p-dialog>
  `,
  styles: `
    .periodo {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      align-items: end;
      gap: 0.875rem;
      padding: 0.875rem;
    }
    .detalhe {
      display: grid;
      grid-template-columns: 10rem 1fr;
      gap: 0.35rem 1rem;
      margin: 0 0 1rem;
      font-size: 0.8rem;
    }
    .detalhe dt {
      color: var(--p-text-muted-color);
    }
    .detalhe dd {
      margin: 0;
      color: var(--p-text-color);
    }
    .valores {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 0.875rem;
    }
    .valores h3 {
      margin: 0 0 0.35rem;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--p-text-muted-color);
    }
    .valores pre {
      margin: 0;
      max-height: 18rem;
      overflow: auto;
      padding: 0.75rem;
      font-size: 0.72rem;
      line-height: 1.45;
      background: var(--p-content-background);
      border: 1px solid var(--p-content-border-color);
      border-radius: var(--p-content-border-radius);
    }
    .nota--recuo {
      padding: 0 1.125rem 0.875rem;
    }
  `,
})
export class AuditPage {
  private readonly api = inject(AuditApiService);

  protected readonly opcoesEvento = OPCOES_EVENTO;

  protected readonly colunas: Coluna[] = [
    { campo: 'occurredAt', cabecalho: 'Data / hora', largura: '12rem' },
    { campo: 'userName', cabecalho: 'Usuário', largura: '14rem' },
    { campo: 'event', cabecalho: 'Evento', largura: '10rem' },
    { campo: 'entity', cabecalho: 'Entidade' },
    { campo: 'origin', cabecalho: 'Origem', largura: '14rem' },
    { campo: 'acoes', cabecalho: 'Valores', largura: '9rem' },
  ];

  protected readonly de = signal('');
  protected readonly ate = signal('');
  protected readonly entidade = signal('');
  protected readonly evento = signal('');
  protected readonly detalhe = signal<AuditEntry | null>(null);

  // A trilha não aceita busca textual: os filtros são os do `QueryAuditDto`,
  // e mandar um `q` faria o backend recusar a requisição inteira.
  protected readonly lista = new ListState<AuditEntry>(
    (consulta) => this.api.list(consulta),
    () => this.consulta(),
  );

  /** Segundos aparecem na trilha: dois eventos no mesmo minuto são comuns. */
  protected readonly dataHora = (valor: string): string => {
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return valor;
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${pad(data.getDate())}/${pad(data.getMonth() + 1)}/${data.getFullYear()} ` +
      `${pad(data.getHours())}:${pad(data.getMinutes())}:${pad(data.getSeconds())}`
    );
  };

  constructor() {
    this.lista.carregar();
  }

  protected rotuloEvento(evento: AuditEventType): string {
    return ROTULO_EVENTO.get(evento) ?? evento;
  }

  protected severidade(
    evento: AuditEventType,
  ): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    return SEVERIDADE[evento] ?? 'secondary';
  }

  protected origem(item: AuditEntry): string {
    return [item.origin, item.ip].filter(Boolean).join(' · ') || '—';
  }

  protected json(valor: unknown): string {
    if (valor === null || valor === undefined) return '—';
    return JSON.stringify(valor, null, 2);
  }

  protected abrir(item: AuditEntry): void {
    this.detalhe.set(item);
  }

  protected fechar(visivel: boolean): void {
    if (!visivel) this.detalhe.set(null);
  }

  protected mudarPeriodo(campo: 'de' | 'ate', valor: string): void {
    if (campo === 'de') this.de.set(valor);
    else this.ate.set(valor);
    this.recarregar();
  }

  protected mudarEntidade(valor: string): void {
    this.entidade.set(valor);
    this.recarregar();
  }

  protected mudarEvento(valor: string): void {
    this.evento.set(valor);
    this.recarregar();
  }

  /** Filtro novo volta para a primeira página. */
  private recarregar(): void {
    this.lista.aplicarFiltros({ q: '' });
  }

  protected limpar(): void {
    this.de.set('');
    this.ate.set('');
    this.entidade.set('');
    this.evento.set('');
    this.lista.limparFiltros();
  }

  private consulta() {
    const entidade = this.entidade().trim();
    return {
      ...(this.evento() !== '' ? { event: this.evento() } : {}),
      ...(entidade !== '' ? { entity: entidade } : {}),
      ...(this.de() !== '' ? { from: `${this.de()}T00:00:00.000Z` } : {}),
      // `to` é exclusivo no backend: para incluir o dia escolhido inteiro, o
      // limite vai para a meia-noite do dia seguinte.
      ...(this.ate() !== '' ? { to: this.diaSeguinte(this.ate()) } : {}),
    };
  }

  private diaSeguinte(dia: string): string {
    const data = new Date(`${dia}T00:00:00.000Z`);
    data.setUTCDate(data.getUTCDate() + 1);
    return data.toISOString();
  }
}
