import { createContext, useContext } from 'react';
import type { Membership } from '../api/types';

export interface CompanyContextValue {
  /** Empresas às quais o usuário está vinculado (RF-005). */
  companies: Membership[];
  activeCompanyId: string | null;
  activeCompany: Membership | null;
  selectCompany: (companyId: string) => void;
  clearCompany: () => void;
  /** Permissões do perfil na empresa ativa (RF-011, uso apenas de interface). */
  permissions: Set<string>;
  /** `true` quando o usuário ainda precisa escolher a empresa ativa. */
  needsSelection: boolean;
}

export const CompanyContext = createContext<CompanyContextValue | null>(null);

export function useCompany(): CompanyContextValue {
  const context = useContext(CompanyContext);
  if (!context) throw new Error('useCompany precisa estar dentro de <CompanyProvider>.');
  return context;
}
