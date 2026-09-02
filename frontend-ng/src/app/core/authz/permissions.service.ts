import { Injectable, computed, inject } from '@angular/core';

import { AuthService } from '../auth/auth.service';
import { CompanyService } from '../company/company.service';
import { isAllowed, type PermissionCheck } from './permissions';

/**
 * Permissões efetivas na empresa ativa (RF-011 / UI-004).
 *
 * **Isto não é controle de acesso.** Serve para não oferecer ao usuário um
 * botão que a API vai recusar. Quem autoriza de verdade é o `PermissionsGuard`
 * do backend somado à RLS do PostgreSQL, a cada requisição — esconder um item
 * de menu não protege nada.
 */
@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private readonly auth = inject(AuthService);
  private readonly empresa = inject(CompanyService);

  /** Códigos `recurso:AÇÃO` concedidos na empresa ativa. */
  readonly concedidas = computed(() => this.empresa.permissoes());

  /** O super admin da plataforma passa em tudo, como no `PermissionsGuard`. */
  readonly superAdmin = computed(() => this.auth.superAdmin());

  /** `true` se o perfil tem a permissão na empresa ativa. */
  pode(codigo: string): boolean {
    return isAllowed(this.concedidas(), { all: [codigo] }, { isSuperAdmin: this.superAdmin() });
  }

  /** Avaliação composta (`all` / `any`). */
  permite(check: PermissionCheck): boolean {
    return isAllowed(this.concedidas(), check, { isSuperAdmin: this.superAdmin() });
  }
}
