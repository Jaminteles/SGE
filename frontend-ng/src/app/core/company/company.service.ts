import { Injectable, computed, effect, inject, signal } from '@angular/core';

import type { Membership } from '../api/types';
import { AuthService } from '../auth/auth.service';
import { permissionsFor } from '../authz/permissions';
import { activeCompanyStore } from './active-company-store';

/**
 * Empresa ativa (RF-005 / UI-003) — substitui o `CompanyProvider` do React.
 *
 * A escolha só é aceita se o usuário tiver vínculo com a empresa. Isso é
 * conveniência de interface: o backend revalida o `x-company-id` em toda
 * requisição, e o isolamento real continua sendo a RLS do PostgreSQL.
 */
@Injectable({ providedIn: 'root' })
export class CompanyService {
  private readonly auth = inject(AuthService);

  /** Escolha bruta (memória + `localStorage`), antes de validar o vínculo. */
  private readonly _escolhida = signal<string | null>(activeCompanyStore.get());

  /** Só empresas ativas: um vínculo com empresa inativa não é selecionável. */
  readonly empresas = computed<Membership[]>(
    () => this.auth.usuario()?.memberships.filter((m) => m.company.isActive) ?? [],
  );

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

  constructor() {
    // Descarta seleção inválida (ex.: id antigo no storage, ou vínculo
    // removido) e aplica o vínculo único/padrão automaticamente.
    effect(() => {
      if (!this.auth.usuario()) return;

      const empresas = this.empresas();
      const escolhida = this._escolhida();

      if (escolhida && empresas.some((m) => m.companyId === escolhida)) return;
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
}
