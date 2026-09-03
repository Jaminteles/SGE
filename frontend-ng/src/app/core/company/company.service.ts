import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { CompaniesApiService } from '../api/companies-api.service';
import type { Company, Membership } from '../api/types';
import { AuthService } from '../auth/auth.service';
import { permissionsFor } from '../authz/permissions';
import { activeCompanyStore } from './active-company-store';

/**
 * Empresa ativa (RF-005 / UI-003) — substitui o `CompanyProvider` do React.
 *
 * A escolha só é aceita se o usuário tiver vínculo com a empresa. Isso é
 * conveniência de interface: o backend revalida o `x-company-id` em toda
 * requisição, e o isolamento real continua sendo a RLS do PostgreSQL.
 *
 * A exceção é o super admin da plataforma: o `PermissionsGuard` aceita dele
 * qualquer `x-company-id`, sem exigir vínculo. Sem espelhar essa regra aqui,
 * uma instalação nova ficava sem saída — o super admin nasce sem vínculo, e a
 * tela que cadastra a primeira empresa é justamente uma tela interna.
 */
@Injectable({ providedIn: 'root' })
export class CompanyService {
  private readonly auth = inject(AuthService);
  private readonly api = inject(CompaniesApiService);

  /** Escolha bruta (memória + `localStorage`), antes de validar o vínculo. */
  private readonly _escolhida = signal<string | null>(activeCompanyStore.get());

  /** Empresas da plataforma, carregadas só para o super admin. */
  private readonly _plataforma = signal<Company[]>([]);

  private readonly vinculos = computed<Membership[]>(
    () => this.auth.usuario()?.memberships.filter((m) => m.company.isActive) ?? [],
  );

  /**
   * Empresas selecionáveis: os vínculos ativos e, para o super admin, também as
   * demais empresas da plataforma. O vínculo tem precedência — ele carrega o
   * perfil e as permissões, que a empresa avulsa não tem.
   */
  readonly empresas = computed<Membership[]>(() => {
    const vinculos = this.vinculos();
    if (!this.auth.superAdmin()) return vinculos;

    const jaVinculadas = new Set(vinculos.map((m) => m.companyId));
    const avulsas = this._plataforma()
      .filter((empresa) => empresa.isActive && !jaVinculadas.has(empresa.id))
      .map((empresa) => this.comoVinculo(empresa));
    return [...vinculos, ...avulsas];
  });

  /** A escolha, mas apenas se ainda corresponder a um vínculo válido. */
  readonly ativaId = computed<string | null>(() => {
    const escolhida = this._escolhida();
    return this.empresas().some((m) => m.companyId === escolhida) ? escolhida : null;
  });

  readonly ativa = computed<Membership | null>(
    () => this.empresas().find((m) => m.companyId === this.ativaId()) ?? null,
  );

  /** Permissões do perfil na empresa ativa (RF-011, uso apenas de interface). */
  readonly permissoes = computed(() => permissionsFor(this.auth.usuario(), this.ativaId()));

  /** `true` quando o usuário ainda precisa escolher a empresa ativa. */
  readonly precisaSelecionar = computed(
    () => this.auth.usuario() !== null && this.ativa() === null,
  );

  /** Impede descartar a escolha do super admin antes da lista chegar. */
  private readonly _carregandoPlataforma = signal(false);
  private buscaEmAndamento = false;

  constructor() {
    // O super admin escolhe entre todas as empresas, não entre vínculos.
    effect(() => {
      if (this.auth.superAdmin()) this.carregarPlataforma();
      else this._plataforma.set([]);
    });

    // Descarta seleção inválida (ex.: id antigo no storage, ou vínculo
    // removido) e aplica o vínculo único/padrão automaticamente.
    effect(() => {
      if (!this.auth.usuario()) return;

      const empresas = this.empresas();
      const escolhida = this._escolhida();

      if (escolhida && empresas.some((m) => m.companyId === escolhida)) return;
      // Escolha fora da lista pode ser só a lista do super admin que ainda não
      // chegou: descartar agora derrubaria a empresa ativa a cada F5 dele.
      if (escolhida && this._carregandoPlataforma()) return;
      if (escolhida) this.limpar();

      if (empresas.length === 1) {
        this.selecionar(empresas[0].companyId);
        return;
      }
      const padrao = empresas.find((m) => m.isDefault);
      if (padrao) this.selecionar(padrao.companyId);
    });
  }

  selecionar(companyId: string): void {
    // Ignora id que não pertence ao usuário.
    if (!this.empresas().some((m) => m.companyId === companyId)) return;
    activeCompanyStore.set(companyId);
    this._escolhida.set(companyId);
  }

  limpar(): void {
    activeCompanyStore.set(null);
    this._escolhida.set(null);
  }

  /** Recarrega a lista da plataforma — usada depois de cadastrar uma empresa. */
  recarregarPlataforma(): void {
    if (!this.auth.superAdmin()) return;
    this.buscaEmAndamento = false;
    this.carregarPlataforma();
  }

  /**
   * Uma empresa da plataforma sem vínculo vira um "vínculo" sem perfil e sem
   * permissão: quem libera o super admin é o `isSuperAdmin`, avaliado antes da
   * lista de permissões, tanto aqui quanto no backend.
   */
  private comoVinculo(empresa: Company): Membership {
    return {
      companyId: empresa.id,
      branchId: null,
      isDefault: false,
      company: {
        legalName: empresa.legalName,
        tradeName: empresa.tradeName,
        taxId: empresa.taxId,
        isActive: empresa.isActive,
      },
      role: { id: '', name: 'Administrador da plataforma' },
      permissions: [],
    };
  }

  /**
   * Espera a lista da plataforma, quando houver uma em andamento.
   *
   * As guardas de rota precisam disto: num F5 do super admin, a empresa ativa
   * só volta a ser válida depois que a lista chega. Sem a espera, a primeira
   * navegação vê `ativaId()` nulo e desvia para a seleção de empresa — mesmo
   * com a escolha guardada e correta.
   */
  prontidao(): Promise<void> {
    // Dispara aqui em vez de confiar no efeito: num F5 a guarda decide antes
    // do primeiro ciclo de detecção de mudanças, e o efeito ainda não rodou.
    if (this.auth.superAdmin()) this.carregarPlataforma();
    return this.carregamento ?? Promise.resolve();
  }

  private carregamento: Promise<void> | null = null;

  private carregarPlataforma(): void {
    if (this.buscaEmAndamento) return;
    this.buscaEmAndamento = true;
    this._carregandoPlataforma.set(true);

    this.carregamento = new Promise<void>((resolve) => {
      this.api.list({ pageSize: 100, isActive: true }).subscribe({
        next: (resultado) => {
          this._plataforma.set(resultado.data);
          this._carregandoPlataforma.set(false);
          resolve();
        },
        // Falhar aqui não pode derrubar a sessão: o super admin continua com os
        // vínculos que tiver, e a tela de seleção mostra o que sobrou.
        error: () => {
          this._plataforma.set([]);
          this._carregandoPlataforma.set(false);
          resolve();
        },
      });
    });
  }
}
