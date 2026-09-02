import { useCallback, useMemo } from 'react';
import { useAuth } from '../auth/auth-context';
import { useCompany } from '../company/company-context';
import { isAllowed, type PermissionCheck } from './permissions';

export interface PermissionsApi {
  granted: Set<string>;
  isSuperAdmin: boolean;
  /** `true` se o perfil tem a permissão na empresa ativa. */
  can: (code: string) => boolean;
  /** Avaliação composta (`all` / `any`). */
  allows: (check: PermissionCheck) => boolean;
}

/** Permissões efetivas na empresa ativa — só para adaptar a interface (UI-004). */
export function usePermissions(): PermissionsApi {
  const { user } = useAuth();
  const { permissions } = useCompany();
  const isSuperAdmin = user?.isSuperAdmin ?? false;

  const can = useCallback(
    (code: string) => isAllowed(permissions, { all: [code] }, { isSuperAdmin }),
    [permissions, isSuperAdmin],
  );

  const allows = useCallback(
    (check: PermissionCheck) => isAllowed(permissions, check, { isSuperAdmin }),
    [permissions, isSuperAdmin],
  );

  return useMemo(
    () => ({ granted: permissions, isSuperAdmin, can, allows }),
    [permissions, isSuperAdmin, can, allows],
  );
}
