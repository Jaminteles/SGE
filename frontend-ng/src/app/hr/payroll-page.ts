import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';

import { PayrollApiService } from '../core/api/payroll-api.service';
import type {
  PayrollItem,
  PayrollItemInput,
  PayrollItemType,
  PayrollSummary,
} from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { ListState } from '../core/lib/list-state';
import { FILTRO_SITUACAO, consultaPadrao } from '../admin/filtros';
import { Alert } from '../ui/alert';
import { ConfirmService } from '../ui/confirm.service';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { OPCOES_VERBA, ROTULO_VERBA, severidadeVerba } from './rotulos';

type Secao = 'consolidacao' | 'catalogo';

/** Uma verba apurada para um funcionário — a consolidação achatada em linhas. */
interface LinhaConsolidada {
  chave: string;
  funcionario: string;
  verba: string;
  tipo: PayrollItemType;
  valor: string;
  incide: string;
}

interface FormularioVerba {
  code: string;
  name: string;
  type: string;
  affectsInss: boolean;
  affectsIrrf: boolean;
  affectsFgts: boolean;
}

const VERBA_VAZIA: FormularioVerba = {
  code: '',
  name: '',
  type: '',
  affectsInss: false,
  affectsIrrf: false,
  affectsFgts: false,
};

/** Competência corrente no formato `YYYY-MM`. */
function competenciaAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Salários, benefícios e descontos (RF-017/RF-021 — UI-016).
 *
 * Duas visões: a **consolidação** por competência, que é o que o Figma mostra —
 * o retrato da folha do mês vindo de `GET /payroll/summary` — e o **catálogo**
 * de verbas da empresa, que alimenta as atribuições por funcionário.
 *
 * A consolidação vem inteira numa resposta (o backend não pagina esse recurso),
 * então o filtro por tipo é aplicado sobre o que já está em memória. Não é
 * filtragem de listagem escondendo registro: é recorte de um documento único.
 *
 * Cada consulta da consolidação é registrada como EXPORTAÇÃO na trilha pelo
 * backend — é o retrato salarial da empresa saindo pela API.
 */
@Component({
  selector: 'sge-payroll-page',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    InputTextModule,
    SelectModule,
    TagModule,
    Alert,
    DataTable,
    ErrorAlert,
    FilterBar,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">RH / Verbas</p>

    <div class="pagehead">
      <div>
        <h1>Salários, benefícios e descontos</h1>
        <p>Verbas fixas e variáveis consolidadas para a folha (RF-017).</p>
      </div>
      <div class="pagehead__actions">
        @if (secao() === 'catalogo' && podeCriarVerba()) {
          <p-button label="Nova verba" icon="pi pi-plus" (onClick)="abrirNovaVerba()" />
        }
      </div>
    </div>

    <nav class="secoes" aria-label="Visão das verbas">
      @if (podeVerConsolidacao()) {
        <button
          type="button"
          class="secoes__item"
          [class.secoes__item--ativa]="secao() === 'consolidacao'"
          (click)="trocar('consolidacao')"
        >
          Consolidação da folha
        </button>
      }
      @if (podeVerCatalogo()) {
        <button
          type="button"
          class="secoes__item"
          [class.secoes__item--ativa]="secao() === 'catalogo'"
          (click)="trocar('catalogo')"
        >
          Catálogo de verbas
        </button>
      }
    </nav>

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    @if (secao() === 'consolidacao') {
      <div class="kpis">
        <div class="kpi">
          <p class="kpi__label">Proventos da competência</p>
          <p class="kpi__value">{{ moeda(totais().earnings) }}</p>
          <p class="kpi__detail">{{ totais().employees }} funcionário(s)</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Descontos</p>
          <p class="kpi__value">{{ moeda(totais().deductions) }}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Líquido da folha</p>
          <p class="kpi__value">{{ moeda(totais().net) }}</p>
          <p class="kpi__detail">competência {{ competencia() }}</p>
        </div>
        <div class="kpi">
          <p class="kpi__label">Encargos provisionados</p>
          <p class="kpi__value">{{ moeda(totais().employerCharges) }}</p>
        </div>
      </div>

      <div class="barra-competencia card">
        <label class="campo">
          <span class="campo__rotulo">Competência</span>
          <input
            pInputText
            id="competencia"
            type="month"
            class="campo__controle"
            [ngModel]="competencia()"
            (ngModelChange)="mudarCompetencia($event)"
            name="competencia"
          />
        </label>
        <p-select
          [options]="OPCOES_VERBA"
          optionLabel="label"
          optionValue="value"
          [showClear]="true"
          placeholder="Tipo de verba"
          ariaLabel="Tipo de verba"
          [ngModel]="tipoFiltrado()"
          (ngModelChange)="tipoFiltrado.set($event ?? '')"
          name="tipo"
        />
      </div>

      @if (erroConsolidacao(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }

      <section class="card table-card espaco">
        @if (linhas().length === 0) {
          <p class="nota">Nenhuma verba apurada nesta competência.</p>
        } @else {
          <table class="consolidacao">
            <thead>
              <tr>
                <th scope="col">Funcionário</th>
                <th scope="col">Verba</th>
                <th scope="col">Tipo</th>
                <th scope="col" class="coluna--numerica">Valor</th>
                <th scope="col">Incide</th>
              </tr>
            </thead>
            <tbody>
              @for (linha of linhas(); track linha.chave) {
                <tr>
                  <td>{{ linha.funcionario }}</td>
                  <td>{{ linha.verba }}</td>
                  <td>
                    <p-tag
                      [value]="rotuloVerba(linha.tipo)"
                      [severity]="severidade(linha.tipo)"
                      [rounded]="true"
                    />
                  </td>
                  <td class="coluna--numerica">{{ moeda(linha.valor) }}</td>
                  <td>{{ linha.incide }}</td>
                </tr>
              }
            </tbody>
          </table>
          <p class="nota">
            {{ linhas().length }} lançamento(s) na competência {{ competencia() }}.
          </p>
        }
      </section>
    } @else {
      <sge-filter-bar
        placeholderBusca="Buscar verba por nome ou código"
        [valores]="catalogo.filtros()"
        [filtros]="[FILTRO_SITUACAO]"
        (mudou)="catalogo.aplicarFiltros($event)"
      />

      @if (catalogo.erro(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }

      <section class="card table-card espaco">
        <sge-data-table
          [colunas]="colunasCatalogo"
          [linhas]="catalogo.linhas()"
          [total]="catalogo.total()"
          [pagina]="catalogo.pagina()"
          [tamanhoPagina]="catalogo.tamanhoPagina()"
          [carregando]="catalogo.carregando()"
          mensagemVazia="Nenhuma verba cadastrada."
          (paginaMudou)="catalogo.irParaPagina($event.page, $event.pageSize)"
        >
          <ng-template #linha let-verba>
            <tr>
              <td>{{ verba.code }}</td>
              <td>{{ verba.name }}</td>
              <td>
                <p-tag
                  [value]="rotuloVerba(verba.type)"
                  [severity]="severidade(verba.type)"
                  [rounded]="true"
                />
              </td>
              <td>{{ incidencias(verba) }}</td>
              <td>
                <p-tag
                  [value]="verba.isActive ? 'Ativa' : 'Inativa'"
                  [severity]="verba.isActive ? 'success' : 'secondary'"
                  [rounded]="true"
                />
              </td>
              <td class="acoes">
                @if (podeEditarVerba()) {
                  <p-button
                    label="Editar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="abrirEdicaoVerba(verba)"
                  />
                }
                @if (podeInativarVerba() && verba.isActive) {
                  <p-button
                    label="Inativar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="inativarVerba(verba)"
                  />
                }
              </td>
            </tr>
          </ng-template>
        </sge-data-table>
      </section>
    }

    <p-dialog
      [visible]="verbaAberta()"
      (visibleChange)="verbaAberta.set($event)"
      [modal]="true"
      [style]="{ width: '40rem' }"
      [header]="verbaEmEdicao() ? 'Editar verba' : 'Nova verba'"
    >
      @if (erroVerba(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvarVerba()">
        <sge-text-field
          rotulo="Código"
          name="code"
          [obrigatorio]="true"
          [ngModel]="formVerba().code"
          (ngModelChange)="mudarVerba('code', $event)"
        />
        <sge-text-field
          rotulo="Nome"
          name="name"
          [obrigatorio]="true"
          [ngModel]="formVerba().name"
          (ngModelChange)="mudarVerba('name', $event)"
        />
        <sge-select-field
          rotulo="Tipo"
          name="type"
          [opcoes]="OPCOES_VERBA"
          [obrigatorio]="true"
          [ngModel]="formVerba().type"
          (ngModelChange)="mudarVerba('type', $event ?? '')"
        />
        <label class="incidencia">
          <p-checkbox
            name="affectsInss"
            [binary]="true"
            [ngModel]="formVerba().affectsInss"
            (ngModelChange)="mudarVerba('affectsInss', $event)"
          />
          <span>Compõe a base de INSS</span>
        </label>
        <label class="incidencia">
          <p-checkbox
            name="affectsIrrf"
            [binary]="true"
            [ngModel]="formVerba().affectsIrrf"
            (ngModelChange)="mudarVerba('affectsIrrf', $event)"
          />
          <span>Compõe a base de IRRF</span>
        </label>
        <label class="incidencia">
          <p-checkbox
            name="affectsFgts"
            [binary]="true"
            [ngModel]="formVerba().affectsFgts"
            (ngModelChange)="mudarVerba('affectsFgts', $event)"
          />
          <span>Compõe a base de FGTS</span>
        </label>
      </form>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="verbaAberta.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvandoVerba()"
          [disabled]="salvandoVerba()"
          (onClick)="salvarVerba()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .secoes {
      display: flex;
      gap: 0.25rem;
      margin-bottom: 0.75rem;
    }
    .secoes__item {
      padding: 0.35rem 0.75rem;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--p-text-muted-color);
      background: transparent;
      border: 1px solid var(--p-content-border-color);
      border-radius: var(--p-content-border-radius);
      cursor: pointer;
    }
    .secoes__item--ativa {
      color: var(--p-primary-color);
      border-color: var(--p-primary-color);
    }
    .barra-competencia {
      display: flex;
      align-items: flex-end;
      gap: 0.75rem;
      padding: 0.75rem 0.875rem;
    }
    .formulario {
      padding-top: 0.5rem;
    }
    .incidencia {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--p-text-color);
    }
    .consolidacao {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .consolidacao th,
    .consolidacao td {
      padding: 0.5rem 0.6rem;
      text-align: left;
      border-bottom: 1px solid var(--p-content-border-color);
    }
    .consolidacao th {
      color: var(--p-text-muted-color);
      font-weight: 500;
    }
    .consolidacao .coluna--numerica {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class PayrollPage {
  private readonly api = inject(PayrollApiService);
  private readonly confirmacao = inject(ConfirmService);
  private readonly permissoes = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly FILTRO_SITUACAO = FILTRO_SITUACAO;
  protected readonly OPCOES_VERBA = OPCOES_VERBA;

  protected readonly colunasCatalogo: Coluna[] = [
    { campo: 'code', cabecalho: 'Código', largura: '8rem' },
    { campo: 'name', cabecalho: 'Verba' },
    { campo: 'type', cabecalho: 'Tipo', largura: '9rem' },
    { campo: 'incidencias', cabecalho: 'Incide sobre', largura: '14rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '11rem' },
  ];

  protected readonly catalogo = new ListState<PayrollItem>(
    (consulta) => this.api.listItems(consulta),
    consultaPadrao,
  );

  protected readonly secao = signal<Secao>('consolidacao');
  protected readonly aviso = signal<string | null>(null);

  protected readonly competencia = signal(competenciaAtual());
  protected readonly tipoFiltrado = signal('');
  protected readonly consolidacao = signal<PayrollSummary | null>(null);
  protected readonly erroConsolidacao = signal<unknown>(null);

  protected readonly verbaAberta = signal(false);
  protected readonly verbaEmEdicao = signal<PayrollItem | null>(null);
  protected readonly formVerba = signal<FormularioVerba>({ ...VERBA_VAZIA });
  protected readonly salvandoVerba = signal(false);
  protected readonly erroVerba = signal<unknown>(null);

  protected readonly podeVerConsolidacao = () => this.permissoes.pode('payroll:READ');
  protected readonly podeVerCatalogo = () => this.permissoes.pode('payroll-items:READ');
  protected readonly podeCriarVerba = () => this.permissoes.pode('payroll-items:CREATE');
  protected readonly podeEditarVerba = () => this.permissoes.pode('payroll-items:UPDATE');
  protected readonly podeInativarVerba = () => this.permissoes.pode('payroll-items:DELETE');

  protected readonly totais = computed(
    () =>
      this.consolidacao()?.totals ?? {
        employees: 0,
        earnings: '0.00',
        deductions: '0.00',
        employerCharges: '0.00',
        net: '0.00',
      },
  );

  protected readonly linhas = computed<LinhaConsolidada[]>(() => {
    const resumo = this.consolidacao();
    if (!resumo) return [];
    const tipo = this.tipoFiltrado();
    const linhas: LinhaConsolidada[] = [];
    for (const funcionario of resumo.employees) {
      for (const [indice, linha] of funcionario.lines.entries()) {
        if (tipo !== '' && linha.type !== tipo) continue;
        linhas.push({
          chave: `${funcionario.employeeId}:${linha.payrollItemId ?? linha.code}:${indice}`,
          funcionario: funcionario.name,
          verba: linha.name,
          tipo: linha.type,
          valor: linha.amount,
          incide: this.incidencias(linha),
        });
      }
    }
    return linhas;
  });

  constructor() {
    if (!this.podeVerConsolidacao()) {
      this.secao.set('catalogo');
      this.catalogo.carregar();
    } else {
      this.carregarConsolidacao();
    }
  }

  protected trocar(secao: Secao): void {
    if (this.secao() === secao) return;
    this.secao.set(secao);
    this.aviso.set(null);
    if (secao === 'consolidacao') this.carregarConsolidacao();
    else this.catalogo.carregar();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected rotuloVerba(tipo: PayrollItemType): string {
    return ROTULO_VERBA[tipo] ?? tipo;
  }

  protected severidade(tipo: PayrollItemType) {
    return severidadeVerba(tipo);
  }

  protected incidencias(item: {
    affectsInss: boolean;
    affectsIrrf: boolean;
    affectsFgts: boolean;
  }): string {
    const bases = [
      item.affectsInss ? 'INSS' : null,
      item.affectsIrrf ? 'IRRF' : null,
      item.affectsFgts ? 'FGTS' : null,
    ].filter(Boolean);
    return bases.length > 0 ? bases.join(' / ') : '—';
  }

  protected mudarCompetencia(valor: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) return;
    this.competencia.set(valor);
    this.carregarConsolidacao();
  }

  protected mudarVerba<K extends keyof FormularioVerba>(campo: K, valor: FormularioVerba[K]): void {
    this.formVerba.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrirNovaVerba(): void {
    this.verbaEmEdicao.set(null);
    this.formVerba.set({ ...VERBA_VAZIA });
    this.erroVerba.set(null);
    this.verbaAberta.set(true);
  }

  protected abrirEdicaoVerba(verba: PayrollItem): void {
    this.verbaEmEdicao.set(verba);
    this.erroVerba.set(null);
    this.formVerba.set({
      code: verba.code,
      name: verba.name,
      type: verba.type,
      affectsInss: verba.affectsInss,
      affectsIrrf: verba.affectsIrrf,
      affectsFgts: verba.affectsFgts,
    });
    this.verbaAberta.set(true);
  }

  protected salvarVerba(): void {
    if (this.salvandoVerba()) return;
    this.salvandoVerba.set(true);
    this.erroVerba.set(null);

    const alvo = this.verbaEmEdicao();
    const form = this.formVerba();
    const corpo: PayrollItemInput = {
      code: form.code.trim(),
      name: form.name.trim(),
      type: form.type as PayrollItemType,
      affectsInss: form.affectsInss,
      affectsIrrf: form.affectsIrrf,
      affectsFgts: form.affectsFgts,
    };

    const requisicao = alvo ? this.api.updateItem(alvo.id, corpo) : this.api.createItem(corpo);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvandoVerba.set(false);
        this.verbaAberta.set(false);
        this.aviso.set(alvo ? 'Verba atualizada.' : 'Verba cadastrada.');
        this.catalogo.carregar();
      },
      error: (falha: unknown) => {
        this.salvandoVerba.set(false);
        this.erroVerba.set(falha);
      },
    });
  }

  protected async inativarVerba(verba: PayrollItem): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Inativar verba de folha?',
      mensagem:
        'A verba deixa de ser oferecida em novas folhas. As folhas já processadas não mudam.',
      rotuloConfirmar: 'Inativar',
      destrutivo: true,
    });
    if (!confirmado) return;

    this.api
      .inactivateItem(verba.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Verba ${verba.name} inativada.`);
          this.catalogo.carregar();
        },
        error: (falha: unknown) => this.catalogo.erro.set(falha),
      });
  }

  private carregarConsolidacao(): void {
    this.erroConsolidacao.set(null);
    this.api
      .summary({ competence: this.competencia() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resumo) => this.consolidacao.set(resumo),
        error: (falha: unknown) => {
          this.consolidacao.set(null);
          this.erroConsolidacao.set(falha);
        },
      });
  }
}
