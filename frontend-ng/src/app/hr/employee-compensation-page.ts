import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { EmployeesApiService } from '../core/api/employees-api.service';
import { PayrollApiService } from '../core/api/payroll-api.service';
import type { Compensation, CompensationInput, Employee, PayrollItemType } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency, formatDecimal } from '../core/lib/decimal';
import { formatDate } from '../core/lib/format';
import { Alert } from '../ui/alert';
import { ConfirmService } from '../ui/confirm.service';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import type { OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { ROTULO_VERBA, severidadeVerba } from './rotulos';

interface FormularioVerba {
  payrollItemId: string;
  amount: string;
  percentage: string;
  effectiveFrom: string;
  effectiveTo: string;
  note: string;
}

const VAZIO: FormularioVerba = {
  payrollItemId: '',
  amount: '',
  percentage: '',
  effectiveFrom: '',
  effectiveTo: '',
  note: '',
};

/**
 * Verbas atribuídas ao funcionário (RF-017 — UI-016).
 *
 * Valor fixo **ou** percentual sobre o salário base: o banco recusa os dois
 * juntos e recusa vigências sobrepostas para a mesma verba. A tela avisa antes
 * de mandar, mas quem decide continua sendo a constraint.
 *
 * "Encerrar" não apaga a atribuição: fecha a vigência, porque a folha das
 * competências anteriores foi apurada com ela.
 */
@Component({
  selector: 'sge-employee-compensation-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    DialogModule,
    TagModule,
    Alert,
    DecimalField,
    ErrorAlert,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">RH / Funcionários / {{ nome() }} / Verbas</p>

    <div class="pagehead">
      <div>
        <h1>Salários, benefícios e descontos</h1>
        <p>{{ subtitulo() }}</p>
      </div>
      <div class="pagehead__actions">
        <p-button
          label="Voltar ao cadastro"
          severity="secondary"
          [outlined]="true"
          [routerLink]="['/rh/funcionarios', employeeId]"
        />
        @if (podeCriar()) {
          <p-button label="Nova verba" icon="pi pi-plus" (onClick)="abrirNova()" />
        }
      </div>
    </div>

    @if (erro(); as falha) {
      <div class="espaco"><sge-error-alert [erro]="falha" /></div>
    }

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    <section class="card table-card espaco">
      @if (verbas().length === 0) {
        <p class="nota">Nenhuma verba atribuída a este funcionário.</p>
      } @else {
        <table class="verbas">
          <thead>
            <tr>
              <th scope="col">Verba</th>
              <th scope="col">Tipo</th>
              <th scope="col" class="coluna--numerica">Valor</th>
              <th scope="col" class="coluna--numerica">Percentual</th>
              <th scope="col">Vigência</th>
              <th scope="col">Observação</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            @for (verba of verbas(); track verba.id) {
              <tr>
                <td>{{ verba.payrollItem.code }} — {{ verba.payrollItem.name }}</td>
                <td>
                  <p-tag
                    [value]="rotuloTipo(verba.payrollItem.type)"
                    [severity]="severidade(verba.payrollItem.type)"
                    [rounded]="true"
                  />
                </td>
                <td class="coluna--numerica">
                  {{ verba.amount ? moeda(verba.amount) : '—' }}
                </td>
                <td class="coluna--numerica">
                  {{ verba.percentage ? percentual(verba.percentage) : '—' }}
                </td>
                <td>{{ vigencia(verba) }}</td>
                <td>{{ verba.note ?? '—' }}</td>
                <td class="acoes">
                  @if (podeEditar()) {
                    <p-button
                      label="Editar"
                      severity="secondary"
                      [text]="true"
                      size="small"
                      (onClick)="abrirEdicao(verba)"
                    />
                  }
                  @if (podeEncerrar() && !verba.effectiveTo) {
                    <p-button
                      label="Encerrar"
                      severity="secondary"
                      [text]="true"
                      size="small"
                      (onClick)="encerrar(verba)"
                    />
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      <p class="nota">
        A vigência encerrada é preservada: a folha das competências anteriores foi apurada com ela.
      </p>
    </section>

    <p-dialog
      [visible]="aberto()"
      (visibleChange)="aberto.set($event)"
      [modal]="true"
      [style]="{ width: '40rem' }"
      [header]="emEdicao() ? 'Editar verba' : 'Nova verba'"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvar()">
        <sge-select-field
          rotulo="Verba"
          name="payrollItemId"
          [opcoes]="opcoesVerba()"
          [obrigatorio]="true"
          [ngModel]="form().payrollItemId"
          (ngModelChange)="mudar('payrollItemId', $event ?? '')"
          [disabled]="emEdicao() !== null"
          dica="A verba não muda: trocá-la seria outra atribuição"
        />
        <sge-decimal-field
          rotulo="Valor fixo"
          name="amount"
          dica="Preencha o valor OU o percentual"
          [ngModel]="form().amount"
          (ngModelChange)="mudar('amount', $event ?? '')"
        />
        <sge-decimal-field
          rotulo="Percentual do salário base"
          name="percentage"
          dica="De 0 a 100"
          [ngModel]="form().percentage"
          (ngModelChange)="mudar('percentage', $event ?? '')"
        />
        <sge-text-field
          rotulo="Início da vigência"
          name="effectiveFrom"
          tipo="date"
          [obrigatorio]="true"
          [ngModel]="form().effectiveFrom"
          (ngModelChange)="mudar('effectiveFrom', $event)"
        />
        <sge-text-field
          rotulo="Fim da vigência"
          name="effectiveTo"
          tipo="date"
          dica="Em branco = sem prazo"
          [ngModel]="form().effectiveTo"
          (ngModelChange)="mudar('effectiveTo', $event)"
        />
        <sge-text-field
          rotulo="Observação"
          name="note"
          [ngModel]="form().note"
          (ngModelChange)="mudar('note', $event)"
        />
      </form>

      @if (conflitoValor()) {
        <sge-alert
          tom="aviso"
          titulo="Informe valor fixo ou percentual — não os dois"
          mensagem="A verba é apurada por um dos dois critérios; o banco recusa a atribuição com ambos preenchidos."
        />
      }

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="aberto.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando() || conflitoValor()"
          (onClick)="salvar()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .formulario {
      padding-top: 0.5rem;
    }
    .verbas {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .verbas th,
    .verbas td {
      padding: 0.5rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .verbas th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .verbas .coluna--numerica {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class EmployeeCompensationPage {
  private readonly api = inject(PayrollApiService);
  private readonly confirmacao = inject(ConfirmService);
  private readonly employees = inject(EmployeesApiService);
  private readonly permissoes = inject(PermissionsService);
  private readonly rota = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly employeeId = this.rota.snapshot.paramMap.get('id') ?? '';

  protected readonly funcionario = signal<Employee | null>(null);
  protected readonly verbas = signal<Compensation[]>([]);
  protected readonly opcoesVerba = signal<OpcaoFiltro[]>([]);
  protected readonly erro = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly aberto = signal(false);
  protected readonly emEdicao = signal<Compensation | null>(null);
  protected readonly form = signal<FormularioVerba>({ ...VAZIO });
  protected readonly salvando = signal(false);
  protected readonly erroForm = signal<unknown>(null);

  protected readonly nome = computed(() => this.funcionario()?.name ?? 'Funcionário');

  protected readonly subtitulo = computed(() => {
    const registro = this.funcionario();
    if (!registro) return 'Verbas fixas e variáveis do funcionário (RF-017).';
    const salario = registro.baseSalary ? formatCurrency(registro.baseSalary) : 'sem salário base';
    return `Matrícula ${registro.registration} · salário base ${salario}.`;
  });

  /** Valor e percentual juntos: o banco recusa, então a tela barra antes. */
  protected readonly conflitoValor = computed(() => {
    const form = this.form();
    return form.amount.trim() !== '' && form.percentage.trim() !== '';
  });

  protected readonly podeCriar = () => this.permissoes.pode('compensation:CREATE');
  protected readonly podeEditar = () => this.permissoes.pode('compensation:UPDATE');
  protected readonly podeEncerrar = () => this.permissoes.pode('compensation:DELETE');

  constructor() {
    this.carregar();
    this.carregarFuncionario();
    this.carregarCatalogo();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected percentual(valor: string): string {
    return `${formatDecimal(valor)}%`;
  }

  protected rotuloTipo(tipo: PayrollItemType): string {
    return ROTULO_VERBA[tipo] ?? tipo;
  }

  protected severidade(tipo: PayrollItemType) {
    return severidadeVerba(tipo);
  }

  protected vigencia(verba: Compensation): string {
    const inicio = formatDate(verba.effectiveFrom);
    return verba.effectiveTo ? `${inicio} a ${formatDate(verba.effectiveTo)}` : `desde ${inicio}`;
  }

  protected mudar<K extends keyof FormularioVerba>(campo: K, valor: FormularioVerba[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrirNova(): void {
    this.emEdicao.set(null);
    this.form.set({ ...VAZIO });
    this.erroForm.set(null);
    this.aberto.set(true);
  }

  protected abrirEdicao(verba: Compensation): void {
    this.emEdicao.set(verba);
    this.erroForm.set(null);
    this.form.set({
      payrollItemId: verba.payrollItemId,
      amount: verba.amount ?? '',
      percentage: verba.percentage ?? '',
      effectiveFrom: verba.effectiveFrom.slice(0, 10),
      effectiveTo: (verba.effectiveTo ?? '').slice(0, 10),
      note: verba.note ?? '',
    });
    this.aberto.set(true);
  }

  protected salvar(): void {
    if (this.salvando() || this.conflitoValor()) return;
    this.salvando.set(true);
    this.erroForm.set(null);

    const alvo = this.emEdicao();
    const corpo = this.paraDto();
    const requisicao = alvo
      ? this.api.updateCompensation(this.employeeId, alvo.id, corpo)
      : this.api.createCompensation(this.employeeId, corpo as CompensationInput);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvando.set(false);
        this.aberto.set(false);
        this.aviso.set(alvo ? 'Verba atualizada.' : 'Verba atribuída.');
        this.carregar();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroForm.set(falha);
      },
    });
  }

  protected async encerrar(verba: Compensation): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Encerrar verba do funcionário?',
      mensagem:
        'A verba deixa de entrar nas próximas folhas. As folhas já processadas são preservadas.',
      rotuloConfirmar: 'Encerrar',
      destrutivo: true,
    });
    if (!confirmado) return;

    this.api
      .closeCompensation(this.employeeId, verba.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Vigência de ${verba.payrollItem.name} encerrada.`);
          this.carregar();
        },
        error: (falha: unknown) => this.erro.set(falha),
      });
  }

  private paraDto(): Partial<CompensationInput> {
    const form = this.form();
    const dto: Partial<CompensationInput> = { effectiveFrom: form.effectiveFrom };
    if (this.emEdicao() === null) dto.payrollItemId = form.payrollItemId;

    const opcionais: [keyof CompensationInput, string][] = [
      ['amount', form.amount],
      ['percentage', form.percentage],
      ['effectiveTo', form.effectiveTo],
      ['note', form.note],
    ];
    for (const [chave, valor] of opcionais) {
      const limpo = valor.trim();
      if (limpo !== '') Object.assign(dto, { [chave]: limpo });
    }
    return dto;
  }

  private carregar(): void {
    this.erro.set(null);
    this.api
      .listCompensation(this.employeeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (verbas) => this.verbas.set(verbas),
        error: (falha: unknown) => {
          this.verbas.set([]);
          this.erro.set(falha);
        },
      });
  }

  private carregarFuncionario(): void {
    this.employees
      .get(this.employeeId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (funcionario) => this.funcionario.set(funcionario),
        error: () => this.funcionario.set(null),
      });
  }

  private carregarCatalogo(): void {
    if (!this.permissoes.pode('payroll-items:READ')) return;
    this.api
      .listItems({ pageSize: 100, isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) =>
          this.opcoesVerba.set(
            r.data.map((v) => ({ value: v.id, label: `${v.code} — ${v.name}` })),
          ),
        error: () => this.opcoesVerba.set([]),
      });
  }
}
