import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { makeMembership, makeUser } from '../test/factories';
import { renderWithProviders } from '../test/render';
import { RequirePermission } from './RequirePermission';

const COMPANY = '11111111-1111-4111-8111-111111111111';

function tree() {
  return (
    <Routes>
      <Route element={<RequirePermission check={{ all: ['audit:READ'] }} />}>
        <Route path="/auditoria" element={<p>Trilha de auditoria</p>} />
      </Route>
    </Routes>
  );
}

describe('RequirePermission (UI-004)', () => {
  it('deixa passar quem tem a permissão', () => {
    const user = makeUser({
      memberships: [makeMembership({ companyId: COMPANY, permissions: ['audit:READ'] })],
    });
    renderWithProviders(tree(), { user, activeCompanyId: COMPANY, route: '/auditoria' });

    expect(screen.getByText('Trilha de auditoria')).toBeInTheDocument();
  });

  it('bloqueia quem forçou a URL sem ter a permissão', () => {
    const user = makeUser({
      memberships: [makeMembership({ companyId: COMPANY, permissions: ['partners:READ'] })],
    });
    renderWithProviders(tree(), { user, activeCompanyId: COMPANY, route: '/auditoria' });

    expect(screen.queryByText('Trilha de auditoria')).not.toBeInTheDocument();
    expect(screen.getByText('Sem permissão no perfil')).toBeInTheDocument();
  });
});
