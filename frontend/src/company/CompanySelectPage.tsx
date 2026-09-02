import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { formatCnpj } from '../lib/format';
import { Button } from '../ui/Button';
import { StateScreen } from '../ui/StateScreen';
import { useCompany } from './company-context';

/** Seleção da empresa ativa (RF-005 / UI-003). */
export function CompanySelectPage() {
  const { user, logout } = useAuth();
  const { companies, activeCompanyId, selectCompany } = useCompany();
  const [choice, setChoice] = useState<string | null>(activeCompanyId);

  if (activeCompanyId !== null) return <Navigate to="/" replace />;

  if (companies.length === 0) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <StateScreen
            title="Nenhuma empresa vinculada"
            message="Seu usuário não tem vínculo ativo com nenhuma empresa. Fale com o administrador."
            action={
              <Button variant="secondary" onClick={() => void logout()}>
                Sair
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-card__title">Selecione a empresa</h1>
        <p className="auth-card__subtitle">
          {user?.name} · {companies.length} empresa(s) vinculada(s)
        </p>

        <div className="company-list" role="radiogroup" aria-label="Empresas vinculadas">
          {companies.map((membership) => {
            const selected = choice === membership.companyId;
            return (
              <button
                key={membership.companyId}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`company-option${selected ? ' company-option--selected' : ''}`}
                onClick={() => setChoice(membership.companyId)}
              >
                <span>
                  <span className="company-option__name">
                    {membership.company.tradeName ?? membership.company.legalName}
                  </span>
                  <br />
                  <span className="company-option__meta">
                    {membership.company.taxId
                      ? `CNPJ ${formatCnpj(membership.company.taxId)} · `
                      : ''}
                    {membership.role.name}
                  </span>
                </span>
                {selected ? <span className="company-option__check">✓</span> : null}
              </button>
            );
          })}
        </div>

        <Button block disabled={choice === null} onClick={() => choice && selectCompany(choice)}>
          Continuar
        </Button>
      </div>
    </div>
  );
}
