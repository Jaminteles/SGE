import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/auth-context';
import { permissionsFor } from '../authz/permissions';
import { activeCompanyStore } from './active-company-store';
import { CompanyContext, type CompanyContextValue } from './company-context';

/**
 * Empresa ativa (RF-005 / UI-003).
 *
 * A escolha só é aceita se o usuário tiver vínculo com a empresa — e mesmo
 * assim o backend revalida o `x-company-id` em toda requisição. Quando há um
 * único vínculo, a seleção é automática; quando há vários, o app leva o usuário
 * à tela de seleção.
 */
export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(() =>
    activeCompanyStore.get(),
  );

  const companies = useMemo(
    () => user?.memberships.filter((m) => m.company.isActive) ?? [],
    [user],
  );

  const selectCompany = useCallback(
    (companyId: string) => {
      // Ignora id que não pertence ao usuário (ex.: valor antigo no storage).
      if (!companies.some((m) => m.companyId === companyId)) return;
      activeCompanyStore.set(companyId);
      setActiveCompanyId(companyId);
    },
    [companies],
  );

  const clearCompany = useCallback(() => {
    activeCompanyStore.set(null);
    setActiveCompanyId(null);
  }, []);

  // Descarta seleção inválida e aplica o vínculo único/padrão automaticamente.
  useEffect(() => {
    if (!user) return;
    const current = activeCompanyStore.get();
    if (current && companies.some((m) => m.companyId === current)) {
      if (current !== activeCompanyId) setActiveCompanyId(current);
      return;
    }
    if (current) clearCompany();
    if (companies.length === 1) {
      selectCompany(companies[0].companyId);
      return;
    }
    const preferred = companies.find((m) => m.isDefault);
    if (preferred) selectCompany(preferred.companyId);
  }, [user, companies, activeCompanyId, clearCompany, selectCompany]);

  const value = useMemo<CompanyContextValue>(() => {
    const active = companies.find((m) => m.companyId === activeCompanyId) ?? null;
    return {
      companies,
      activeCompanyId: active ? activeCompanyId : null,
      activeCompany: active,
      selectCompany,
      clearCompany,
      permissions: permissionsFor(user, active ? activeCompanyId : null),
      needsSelection: user !== null && active === null,
    };
  }, [companies, activeCompanyId, selectCompany, clearCompany, user]);

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}
