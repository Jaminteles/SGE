import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Router } from '@angular/router';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';

import { SessionExpiryBanner } from '../auth/session-expiry-banner';
import { AuthService } from '../core/auth/auth.service';
import { PermissionsService } from '../core/authz/permissions.service';
import { CompanyService } from '../core/company/company.service';
import { initials } from '../core/lib/format';
import { NAVIGATION } from '../core/navigation';
import { ThemeService } from '../theme/theme-service';

/**
 * Moldura da área autenticada (UI-004 / UI-005).
 *
 * A barra lateral vem de `core/navigation.ts` e respeita as permissões do
 * perfil: item sem permissão aparece **desabilitado**, com o aviso "Sem
 * permissão no perfil", em vez de sumir — assim o usuário sabe que o módulo
 * existe e pode pedir acesso.
 */
@Component({
  selector: 'sge-app-layout',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ButtonModule,
    InputTextModule,
    AvatarModule,
    TooltipModule,
    SessionExpiryBanner,
  ],
  templateUrl: './app-layout.html',
  styleUrl: './app-layout.scss',
})
export class AppLayout {
  protected readonly theme = inject(ThemeService);
  protected readonly auth = inject(AuthService);
  protected readonly empresa = inject(CompanyService);
  private readonly permissoes = inject(PermissionsService);
  private readonly router = inject(Router);

  protected readonly iniciais = computed(() => initials(this.auth.usuario()?.name ?? ''));

  protected readonly nomeEmpresa = computed(() => {
    const ativa = this.empresa.ativa();
    if (!ativa) return 'Nenhuma empresa ativa';
    const nome = ativa.company.tradeName ?? ativa.company.legalName;
    return ativa.branchId ? nome : `${nome} · Matriz`;
  });

  /** Cada item já resolvido: o template não chama método por iteração. */
  protected readonly itens = computed(() =>
    NAVIGATION.map((item) => ({
      ...item,
      liberado: this.permissoes.permite(item.permissions),
    })),
  );

  protected readonly bloqueados = computed(() => this.itens().filter((i) => !i.liberado).length);

  protected async sair(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }

  protected trocarEmpresa(): void {
    void this.router.navigate(['/selecionar-empresa']);
  }
}
