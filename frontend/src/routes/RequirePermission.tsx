import { Outlet } from 'react-router-dom';
import type { PermissionCheck } from '../authz/permissions';
import { usePermissions } from '../authz/usePermissions';
import { StateScreen } from '../ui/StateScreen';

/**
 * Bloqueia a rota quando o perfil não tem a permissão (UI-004).
 *
 * Novamente: é usabilidade, não segurança. Mesmo que alguém force a URL, cada
 * requisição da tela é recusada pelo backend.
 */
export function RequirePermission({ check }: { check: PermissionCheck }) {
  const { allows } = usePermissions();

  if (!allows(check)) {
    return (
      <StateScreen
        title="Sem permissão no perfil"
        message="Seu perfil nesta empresa não dá acesso a este módulo. Fale com o administrador."
      />
    );
  }

  return <Outlet />;
}
