import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { ApprovalsApiService } from '../core/api/approvals-api.service';
import { RolesApiService } from '../core/api/roles-api.service';
import type { ApprovalThreshold, ApprovalThresholdInput } from '../core/api/types';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatCurrency } from '../core/lib/decimal';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { ConfirmService } from '../ui/confirm.service';
import { DataTable, type Coluna } from '../ui/data-table';
import { DecimalField } from '../ui/decimal-field';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { FILTRO_SITUACAO, consultaPadrao } from './filtros';

interface Formulario {
  operation: string;
  name: string;
  /** Decimais canônicos em string (RN-012): nunca `number` numa regra de valor. */
  minAmount: string | null;
  maxAmount: string | null;
  requiredRoleId: string;
  level: string;
  minApprovers: string;
}

const VAZIO: Formulario = {
  operation: '',
  name: '',
  minAmount: '0.00',
  maxAmount: null,
  requiredRoleId: '',
  level: '1',
  minApprovers: '1',
};

/**
 * Alçadas de aprovação (RF-012 — UI-011).
 *
 * As faixas trafegam como string decimal do campo até o `numeric(18,2)`: é o
 * mesmo motivo do `sge-decimal-field` existir. Um `number` aqui mudaria, por
 * arredondamento, o limite a partir do qual um pagamento precisa de aprovação.
 */
@Component({
  selector: 'sge-approval-thresholds-page',
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
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Administração / Alçadas</p>

    <div class="pagehead">
      <div>
        <h1>Alçadas de aprovação</h1>
        <p>Limites por perfil, processo e faixa de valor (RF-012).</p>
      </div>
      <div class="pagehead__actions">
        @if (permissoes.pode('approval-thresholds:CREATE')) {
          <p-button label="Nova alçada" icon="pi pi-plus" (onClick)="abrir(null)" />
        }
      </div>
    </div>

    <sge-filter-bar
      placeholderBusca="Buscar por processo"
      [valores]="lista.filtros()"
      [filtros]="[FILTRO_SITUACAO]"
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
        mensagemVazia="Nenhuma alçada cadastrada."
        (paginaMudou)="lista.irParaPagina($event.page, $event.pageSize)"
      >
        <ng-template #linha let-item>
          <tr>
            <td>
              {{ item.operation }}
              <span class="secundario">{{ item.name }}</span>
            </td>
            <td>{{ perfis(item) }}</td>
            <td class="coluna--numerica">{{ moeda(item.minAmount) }}</td>
            <td class="coluna--numerica">
              {{ item.maxAmount ? moeda(item.maxAmount) : 'Sem limite' }}
            </td>
            <td class="coluna--numerica">{{ item.level }}</td>
            <td class="coluna--numerica">{{ item.minApprovers }}</td>
            <td>
              <p-tag
                [value]="item.isActive ? 'Ativa' : 'Inativa'"
                [severity]="item.isActive ? 'success' : 'secondary'"
                [rounded]="true"
              />
            </td>
            <td class="acoes">
              @if (permissoes.pode('approval-thresholds:UPDATE')) {
                <p-button
                  label="Editar"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  (onClick)="abrir(item)"
                />
              }
              @if (permissoes.pode('approval-thresholds:DELETE')) {
                <p-button
                  label="Remover"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  (onClick)="remover(item)"
                />
              }
            </td>
          </tr>
        </ng-template>
      </sge-data-table>
    </section>

    <p-dialog
      [visible]="aberto()"
      (visibleChange)="aberto.set($event)"
      [modal]="true"
      [style]="{ width: '38rem' }"
      [header]="editado() ? 'Editar alçada' : 'Nova alçada'"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvar()">
        <sge-text-field
          rotulo="Processo"
          name="operation"
          dica="Ex.: PAGAMENTO, PEDIDO_COMPRA"
          [obrigatorio]="true"
          [ngModel]="form().operation"
          (ngModelChange)="mudar('operation', $event)"
        />
        <sge-text-field
          rotulo="Nome da alçada"
          name="name"
          dica="Vazio usa o nome do processo"
          [ngModel]="form().name"
          (ngModelChange)="mudar('name', $event)"
        />
        <sge-select-field
          rotulo="Perfil aprovador"
          name="requiredRoleId"
          [obrigatorio]="true"
          [opcoes]="opcoesPerfil()"
          [ngModel]="form().requiredRoleId"
          (ngModelChange)="mudar('requiredRoleId', $event ?? '')"
        />
        <sge-decimal-field
          rotulo="Valor mínimo"
          name="minAmount"
          [ngModel]="form().minAmount"
          (ngModelChange)="mudar('minAmount', $event)"
        />
        <sge-decimal-field
          rotulo="Valor máximo"
          name="maxAmount"
          dica="Vazio = sem limite"
          [ngModel]="form().maxAmount"
          (ngModelChange)="mudar('maxAmount', $event)"
        />
        <sge-text-field
          rotulo="Nível"
          name="level"
          dica="Único por processo"
          [ngModel]="form().level"
          (ngModelChange)="mudar('level', $event)"
        />
        <sge-text-field
          rotulo="Aprovadores mínimos"
          name="minApprovers"
          [ngModel]="form().minApprovers"
          (ngModelChange)="mudar('minApprovers', $event)"
        />
      </form>

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
  `,
})
export class ApprovalThresholdsPage {
  private readonly api = inject(ApprovalsApiService);
  private readonly confirmacao = inject(ConfirmService);
  private readonly rolesApi = inject(RolesApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly permissoes = inject(PermissionsService);
  protected readonly FILTRO_SITUACAO = FILTRO_SITUACAO;

  protected readonly colunas: Coluna[] = [
    { campo: 'operation', cabecalho: 'Processo' },
    { campo: 'requiredRoles', cabecalho: 'Perfil', largura: '12rem' },
    { campo: 'minAmount', cabecalho: 'Valor mínimo', numerica: true, largura: '10rem' },
    { campo: 'maxAmount', cabecalho: 'Valor máximo', numerica: true, largura: '10rem' },
    { campo: 'level', cabecalho: 'Nível', numerica: true, largura: '5rem' },
    { campo: 'minApprovers', cabecalho: 'Aprovadores', numerica: true, largura: '7rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '12rem' },
  ];

  protected readonly lista = new ListState<ApprovalThreshold>(
    (consulta) => this.api.list(consulta),
    consultaPadrao,
  );

  protected readonly opcoesPerfil = signal<OpcaoFiltro[]>([]);
  protected readonly aberto = signal(false);
  protected readonly editado = signal<ApprovalThreshold | null>(null);
  protected readonly form = signal<Formulario>({ ...VAZIO });
  protected readonly salvando = signal(false);
  protected readonly erroForm = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  constructor() {
    this.lista.carregar();
    this.carregarPerfis();
  }

  protected moeda(valor: string): string {
    return formatCurrency(valor);
  }

  protected perfis(item: ApprovalThreshold): string {
    return item.requiredRoles.map((p) => p.name).join(', ') || '—';
  }

  protected mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]): void {
    this.form.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrir(item: ApprovalThreshold | null): void {
    this.editado.set(item);
    this.erroForm.set(null);
    this.form.set(
      item
        ? {
            operation: item.operation,
            name: item.name,
            minAmount: item.minAmount,
            maxAmount: item.maxAmount,
            requiredRoleId: item.requiredRoles[0]?.id ?? '',
            level: String(item.level),
            minApprovers: String(item.minApprovers),
          }
        : { ...VAZIO },
    );
    this.aberto.set(true);
  }

  protected salvar(): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erroForm.set(null);

    const alvo = this.editado();
    const corpo = this.paraDto();
    const requisicao = alvo
      ? this.api.update(alvo.id, corpo)
      : this.api.create(corpo as ApprovalThresholdInput);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvando.set(false);
        this.aberto.set(false);
        this.aviso.set(alvo ? 'Alçada atualizada.' : 'Alçada criada.');
        this.lista.carregar();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroForm.set(falha);
      },
    });
  }

  protected async remover(item: ApprovalThreshold): Promise<void> {
    const confirmado = await this.confirmacao.confirmar({
      titulo: 'Remover alçada de aprovação?',
      mensagem:
        'A faixa deixa de exigir aprovação para novos lançamentos. As aprovações já registradas não mudam.',
      rotuloConfirmar: 'Remover',
      destrutivo: true,
    });
    if (!confirmado) return;

    this.aviso.set(null);
    this.api
      .remove(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Alçada de ${item.operation} removida.`);
          this.lista.carregar();
        },
        error: (falha: unknown) => this.lista.erro.set(falha),
      });
  }

  private paraDto(): Partial<ApprovalThresholdInput> {
    const form = this.form();
    const dto: Partial<ApprovalThresholdInput> = {
      operation: form.operation.trim(),
      requiredRoleId: form.requiredRoleId,
      minAmount: form.minAmount ?? '0.00',
      level: Number(form.level) || 1,
      minApprovers: Number(form.minApprovers) || 1,
    };
    const nome = form.name.trim();
    if (nome !== '') dto.name = nome;
    // `maxAmount` ausente é "sem limite"; enviar "" seria recusado pela regex.
    if (form.maxAmount !== null && form.maxAmount !== '') dto.maxAmount = form.maxAmount;
    return dto;
  }

  private carregarPerfis(): void {
    this.rolesApi
      .list({ pageSize: 100, isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) =>
          this.opcoesPerfil.set(resultado.data.map((p) => ({ value: p.id, label: p.name }))),
        error: () => this.opcoesPerfil.set([]),
      });
  }
}
