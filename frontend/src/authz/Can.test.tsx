import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeMembership, makeUser } from '../test/factories';
import { renderWithProviders } from '../test/render';
import { Can } from './Can';

const COMPANY = '11111111-1111-4111-8111-111111111111';

function userWith(permissions: string[], isSuperAdmin = false) {
  return makeUser({
    isSuperAdmin,
    memberships: [makeMembership({ companyId: COMPANY, permissions })],
  });
}

describe('Can (UI-004)', () => {
  it('mostra a ação quando o perfil tem a permissão', () => {
    renderWithProviders(
      <Can all={['payments:APPROVE']}>
        <button type="button">Aprovar pagamento</button>
      </Can>,
      { user: userWith(['payments:APPROVE']), activeCompanyId: COMPANY },
    );
    expect(screen.getByRole('button', { name: 'Aprovar pagamento' })).toBeInTheDocument();
  });

  it('esconde a ação e exibe o alternativo quando não tem', () => {
    renderWithProviders(
      <Can all={['payments:APPROVE']} fallback={<span>Sem permissão no perfil</span>}>
        <button type="button">Aprovar pagamento</button>
      </Can>,
      { user: userWith(['payments:READ']), activeCompanyId: COMPANY },
    );
    expect(screen.queryByRole('button', { name: 'Aprovar pagamento' })).not.toBeInTheDocument();
    expect(screen.getByText('Sem permissão no perfil')).toBeInTheDocument();
  });

  it('libera o super admin', () => {
    renderWithProviders(
      <Can all={['payments:APPROVE']}>
        <button type="button">Aprovar pagamento</button>
      </Can>,
      { user: userWith([], true), activeCompanyId: COMPANY },
    );
    expect(screen.getByRole('button', { name: 'Aprovar pagamento' })).toBeInTheDocument();
  });
});
