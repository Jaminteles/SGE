import type { Membership, UserProfile } from '../api/types';

/**
 * Permissões no cliente (RF-011 / UI-004).
 *
 * IMPORTANTE: isto **não é** controle de acesso. Serve para não oferecer ao
 * usuário um botão que a API vai recusar. A decisão real é sempre do backend
 * (PermissionsGuard + RLS) — esconder um item de menu não protege nada.
 *
 * O código segue o formato `recurso:AÇÃO` do catálogo do backend
 * (`permission-catalog.ts`).
 */

export type PermissionAction = 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'EXPORT';

export function permissionCode(resource: string, action: PermissionAction): string {
  return `${resource}:${action}`;
}

/** Vínculo do usuário com a empresa ativa, ou `null` se não houver. */
export function membershipFor(
  user: UserProfile | null,
  companyId: string | null,
): Membership | null {
  if (!user || !companyId) return null;
  return user.memberships.find((m) => m.companyId === companyId) ?? null;
}

/** Conjunto de permissões efetivas na empresa ativa. */
export function permissionsFor(user: UserProfile | null, companyId: string | null): Set<string> {
  return new Set(membershipFor(user, companyId)?.permissions ?? []);
}

export interface PermissionCheck {
  /** Exige todas as permissões da lista. */
  all?: string[];
  /** Exige ao menos uma das permissões da lista. */
  any?: string[];
}

/**
 * Avalia a exigência contra as permissões concedidas. O super admin da
 * plataforma passa em tudo — assim como no PermissionsGuard.
 */
export function isAllowed(
  granted: Set<string>,
  check: PermissionCheck,
  { isSuperAdmin = false } = {},
): boolean {
  if (isSuperAdmin) return true;
  const all = check.all ?? [];
  const any = check.any ?? [];
  if (all.length === 0 && any.length === 0) return true;
  if (!all.every((code) => granted.has(code))) return false;
  if (any.length > 0 && !any.some((code) => granted.has(code))) return false;
  return true;
}
