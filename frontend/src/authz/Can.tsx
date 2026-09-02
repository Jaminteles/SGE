import type { ReactNode } from 'react';
import type { PermissionCheck } from './permissions';
import { usePermissions } from './usePermissions';

interface CanProps extends PermissionCheck {
  children: ReactNode;
  /** Conteúdo alternativo quando o perfil não tem a permissão. */
  fallback?: ReactNode;
}

/**
 * Esconde um trecho da interface quando o perfil não tem a permissão (UI-004).
 * É conveniência visual: a API recusa a operação de qualquer forma.
 */
export function Can({ all, any, children, fallback = null }: CanProps) {
  const { allows } = usePermissions();
  return <>{allows({ all, any }) ? children : fallback}</>;
}
