import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { useCompany } from '../company/company-context';
import { StateScreen } from '../ui/StateScreen';

/**
 * Porta de entrada da área autenticada (UI-002 / UI-003).
 *
 * Sem sessão → login. Com sessão mas sem empresa ativa → seleção de empresa,
 * porque toda rota por empresa exige `x-company-id`.
 */
export function ProtectedRoute() {
  const { status } = useAuth();
  const { activeCompanyId } = useCompany();
  const location = useLocation();

  if (status === 'loading') {
    return <StateScreen title="Carregando sua sessão…" />;
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (activeCompanyId === null) {
    return <Navigate to="/selecionar-empresa" replace />;
  }

  return <Outlet />;
}
