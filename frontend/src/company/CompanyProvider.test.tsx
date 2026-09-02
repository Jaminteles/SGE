import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AuthContext, type AuthContextValue } from '../auth/auth-context';
import type { UserProfile } from '../api/types';
import { makeMembership, makeUser } from '../test/factories';
import { activeCompanyStore } from './active-company-store';
import { CompanyProvider } from './CompanyProvider';
import { useCompany } from './company-context';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';

function Probe() {
  const { activeCompanyId, needsSelection } = useCompany();
  return (
    <>
      <span data-testid="active">{activeCompanyId ?? 'nenhuma'}</span>
      <span data-testid="needs">{String(needsSelection)}</span>
    </>
  );
}

function renderWithUser(user: UserProfile, children: ReactNode = <Probe />) {
  const auth: AuthContextValue = {
    user,
    status: 'authenticated',
    expiresAt: null,
    login: vi.fn(),
    logout: vi.fn(),
    renew: vi.fn(),
  };
  return render(
    <AuthContext.Provider value={auth}>
      <CompanyProvider>{children}</CompanyProvider>
    </AuthContext.Provider>,
  );
}

describe('CompanyProvider (RF-005)', () => {
  beforeEach(() => {
    activeCompanyStore.set(null);
  });

  it('seleciona sozinho quando há um único vínculo', () => {
    renderWithUser(makeUser({ memberships: [makeMembership({ companyId: COMPANY_A })] }));
    expect(screen.getByTestId('active')).toHaveTextContent(COMPANY_A);
  });

  it('exige escolha quando há mais de um vínculo sem padrão', () => {
    renderWithUser(
      makeUser({
        memberships: [
          makeMembership({ companyId: COMPANY_A, isDefault: false }),
          makeMembership({ companyId: COMPANY_B, isDefault: false }),
        ],
      }),
    );
    expect(screen.getByTestId('needs')).toHaveTextContent('true');
  });

  it('descarta empresa guardada que não pertence ao usuário', () => {
    activeCompanyStore.set(FOREIGN);
    renderWithUser(
      makeUser({
        memberships: [
          makeMembership({ companyId: COMPANY_A, isDefault: false }),
          makeMembership({ companyId: COMPANY_B, isDefault: false }),
        ],
      }),
    );
    expect(screen.getByTestId('active')).toHaveTextContent('nenhuma');
    expect(activeCompanyStore.get()).toBeNull();
  });

  it('ignora empresa inativa na lista de escolha', () => {
    renderWithUser(
      makeUser({
        memberships: [
          makeMembership({
            companyId: COMPANY_A,
            company: {
              legalName: 'Inativa LTDA',
              tradeName: null,
              taxId: null,
              isActive: false,
            },
          }),
          makeMembership({ companyId: COMPANY_B, isDefault: false }),
        ],
      }),
    );
    expect(screen.getByTestId('active')).toHaveTextContent(COMPANY_B);
  });
});
