import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { EmployeesApiService } from '../core/api/employees-api.service';
import { HrStructureApiService } from '../core/api/hr-structure-api.service';
import type { Employee, EmployeeEvent, EmployeeEventInput, HrEventType } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import {
  EVENTOS_COM_SALARIO,
  OPCOES_EVENTO,
  ROTULO_EVENTO,
  ROTULO_STATUS,
  severidadeEvento,
} from './rotulos';

interface FormularioEvento {
  type: string;
  startDate: string;
  endDate: string;
  positionId: string;
  departmentId: string;
  salary: string;
  note: string;
}

const EVENTO_VAZIO: FormularioEvento = {
  type: '',
  startDate: '',
  endDate: '',
  positionId: '',
  departmentId: '',
  salary: '',
  note: '',
};

interface FormularioDesligamento {
  terminationDate: string;
  reason: string;
  note: string;
}

const DESLIGAMENTO_VAZIO: FormularioDesligamento = {
  terminationDate: '',
  reason: '',
  note: '',
};

/**
 * Histórico funcional: admissão, desligamento e eventos (RF-015/RF-020 —
 * UI-015).
 *
 * O registro é append-only no banco: não há editar nem excluir evento, só
 * acrescentar. Admissão vem do cadastro e desligamento da rota própria, que
 * exige motivo — por isso os dois não aparecem na lista de tipos do formulário.
 */
@Component({
  selector: 'sge-employee-history-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    TagModule,
    Alert,
    DataTable,
    DecimalField,
    ErrorAlert,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">RH / Funcionários / {{ nome() }} / Histórico</p>

    <div class="pagehead">
      <div>
        <h1>Histórico funcional</h1>
        <p>{{ subtitulo() }}</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Voltar ao cadastro"
          severity="secondary"
          [outlined]="true"
          [routerLink]="['/rh/funcionarios', employeeId]"
        />
        @if (podeDesligar() && ativo()) {
          <p-button
            label="Desligar"
            severity="danger"
            [outlined]="true"
            (onClick)="abrirDesligamento()"
          />
        }
        @if (podeRegistrar()) {
          <p-button label="Novo evento" icon="pi pi-plus" (onClick)="abrirEvento()" />
        }
      </div>
    </div>

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
        mensagemVazia="Nenhum evento registrado."
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-evento>
          <tr>
            <td>{{ data(evento.startDate) }}</td>
            <td>
              <p-tag
                [value]="rotulo(evento.type)"
                [severity]="severidade(evento.type)"
                [rounded]="true"
              />
            </td>
            <td>{{ periodo(evento) }}</td>
            <td class="coluna--numerica">{{ salario(evento) }}</td>
            <td>{{ evento.note ?? '—' }}</td>
          </tr>
        </ng-template>
      </sge-data-table>
      <p class="nota">Registro append-only: eventos não são editados nem apagados (RF-020).</p>
    </section>

    <p-dialog
      [visible]="eventoAberto()"
      (visibleChange)="eventoAberto.set($event)"
      [modal]="true"
      [style]="{ width: '40rem' }"
      header="Novo evento"
    >
      @if (erroEvento(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvarEvento()">
        <sge-select-field
          rotulo="Tipo de evento"
          name="type"
          [opcoes]="OPCOES_EVENTO"
          [obrigatorio]="true"
          [ngModel]="formEvento().type"
          (ngModelChange)="mudarEvento('type', $event ?? '')"
        />
        <sge-text-field
          rotulo="Início"
          name="startDate"
          tipo="date"
          [obrigatorio]="true"
          [ngModel]="formEvento().startDate"
          (ngModelChange)="mudarEvento('startDate', $event)"
        />
        <sge-text-field
          rotulo="Fim"
          name="endDate"
          tipo="date"
          dica="Quando previsto"
          [ngModel]="formEvento().endDate"
          (ngModelChange)="mudarEvento('endDate', $event)"
        />
        <sge-select-field
          rotulo="Novo cargo"
          name="positionId"
          [opcoes]="opcoesCargo()"
          [ngModel]="formEvento().positionId"
          (ngModelChange)="mudarEvento('positionId', $event ?? '')"
        />
        <sge-select-field
          rotulo="Novo departamento"
          name="departmentId"
          [opcoes]="opcoesDepartamento()"
          [ngModel]="formEvento().departmentId"
          (ngModelChange)="mudarEvento('departmentId', $event ?? '')"
        />
        <sge-decimal-field
          rotulo="Novo salário"
          name="salary"
          [obrigatorio]="exigeSalario()"
          [dica]="exigeSalario() ? 'Obrigatório para promoção e alteração salarial' : ''"
          [ngModel]="formEvento().salary"
          (ngModelChange)="mudarEvento('salary', $event ?? '')"
        />
        <sge-text-field
          rotulo="Observação"
          name="note"
          [ngModel]="formEvento().note"
          (ngModelChange)="mudarEvento('note', $event)"
        />
      </form>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="eventoAberto.set(false)"
        />
        <p-button
          label="Registrar"
          icon="pi pi-check"
          [loading]="salvandoEvento()"
          [disabled]="salvandoEvento()"
          (onClick)="salvarEvento()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="desligamentoAberto()"
      (visibleChange)="desligamentoAberto.set($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      header="Desligar funcionário"
    >
      @if (erroDesligamento(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <sge-alert
        tom="aviso"
        titulo="O desligamento encerra o vínculo"
        mensagem="A situação passa a DESLIGADO e o evento vai para o histórico e para a trilha de auditoria."
      />

      <form class="grade-campos formulario" (ngSubmit)="desligar()">
        <sge-text-field
          rotulo="Data do desligamento"
          name="terminationDate"
          tipo="date"
          [obrigatorio]="true"
          [ngModel]="formDesligamento().terminationDate"
          (ngModelChange)="mudarDesligamento('terminationDate', $event)"
        />
        <sge-text-field
          rotulo="Motivo"
          name="reason"
          [obrigatorio]="true"
          [ngModel]="formDesligamento().reason"
          (ngModelChange)="mudarDesligamento('reason', $event)"
        />
        <sge-text-field
          rotulo="Observação"
          name="note"
          [ngModel]="formDesligamento().note"
          (ngModelChange)="mudarDesligamento('note', $event)"
        />
      </form>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="desligamentoAberto.set(false)"
        />
        <p-button
          label="Confirmar desligamento"
          severity="danger"
          [loading]="desligando()"
          [disabled]="desligando()"
          (onClick)="desligar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.75rem;
    }
  `,
})
export class EmployeeHistoryPage {
  private readonly api = inject(EmployeesApiService);
  private readonly estrutura = inject(HrStructureApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly OPCOES_EVENTO = OPCOES_EVENTO;

  protected readonly employeeId = this.rota.snapshot.paramMap.get('id') ?? '';

  protected readonly colunas: Coluna[] = [
    { campo: 'startDate', cabecalho: 'Data', largura: '8rem' },
    { campo: 'type', cabecalho: 'Evento', largura: '11rem' },
    { campo: 'periodo', cabecalho: 'Detalhe' },
    { campo: 'salary', cabecalho: 'Efeito financeiro', numerica: true, largura: '11rem' },
    { campo: 'note', cabecalho: 'Observação' },
  ];

  protected readonly lista = new ListState<EmployeeEvent>((consulta) =>
    this.api.listEvents(this.employeeId, consulta),
  );

  protected readonly funcionario = signal<Employee | null>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly eventoAberto = signal(false);
  protected readonly formEvento = signal<FormularioEvento>({ ...EVENTO_VAZIO });
  protected readonly salvandoEvento = signal(false);
  protected readonly erroEvento = signal<unknown>(null);

  protected readonly desligamentoAberto = signal(false);
  protected readonly formDesligamento = signal<FormularioDesligamento>({ ...DESLIGAMENTO_VAZIO });
  protected readonly desligando = signal(false);
  protected readonly erroDesligamento = signal<unknown>(null);

  protected readonly opcoesCargo = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesDepartamento = signal<OpcaoFiltro[]>([]);

  protected readonly nome = computed(() => this.funcionario()?.name ?? 'Funcionário');

  protected readonly ativo = computed(() => this.funcionario()?.status !== 'DESLIGADO');

  protected readonly subtitulo = computed(() => {
    const registro = this.funcionario();
    if (!registro) return 'Admissão, desligamento e eventos administrativos (RF-015/RF-020).';
    const partes = [
      `Matrícula ${registro.registration}`,
      `admitido em ${formatDate(registro.hireDate)}`,
      ROTULO_STATUS[registro.status],
    ];
    return `${partes.join(' · ')}.`;
  });

  protected readonly exigeSalario = computed(() =>
    EVENTOS_COM_SALARIO.includes(this.formEvento().type as HrEventType),
  );

  protected readonly podeRegistrar = () => this.permissoes.pode('employee-events:CREATE');
  protected readonly podeDesligar = () => this.permissoes.pode('employees:DELETE');

  constructor() {
    this.lista.carregar();
    this.carregarFuncionario();
    this.carregarReferencias();
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected rotulo(tipo: HrEventType): string {
    return ROTULO_EVENTO[tipo] ?? tipo;
  }

  protected severidade(tipo: HrEventType) {
    return severidadeEvento(tipo);
  }

  protected periodo(evento: EmployeeEvent): string {
    if (!evento.endDate) return '—';
    return `até ${formatDate(evento.endDate)}`;
  }

  protected salario(evento: EmployeeEvent): string {
    return evento.salary ? formatCurrency(evento.salary) : 'Sem efeito';
  }

  protected mudarEvento<K extends keyof FormularioEvento>(
    campo: K,
    valor: FormularioEvento[K],
  ): void {
    this.formEvento.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarDesligamento<K extends keyof FormularioDesligamento>(
    campo: K,
    valor: FormularioDesligamento[K],
  ): void {
    this.formDesligamento.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrirEvento(): void {
    this.formEvento.set({ ...EVENTO_VAZIO });
    this.erroEvento.set(null);
    this.eventoAberto.set(true);
  }

  protected abrirDesligamento(): void {
    this.formDesligamento.set({ ...DESLIGAMENTO_VAZIO });
    this.erroDesligamento.set(null);
    this.desligamentoAberto.set(true);
  }

  protected salvarEvento(): void {
    if (this.salvandoEvento()) return;
    this.salvandoEvento.set(true);
    this.erroEvento.set(null);

    this.api
      .createEvent(this.employeeId, this.eventoParaDto())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.salvandoEvento.set(false);
          this.eventoAberto.set(false);
          this.aviso.set('Evento registrado.');
          this.lista.carregar();
          this.carregarFuncionario();
        },
        error: (falha: unknown) => {
          this.salvandoEvento.set(false);
          this.erroEvento.set(falha);
        },
      });
  }

  protected desligar(): void {
    if (this.desligando()) return;
    this.desligando.set(true);
    this.erroDesligamento.set(null);

    const form = this.formDesligamento();
    const corpo = {
      terminationDate: form.terminationDate,
      reason: form.reason.trim(),
      ...(form.note.trim() !== '' ? { note: form.note.trim() } : {}),
    };

    this.api
      .terminate(this.employeeId, corpo)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (funcionario) => {
          this.desligando.set(false);
          this.desligamentoAberto.set(false);
          this.funcionario.set(funcionario);
          this.aviso.set('Desligamento registrado.');
          this.lista.carregar();
        },
        error: (falha: unknown) => {
          this.desligando.set(false);
          this.erroDesligamento.set(falha);
        },
      });
  }

  private eventoParaDto(): EmployeeEventInput {
    const form = this.formEvento();
    const dto = {
      type: form.type as EmployeeEventInput['type'],
      startDate: form.startDate,
    } as EmployeeEventInput;

    const opcionais: [keyof EmployeeEventInput, string][] = [
      ['endDate', form.endDate],
      ['positionId', form.positionId],
      ['departmentId', form.departmentId],
      ['salary', form.salary],
      ['note', form.note],
    ];
    for (const [chave, valor] of opcionais) {
      const limpo = valor.trim();
      if (limpo !== '') Object.assign(dto, { [chave]: limpo });
    }
    return dto;
  }

  private carregarFuncionario(): void {
    this.api
      .get(this.employeeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (funcionario) => this.funcionario.set(funcionario),
        error: () => this.funcionario.set(null),
      });
  }

  private carregarReferencias(): void {
    if (this.permissoes.pode('positions:READ')) {
      this.estrutura
        .listPositions({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesCargo.set(
              r.data.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })),
            ),
          error: () => this.opcoesCargo.set([]),
        });
    }

    if (this.permissoes.pode('departments:READ')) {
      this.estrutura
        .listDepartments({ pageSize: 100, isActive: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) =>
            this.opcoesDepartamento.set(
              r.data.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })),
            ),
          error: () => this.opcoesDepartamento.set([]),
        });
    }
  }
}
