import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';

import { BranchesApiService } from '../core/api/branches-api.service';
import { RolesApiService } from '../core/api/roles-api.service';
import { UsersApiService } from '../core/api/users-api.service';
import type { CreateUserInput, MembershipRow, User } from '../core/api/types';
import { AuthService } from '../core/auth/auth.service';
import { PermissionsService } from '../core/authz/permissions.service';
import { formatDateTime } from '../core/lib/format';
import { ListState } from '../core/lib/list-state';
import { Alert } from '../ui/alert';
import { DataTable, type Coluna } from '../ui/data-table';
import { ErrorAlert } from '../ui/error-alert';
import { FilterBar, type OpcaoFiltro } from '../ui/filter-bar';
import { SelectField } from '../ui/select-field';
import { TextField } from '../ui/text-field';
import { FILTRO_SITUACAO, consultaPadrao } from './filtros';

interface FormVinculo {
  userId: string;
  roleId: string;
  branchId: string;
  isDefault: boolean;
  isActive: boolean;
}

interface FormUsuario {
  name: string;
  email: string;
  password: string;
  phone: string;
  isActive: boolean;
}

/**
 * Usuários e vínculos com a empresa (RF-004 / RF-007 — UI-009).
 *
 * São dois níveis de autorização: o vínculo (`memberships`) pertence à empresa
 * ativa; o cadastro de usuário (`users`) é de plataforma e só o super admin
 * abre. Por isso a aba de usuários só aparece para ele — e, sem ela, o vínculo
 * pede o identificador do usuário em vez de uma lista que a API recusaria.
 */
@Component({
  selector: 'sge-users-page',
  imports: [
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    TagModule,
    Alert,
    DataTable,
    ErrorAlert,
    FilterBar,
    SelectField,
    TextField,
  ],
  template: `
    <p class="crumb">Administração / Usuários</p>

    <div class="pagehead">
      <div>
        <h1>Usuários</h1>
        <p>Usuários e vínculos com empresa e perfil (RF-004/RF-007).</p>
      </div>
      <div class="pagehead__actions">
        @if (aba() === 'vinculos' && permissoes.pode('memberships:CREATE')) {
          <p-button label="Novo vínculo" icon="pi pi-plus" (onClick)="abrirVinculo(null)" />
        }
        @if (aba() === 'usuarios') {
          <p-button label="Novo usuário" icon="pi pi-plus" (onClick)="abrirUsuario(null)" />
        }
      </div>
    </div>

    @if (superAdmin()) {
      <nav class="segmentos" aria-label="Coleções de usuários">
        <button
          type="button"
          class="segmentos__item"
          [class.segmentos__item--ativo]="aba() === 'vinculos'"
          [attr.aria-pressed]="aba() === 'vinculos'"
          (click)="trocarAba('vinculos')"
        >
          Vínculos desta empresa
        </button>
        <button
          type="button"
          class="segmentos__item"
          [class.segmentos__item--ativo]="aba() === 'usuarios'"
          [attr.aria-pressed]="aba() === 'usuarios'"
          (click)="trocarAba('usuarios')"
        >
          Usuários da plataforma
        </button>
      </nav>
    }

    @if (aviso(); as texto) {
      <div class="espaco"><sge-alert tom="sucesso" [titulo]="texto" /></div>
    }

    @if (aba() === 'vinculos') {
      <sge-filter-bar
        placeholderBusca="Buscar por nome ou e-mail"
        [valores]="vinculos.filtros()"
        [filtros]="[FILTRO_SITUACAO]"
        (mudou)="vinculos.aplicarFiltros($event)"
      />

      @if (vinculos.erro(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }

      <section class="card table-card espaco">
        <sge-data-table
          [colunas]="colunasVinculo"
          [linhas]="vinculos.linhas()"
          [total]="vinculos.total()"
          [pagina]="vinculos.pagina()"
          [tamanhoPagina]="vinculos.tamanhoPagina()"
          [carregando]="vinculos.carregando()"
          mensagemVazia="Nenhum usuário vinculado a esta empresa."
          (paginaMudou)="vinculos.irParaPagina($event.page, $event.pageSize)"
        >
          <ng-template #linha let-item>
            <tr>
              <td>
                {{ item.user.name }}
                @if (item.isDefault) {
                  <span class="secundario">Empresa padrão do usuário</span>
                }
              </td>
              <td>{{ item.user.email }}</td>
              <td>{{ item.role.name }}</td>
              <td>{{ item.branch ? item.branch.name : 'Todas as filiais' }}</td>
              <td>
                <p-tag
                  [value]="item.isActive ? 'Ativo' : 'Inativo'"
                  [severity]="item.isActive ? 'success' : 'secondary'"
                  [rounded]="true"
                />
              </td>
              <td class="acoes">
                @if (permissoes.pode('memberships:UPDATE')) {
                  <p-button
                    label="Editar"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="abrirVinculo(item)"
                  />
                }
                @if (permissoes.pode('memberships:DELETE')) {
                  <p-button
                    label="Remover"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="removerVinculo(item)"
                  />
                }
              </td>
            </tr>
          </ng-template>
        </sge-data-table>
      </section>
    }

    @if (aba() === 'usuarios') {
      <sge-filter-bar
        placeholderBusca="Buscar por nome ou e-mail"
        [valores]="usuarios.filtros()"
        [filtros]="[FILTRO_SITUACAO]"
        (mudou)="usuarios.aplicarFiltros($event)"
      />

      @if (usuarios.erro(); as falha) {
        <div class="espaco"><sge-error-alert [erro]="falha" /></div>
      }

      <section class="card table-card espaco">
        <sge-data-table
          [colunas]="colunasUsuario"
          [linhas]="usuarios.linhas()"
          [total]="usuarios.total()"
          [pagina]="usuarios.pagina()"
          [tamanhoPagina]="usuarios.tamanhoPagina()"
          [carregando]="usuarios.carregando()"
          mensagemVazia="Nenhum usuário encontrado."
          (paginaMudou)="usuarios.irParaPagina($event.page, $event.pageSize)"
        >
          <ng-template #linha let-item>
            <tr>
              <td>{{ item.name }}</td>
              <td>{{ item.email }}</td>
              <td>{{ item.lastLoginAt ? dataHora(item.lastLoginAt) : '—' }}</td>
              <td>{{ item.isSuperAdmin ? 'Plataforma' : 'Empresa' }}</td>
              <td>
                <p-tag
                  [value]="item.isActive ? 'Ativo' : 'Inativo'"
                  [severity]="item.isActive ? 'success' : 'secondary'"
                  [rounded]="true"
                />
              </td>
              <td class="acoes">
                <p-button
                  label="Editar"
                  severity="secondary"
                  [text]="true"
                  size="small"
                  (onClick)="abrirUsuario(item)"
                />
              </td>
            </tr>
          </ng-template>
        </sge-data-table>
      </section>
    }

    <p-dialog
      [visible]="dialogoVinculo()"
      (visibleChange)="dialogoVinculo.set($event)"
      [modal]="true"
      [style]="{ width: '34rem' }"
      [header]="vinculoEditado() ? 'Editar vínculo' : 'Novo vínculo'"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvarVinculo()">
        @if (vinculoEditado(); as atual) {
          <div class="campo">
            <span class="campo__rotulo">Usuário</span>
            <strong class="leitura">{{ atual.user.name }}</strong>
            <span class="campo__dica">{{ atual.user.email }}</span>
          </div>
        } @else if (superAdmin()) {
          <sge-select-field
            rotulo="Usuário"
            name="userId"
            [obrigatorio]="true"
            [opcoes]="opcoesUsuario()"
            [ngModel]="formVinculo().userId"
            (ngModelChange)="mudarVinculo('userId', $event ?? '')"
          />
        } @else {
          <sge-text-field
            rotulo="Usuário"
            name="userId"
            dica="Identificador (UUID) do usuário já cadastrado na plataforma"
            [obrigatorio]="true"
            [ngModel]="formVinculo().userId"
            (ngModelChange)="mudarVinculo('userId', $event)"
          />
        }

        @if (opcoesPerfil().length > 0) {
          <sge-select-field
            rotulo="Perfil de acesso"
            name="roleId"
            [obrigatorio]="true"
            [opcoes]="opcoesPerfil()"
            [ngModel]="formVinculo().roleId"
            (ngModelChange)="mudarVinculo('roleId', $event ?? '')"
          />
        } @else {
          <sge-text-field
            rotulo="Perfil de acesso"
            name="roleId"
            dica="Identificador (UUID) do perfil"
            [obrigatorio]="true"
            [ngModel]="formVinculo().roleId"
            (ngModelChange)="mudarVinculo('roleId', $event)"
          />
        }

        <sge-select-field
          rotulo="Filial"
          name="branchId"
          placeholder="Todas as filiais"
          [opcoes]="opcoesFilial()"
          [ngModel]="formVinculo().branchId"
          (ngModelChange)="mudarVinculo('branchId', $event ?? '')"
        />

        <label class="marcador">
          <p-checkbox
            name="isDefault"
            [binary]="true"
            [ngModel]="formVinculo().isDefault"
            (ngModelChange)="mudarVinculo('isDefault', $event)"
          />
          <span>Empresa padrão do usuário</span>
        </label>

        <label class="marcador">
          <p-checkbox
            name="isActiveVinculo"
            [binary]="true"
            [ngModel]="formVinculo().isActive"
            (ngModelChange)="mudarVinculo('isActive', $event)"
          />
          <span>Vínculo ativo</span>
        </label>
      </form>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="dialogoVinculo.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando()"
          (onClick)="salvarVinculo()"
        />
      </ng-template>
    </p-dialog>

    <p-dialog
      [visible]="dialogoUsuario()"
      (visibleChange)="dialogoUsuario.set($event)"
      [modal]="true"
      [style]="{ width: '34rem' }"
      [header]="usuarioEditado() ? 'Editar usuário' : 'Novo usuário'"
    >
      @if (erroForm(); as falha) {
        <sge-error-alert [erro]="falha" />
      }

      <form class="grade-campos formulario" (ngSubmit)="salvarUsuario()">
        <sge-text-field
          rotulo="Nome"
          name="name"
          [obrigatorio]="true"
          [ngModel]="formUsuario().name"
          (ngModelChange)="mudarUsuario('name', $event)"
        />

        @if (usuarioEditado(); as atual) {
          <div class="campo">
            <span class="campo__rotulo">E-mail</span>
            <strong class="leitura">{{ atual.email }}</strong>
            <span class="campo__dica">O e-mail identifica o acesso e não é editável.</span>
          </div>
        } @else {
          <sge-text-field
            rotulo="E-mail"
            tipo="email"
            name="email"
            autocomplete="off"
            [obrigatorio]="true"
            [ngModel]="formUsuario().email"
            (ngModelChange)="mudarUsuario('email', $event)"
          />
          <sge-text-field
            rotulo="Senha inicial"
            tipo="password"
            name="password"
            autocomplete="new-password"
            dica="Mínimo de 12 caracteres, com maiúscula, minúscula, número e símbolo"
            [obrigatorio]="true"
            [ngModel]="formUsuario().password"
            (ngModelChange)="mudarUsuario('password', $event)"
          />
        }

        <sge-text-field
          rotulo="Telefone"
          name="phone"
          [ngModel]="formUsuario().phone"
          (ngModelChange)="mudarUsuario('phone', $event)"
        />

        @if (usuarioEditado()) {
          <label class="marcador">
            <p-checkbox
              name="isActiveUsuario"
              [binary]="true"
              [ngModel]="formUsuario().isActive"
              (ngModelChange)="mudarUsuario('isActive', $event)"
            />
            <span>Usuário ativo</span>
          </label>
        }
      </form>

      <ng-template #footer>
        <p-button
          label="Cancelar"
          severity="secondary"
          [outlined]="true"
          (onClick)="dialogoUsuario.set(false)"
        />
        <p-button
          label="Salvar"
          icon="pi pi-check"
          [loading]="salvando()"
          [disabled]="salvando()"
          (onClick)="salvarUsuario()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .segmentos {
      display: flex;
      gap: 0.4rem;
      margin-bottom: 0.875rem;
    }
    .segmentos__item {
      padding: 0.4rem 0.8rem;
      font: inherit;
      font-size: 0.78rem;
      color: var(--p-text-muted-color);
      background: var(--p-content-background);
      border: 1px solid var(--p-content-border-color);
      border-radius: 999px;
      cursor: pointer;
    }
    .segmentos__item--ativo {
      color: var(--p-primary-contrast-color);
      background: var(--p-primary-color);
      border-color: var(--p-primary-color);
    }
    .formulario {
      padding-top: 0.5rem;
    }
    .marcador {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: var(--p-text-color);
    }
    .leitura {
      padding: 0.4rem 0;
      font-size: 0.85rem;
      color: var(--p-text-color);
    }
  `,
})
export class UsersPage {
  private readonly api = inject(UsersApiService);
  private readonly rolesApi = inject(RolesApiService);
  private readonly branchesApi = inject(BranchesApiService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly permissoes = inject(PermissionsService);

  protected readonly FILTRO_SITUACAO = FILTRO_SITUACAO;

  protected readonly colunasVinculo: Coluna[] = [
    { campo: 'user', cabecalho: 'Usuário' },
    { campo: 'email', cabecalho: 'E-mail' },
    { campo: 'role', cabecalho: 'Perfil', largura: '12rem' },
    { campo: 'branch', cabecalho: 'Filial', largura: '12rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '12rem' },
  ];

  protected readonly colunasUsuario: Coluna[] = [
    { campo: 'name', cabecalho: 'Usuário' },
    { campo: 'email', cabecalho: 'E-mail' },
    { campo: 'lastLoginAt', cabecalho: 'Último acesso', largura: '11rem' },
    { campo: 'isSuperAdmin', cabecalho: 'Alcance', largura: '9rem' },
    { campo: 'isActive', cabecalho: 'Situação', largura: '8rem' },
    { campo: 'acoes', cabecalho: '', largura: '7rem' },
  ];

  protected readonly aba = signal<'vinculos' | 'usuarios'>('vinculos');
  protected readonly superAdmin = computed(() => this.auth.superAdmin());

  protected readonly vinculos = new ListState<MembershipRow>(
    (consulta) => this.api.listMemberships(consulta),
    consultaPadrao,
  );

  protected readonly usuarios = new ListState<User>(
    (consulta) => this.api.listUsers(consulta),
    consultaPadrao,
  );

  protected readonly opcoesPerfil = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesFilial = signal<OpcaoFiltro[]>([]);
  protected readonly opcoesUsuario = signal<OpcaoFiltro[]>([]);

  protected readonly dialogoVinculo = signal(false);
  protected readonly dialogoUsuario = signal(false);
  protected readonly vinculoEditado = signal<MembershipRow | null>(null);
  protected readonly usuarioEditado = signal<User | null>(null);
  protected readonly salvando = signal(false);
  protected readonly erroForm = signal<unknown>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly formVinculo = signal<FormVinculo>({
    userId: '',
    roleId: '',
    branchId: '',
    isDefault: false,
    isActive: true,
  });

  protected readonly formUsuario = signal<FormUsuario>({
    name: '',
    email: '',
    password: '',
    phone: '',
    isActive: true,
  });

  constructor() {
    this.vinculos.carregar();
    if (this.permissoes.pode('roles:READ')) this.carregarPerfis();
    if (this.permissoes.pode('branches:READ')) this.carregarFiliais();
  }

  protected dataHora(valor: string): string {
    return formatDateTime(valor);
  }

  protected trocarAba(aba: 'vinculos' | 'usuarios'): void {
    this.aba.set(aba);
    this.aviso.set(null);
    if (aba === 'usuarios' && this.usuarios.linhas().length === 0) this.usuarios.carregar();
  }

  protected mudarVinculo<K extends keyof FormVinculo>(campo: K, valor: FormVinculo[K]): void {
    this.formVinculo.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected mudarUsuario<K extends keyof FormUsuario>(campo: K, valor: FormUsuario[K]): void {
    this.formUsuario.update((atual) => ({ ...atual, [campo]: valor }));
  }

  protected abrirVinculo(item: MembershipRow | null): void {
    this.vinculoEditado.set(item);
    this.erroForm.set(null);
    this.formVinculo.set({
      userId: item?.userId ?? '',
      roleId: item?.roleId ?? '',
      branchId: item?.branchId ?? '',
      isDefault: item?.isDefault ?? false,
      isActive: item?.isActive ?? true,
    });
    if (item === null && this.superAdmin() && this.opcoesUsuario().length === 0) {
      this.carregarUsuariosParaSelecao();
    }
    this.dialogoVinculo.set(true);
  }

  protected abrirUsuario(item: User | null): void {
    this.usuarioEditado.set(item);
    this.erroForm.set(null);
    this.formUsuario.set({
      name: item?.name ?? '',
      email: item?.email ?? '',
      password: '',
      phone: item?.phone ?? '',
      isActive: item?.isActive ?? true,
    });
    this.dialogoUsuario.set(true);
  }

  protected salvarVinculo(): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erroForm.set(null);

    const form = this.formVinculo();
    const atual = this.vinculoEditado();
    const comum = {
      roleId: form.roleId.trim(),
      isDefault: form.isDefault,
      isActive: form.isActive,
      ...(form.branchId !== '' ? { branchId: form.branchId } : {}),
    };

    const requisicao = atual
      ? this.api.updateMembership(atual.id, comum)
      : this.api.createMembership({ userId: form.userId.trim(), ...comum });

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvando.set(false);
        this.dialogoVinculo.set(false);
        this.aviso.set(atual ? 'Vínculo atualizado.' : 'Vínculo criado.');
        this.vinculos.carregar();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroForm.set(falha);
      },
    });
  }

  protected salvarUsuario(): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.erroForm.set(null);

    const form = this.formUsuario();
    const atual = this.usuarioEditado();

    const requisicao = atual
      ? this.api.updateUser(atual.id, {
          name: form.name.trim(),
          isActive: form.isActive,
          ...(form.phone.trim() !== '' ? { phone: form.phone.trim() } : {}),
        })
      : this.api.createUser({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          ...(form.phone.trim() !== '' ? { phone: form.phone.trim() } : {}),
        } as CreateUserInput);

    requisicao.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.salvando.set(false);
        this.dialogoUsuario.set(false);
        // A senha digitada sai da memória junto com o formulário.
        this.formUsuario.update((estado) => ({ ...estado, password: '' }));
        this.aviso.set(atual ? 'Usuário atualizado.' : 'Usuário cadastrado.');
        this.usuarios.carregar();
      },
      error: (falha: unknown) => {
        this.salvando.set(false);
        this.erroForm.set(falha);
      },
    });
  }

  protected removerVinculo(item: MembershipRow): void {
    this.aviso.set(null);
    this.api
      .removeMembership(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.aviso.set(`Vínculo de ${item.user.name} removido desta empresa.`);
          this.vinculos.carregar();
        },
        error: (falha: unknown) => this.vinculos.erro.set(falha),
      });
  }

  private carregarPerfis(): void {
    this.rolesApi
      .list({ pageSize: 100, isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) =>
          this.opcoesPerfil.set(resultado.data.map((p) => ({ value: p.id, label: p.name }))),
        // Sem perfis carregados a tela cai no campo de identificador; não é
        // caso de derrubar a listagem.
        error: () => this.opcoesPerfil.set([]),
      });
  }

  private carregarFiliais(): void {
    this.branchesApi
      .list({ pageSize: 100, isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) =>
          this.opcoesFilial.set(
            resultado.data.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` })),
          ),
        error: () => this.opcoesFilial.set([]),
      });
  }

  private carregarUsuariosParaSelecao(): void {
    this.api
      .listUsers({ pageSize: 100, isActive: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resultado) =>
          this.opcoesUsuario.set(
            resultado.data.map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` })),
          ),
        error: () => this.opcoesUsuario.set([]),
      });
  }
}
