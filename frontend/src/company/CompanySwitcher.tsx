import { useCompany } from './company-context';

/** Troca a empresa ativa sem sair da tela (RF-005 / UI-003). */
export function CompanySwitcher() {
  const { companies, activeCompanyId, selectCompany } = useCompany();

  if (companies.length <= 1) {
    const only = companies[0];
    return (
      <span className="topbar__name">
        {only ? (only.company.tradeName ?? only.company.legalName) : '—'}
      </span>
    );
  }

  return (
    <select
      className="company-switcher"
      aria-label="Empresa ativa"
      value={activeCompanyId ?? ''}
      onChange={(event) => selectCompany(event.target.value)}
    >
      {companies.map((membership) => (
        <option key={membership.companyId} value={membership.companyId}>
          {membership.company.tradeName ?? membership.company.legalName}
        </option>
      ))}
    </select>
  );
}
