import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeMembership, makeUser } from '../test/factories';
import { renderWithProviders } from '../test/render';
import { Sidebar } from './Sidebar';

const COMPANY = '11111111-1111-4111-8111-111111111111';

describe('Sidebar (UI-004)', () => {
  it('libera o módulo quando o perfil tem a permissão', () => {
    const user = makeUser({
      memberships: [makeMembership({ companyId: COMPANY, permissions: ['audit:READ'] })],
    });
    renderWithProviders(<Sidebar />, { user, activeCompanyId: COMPANY });

    expect(screen.getByRole('link', { name: 'Auditoria' })).toBeInTheDocument();
  });

  it('bloqueia o módulo sem permissão, sem virar link', () => {
    const user = makeUser({
      memberships: [makeMembership({ companyId: COMPANY, permissions: ['partners:READ'] })],
    });
    renderWithProviders(<Sidebar />, { user, activeCompanyId: COMPANY });

    expect(screen.queryByRole('link', { name: 'Auditoria' })).not.toBeInTheDocument();
    const blocked = screen.getByText('Auditoria');
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(blocked).toHaveAttribute('title', 'Sem permissão no perfil');
  });

  it('libera todos os módulos para o super admin', () => {
    const user = makeUser({
      isSuperAdmin: true,
      memberships: [makeMembership({ companyId: COMPANY, permissions: [] })],
    });
    renderWithProviders(<Sidebar />, { user, activeCompanyId: COMPANY });

    expect(screen.getByRole('link', { name: 'Auditoria' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Financeiro' })).toBeInTheDocument();
  });

  it('reavalia as permissões ao trocar a empresa ativa', () => {
    const other = '22222222-2222-4222-8222-222222222222';
    const user = makeUser({
      memberships: [
        makeMembership({ companyId: COMPANY, permissions: ['audit:READ'] }),
        makeMembership({ companyId: other, permissions: ['partners:READ'] }),
      ],
    });

    const { unmount } = renderWithProviders(<Sidebar />, { user, activeCompanyId: COMPANY });
    expect(screen.getByRole('link', { name: 'Auditoria' })).toBeInTheDocument();
    unmount();

    renderWithProviders(<Sidebar />, { user, activeCompanyId: other });
    expect(screen.queryByRole('link', { name: 'Auditoria' })).not.toBeInTheDocument();
  });
});
