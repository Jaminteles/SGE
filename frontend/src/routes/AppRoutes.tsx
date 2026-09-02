import { Navigate, Route, Routes } from 'react-router-dom';
import { ForgotPasswordPage } from '../auth/ForgotPasswordPage';
import { LoginPage } from '../auth/LoginPage';
import { ResetPasswordPage } from '../auth/ResetPasswordPage';
import { CompanySelectPage } from '../company/CompanySelectPage';
import { AppLayout } from '../layout/AppLayout';
import { NAVIGATION } from '../layout/navigation';
import { HomePage } from './HomePage';
import { ModulePage } from './ModulePage';
import { NotFoundPage } from './NotFoundPage';
import { ProtectedRoute } from './ProtectedRoute';
import { RequirePermission } from './RequirePermission';
import { RequireSession } from './RequireSession';

/** Mapa de rotas do app (UI-005). */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />

      <Route element={<RequireSession />}>
        <Route path="/selecionar-empresa" element={<CompanySelectPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          {NAVIGATION.filter((item) => item.path !== '/').map((item) => (
            <Route key={item.path} element={<RequirePermission check={item.permissions} />}>
              <Route path={item.path} element={<ModulePage title={item.label} />} />
            </Route>
          ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
