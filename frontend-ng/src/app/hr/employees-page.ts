import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { EmployeesApiService } from '../core/api/employees-api.service';
import { HrStructureApiService } from '../core/api/hr-structure-api.service';
import type { Employee, EmployeeStatus } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatDate } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type OpcaoFiltro } from '../ui/filter-bar';
import {
  FILTRO_STATUS_FUNCIONARIO,
  ROTULO_STATUS,
  consultaFuncionario,
  severidadeStatus,
} from './rotulos';

/** Situações contadas na faixa de indicadores do topo. */
const CONTADORES: { status: EmployeeStatus; rotulo: string }[] = [
  { status: 'ATIVO', rotulo: 'Ativos' },
  { status: 'FERIAS', rotulo: 'Em férias' },
  { status: 'AFASTADO', rotulo: 'Afastados' },
  { status: 'DESLIGADO', rotulo: 'Desligados' },
];

/**
 * Funcionários (RF-013/RF-016 — UI-013).
 *
 * A faixa de indicadores do Figma sai de quatro consultas de contagem
 * (`pageSize=1`, só o `total` interessa), disparadas uma vez ao abrir a tela —
 * não uma por linha. O backend não expõe um resumo de RH, e inventar um seria
 * task de outra sprint.
 */
@Component({
  selector: 'sge-employees-page',
  imports: [RouterLink, ButtonModule, TagModule, DataTable, ErrorAlert, FilterBar],
  template: `
    <p class="crumb">RH / Funcionários</p>

    <div class="pagehead">
      <div>
        <h1>Funcionários</h1>
        <p>Cadastro funcional com dados profissionais e bancários (RF-013).</p>
      </div>
      <div class="pagehead__actions">
        @if (podeCriar()) {
          <p-button label="Novo funcionário" icon="pi pi-plus" routerLink="novo" />
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
      placeholderBusca="Buscar por nome, CPF ou matrícula"
      [valores]="lista.filtros()"
      [filtros]="[FILTRO_STATUS_FUNCIONARIO, filtroDepartamento()]"
      (mudou)="lista.aplicarFiltros($event)"
    />

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
        [mensagemVazia]="
          lista.temFiltro()
            ? 'Nenhum funcionário encontrado com esses filtros.'
            : 'Nenhum funcionário cadastrado.'
        "
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-funcionario>
          <tr>
            <td>{{ funcionario.registration }}</td>
            <td>{{ funcionario.name }}</td>
            <td>{{ funcionario.position?.name ?? '—' }}</td>
            <td>{{ funcionario.department?.name ?? '—' }}</td>
            <td>{{ data(funcionario.hireDate) }}</td>
            <td>
              <p-tag
                [value]="rotulo(funcionario.status)"
                [severity]="severidade(funcionario.status)"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              <p-button
                label="Abrir"
                severity="secondary"
                [text]="true"
                size="small"
                [routerLink]="[funcionario.id]"
              />
              @if (podeVerHistorico()) {
                <p-button
                  label="Histórico"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  [routerLink]="[funcionario.id, 'historico']"
                />
              }
              @if (podeVerVerbas()) {
                <p-button
                  label="Verbas"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  [routerLink]="[funcionario.id, 'verbas']"
                />
              }
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>
  `,
})
export class EmployeesPage {
  private readonly api = inject(EmployeesApiService);
  private readonly estrutura = inject(HrStructureApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_STATUS_FUNCIONARIO = FILTRO_STATUS_FUNCIONARIO;

  protected readonly colunas: Coluna[] = [
    { campo: 'registration', cabecalho: 'Matrícula', largura: '8rem' },
    { campo: 'name', cabecalho: 'Nome' },
    { campo: 'position', cabecalho: 'Cargo' },
    { campo: 'department', cabecalho: 'Departamento' },
    { campo: 'hireDate', cabecalho: 'Admissão', largura: '8rem' },
    { campo: 'status', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '16rem' },
  ];

  protected readonly lista = new ListState<Employee>(
    (consulta) => this.api.list(consulta),
    consultaFuncionario,
  );

  protected readonly contadores = signal<{ rotulo: string; total: number }[]>([]);
  protected readonly opcoesDepartamento = signal<OpcaoFiltro[]>([]);

  protected readonly podeCriar = () => this.permissoes.pode('employees:CREATE');
  protected readonly podeVerHistorico = () => this.permissoes.pode('employee-events:READ');
  protected readonly podeVerVerbas = () => this.permissoes.pode('compensation:READ');

  constructor() {
    this.lista.carregar();
    this.carregarContadores();
    this.carregarDepartamentos();
  }

  protected filtroDepartamento() {
    return {
      name: 'departmentId',
      label: 'Departamento',
      placeholder: 'Departamento',
      options: this.opcoesDepartamento(),
    };
  }

  protected data(valor: string): string {
    return formatDate(valor);
  }

  protected rotulo(status: EmployeeStatus): string {
    return ROTULO_STATUS[status];
  }

  protected severidade(status: EmployeeStatus) {
    return severidadeStatus(status);
  }

  /** Quatro contagens fixas; falha em qualquer uma some com a faixa inteira. */
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

  private carregarDepartamentos(): void {
    if (!this.permissoes.pode('departments:READ')) return;
    this.estrutura
      .listDepartments({ pageSize: 100, isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) =>
          this.opcoesDepartamento.set(
            resultado.data.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` })),
          ),
        error: () => this.opcoesDepartamento.set([]),
      });
  }
}
