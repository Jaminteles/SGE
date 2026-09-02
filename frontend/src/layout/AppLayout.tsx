import { Outlet } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { SessionExpiryBanner } from '../auth/SessionExpiryBanner';
import { CompanySwitcher } from '../company/CompanySwitcher';
import { useCompany } from '../company/company-context';
import { initials } from '../lib/format';
import { Button } from '../ui/Button';
import { Sidebar } from './Sidebar';

/** Moldura das telas autenticadas: barra lateral, topo e área de conteúdo (UI-005). */
export function AppLayout() {
  const { user, logout } = useAuth();
  const { activeCompany } = useCompany();

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <header className="topbar">
          <CompanySwitcher />
          <span className="topbar__spacer" />
          <div className="topbar__user">
            <span className="topbar__avatar" aria-hidden="true">
              {initials(user?.name ?? '')}
            </span>
            <span className="topbar__identity">
              <span className="topbar__name">{user?.name}</span>
              <span className="topbar__role">{activeCompany?.role.name ?? 'Sem perfil'}</span>
            </span>
            <Button variant="ghost" onClick={() => void logout()}>
              Sair
            </Button>
          </div>
        </header>
        <main className="content">
          <SessionExpiryBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
}
