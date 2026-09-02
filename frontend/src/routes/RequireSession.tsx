import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { StateScreen } from '../ui/StateScreen';

/** Exige sessão, mas não empresa ativa (usada na tela de seleção de empresa). */
export function RequireSession() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <StateScreen title="Carregando sua sessão…" />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
