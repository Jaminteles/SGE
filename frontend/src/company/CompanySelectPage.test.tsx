import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makeMembership, makeUser } from '../test/factories';
import { renderWithProviders } from '../test/render';
import { CompanySelectPage } from './CompanySelectPage';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';

function userWithTwoCompanies() {
  return makeUser({
    memberships: [
      makeMembership({
        companyId: COMPANY_A,
        company: {
          legalName: 'Empresa Fantasma Teste LTDA',
          tradeName: 'Empresa Fantasma',
          taxId: '12345678000190',
          isActive: true,
        },
      }),
      makeMembership({
        companyId: COMPANY_B,
        isDefault: false,
        company: {
          legalName: 'Gil Ferreira Incorporações LTDA',
          tradeName: 'Gil Ferreira Incorporações',
          taxId: '98765432000110',
          isActive: true,
        },
      }),
    ],
  });
}

describe('CompanySelectPage (UI-003)', () => {
  it('lista as empresas vinculadas com CNPJ formatado', () => {
    renderWithProviders(<CompanySelectPage />, {
      user: userWithTwoCompanies(),
      activeCompanyId: null,
    });

    expect(screen.getByText('Empresa Fantasma')).toBeInTheDocument();
    expect(screen.getByText(/12\.345\.678\/0001-90/)).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('só confirma a empresa depois da escolha', async () => {
    const selectCompany = vi.fn();
    renderWithProviders(<CompanySelectPage />, {
      user: userWithTwoCompanies(),
      activeCompanyId: null,
      company: { selectCompany },
    });

    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: /Gil Ferreira/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(selectCompany).toHaveBeenCalledWith(COMPANY_B);
  });

  it('avisa quando o usuário não tem vínculo ativo', () => {
    renderWithProviders(<CompanySelectPage />, {
      user: makeUser({ memberships: [] }),
      activeCompanyId: null,
    });

    expect(screen.getByText('Nenhuma empresa vinculada')).toBeInTheDocument();
  });
});
