import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import type { UserProfile } from '../api/types';
import { AuthContext, type AuthContextValue } from '../auth/auth-context';
import { CompanyContext, type CompanyContextValue } from '../company/company-context';
import { permissionsFor } from '../authz/permissions';
import { makeUser } from './factories';

interface Options {
  user?: UserProfile | null;
  activeCompanyId?: string | null;
  route?: string;
  auth?: Partial<AuthContextValue>;
  company?: Partial<CompanyContextValue>;
}

/** Render com sessão e empresa ativa já resolvidas — sem tocar na rede. */
export function renderWithProviders(ui: ReactElement, options: Options = {}): RenderResult {
  const user = options.user === undefined ? makeUser() : options.user;
  const activeCompanyId =
    options.activeCompanyId === undefined
      ? (user?.memberships[0]?.companyId ?? null)
      : options.activeCompanyId;

  const authValue: AuthContextValue = {
    user,
    status: user ? 'authenticated' : 'anonymous',
    expiresAt: null,
    login: vi.fn(),
    logout: vi.fn(),
    renew: vi.fn(),
    ...options.auth,
  };

  const companies = user?.memberships ?? [];
  const companyValue: CompanyContextValue = {
    companies,
    activeCompanyId,
    activeCompany: companies.find((m) => m.companyId === activeCompanyId) ?? null,
    selectCompany: vi.fn(),
    clearCompany: vi.fn(),
    permissions: permissionsFor(user, activeCompanyId),
    needsSelection: user !== null && activeCompanyId === null,
    ...options.company,
  };

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[options.route ?? '/']}>
        <AuthContext.Provider value={authValue}>
          <CompanyContext.Provider value={companyValue}>{children}</CompanyContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>
    );
  }

  return render(ui, { wrapper: Wrapper });
}
