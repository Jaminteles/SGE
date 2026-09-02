import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '../authz/usePermissions';
import { useCompany } from '../company/company-context';
import { NAVIGATION, type NavItem } from '../layout/navigation';
import { formatCnpj } from '../lib/format';
import { Badge } from '../ui/Badge';
import { DataTable, type Column } from '../ui/DataTable';
import { FilterBar, type FilterValues } from '../ui/FilterBar';
import { Pagination } from '../ui/Pagination';

const PAGE_SIZE = 8;

/**
 * Início da área autenticada (UI-005).
 *
 * Enquanto as telas de cada módulo não chegam (sprints 19 a 24), esta página
 * mostra o contexto da sessão — empresa ativa, perfil — e o que o perfil
 * libera, usando os componentes base (tabela, filtros e paginação).
 */
export function HomePage() {
  const { activeCompany } = useCompany();
  const { allows, isSuperAdmin } = usePermissions();
  const [filters, setFilters] = useState<FilterValues>({ q: '', access: '' });
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const term = filters.q.trim().toLowerCase();
    return NAVIGATION.filter((item) => item.path !== '/').filter((item) => {
      if (term !== '' && !item.label.toLowerCase().includes(term)) return false;
      if (filters.access === 'liberado' && !allows(item.permissions)) return false;
      if (filters.access === 'bloqueado' && allows(item.permissions)) return false;
      return true;
    });
  }, [filters, allows]);

  const total = rows.length;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const columns: Column<NavItem>[] = [
    {
      key: 'modulo',
      header: 'Módulo',
      render: (item) =>
        allows(item.permissions) ? <Link to={item.path}>{item.label}</Link> : item.label,
    },
    {
      key: 'permissoes',
      header: 'Permissões exigidas',
      render: (item) =>
        [...(item.permissions.all ?? []), ...(item.permissions.any ?? [])].join(', ') || '—',
    },
    {
      key: 'situacao',
      header: 'Situação',
      render: (item) =>
        allows(item.permissions) ? (
          <Badge tone="success">Liberado</Badge>
        ) : (
          <Badge tone="warning">Sem permissão</Badge>
        ),
    },
  ];

  return (
    <>
      <div className="page-header">
        <h1 className="page-header__title">Início</h1>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-5)' }}>
        <p className="page-header__title">
          {activeCompany?.company.tradeName ?? activeCompany?.company.legalName ?? '—'}
        </p>
        <p className="field__hint">
          {activeCompany?.company.taxId ? `CNPJ ${formatCnpj(activeCompany.company.taxId)} · ` : ''}
          Perfil: {activeCompany?.role.name ?? '—'}
          {isSuperAdmin ? ' · Administrador de plataforma' : ''}
        </p>
      </div>

      <div className="card">
        <div className="page-header">
          <h2 className="page-header__title">Módulos</h2>
        </div>

        <FilterBar
          values={filters}
          searchPlaceholder="Buscar módulo"
          filters={[
            {
              name: 'access',
              label: 'Situação',
              options: [
                { value: 'liberado', label: 'Liberado' },
                { value: 'bloqueado', label: 'Sem permissão' },
              ],
            },
          ]}
          onChange={(next) => {
            setFilters(next);
            setPage(1);
          }}
        />

        <DataTable
          caption="Módulos do sistema e permissões do perfil na empresa ativa"
          columns={columns}
          rows={pageRows}
          rowKey={(item) => item.path}
          emptyMessage="Nenhum módulo corresponde ao filtro."
        />

        <Pagination
          page={currentPage}
          pageSize={PAGE_SIZE}
          total={total}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      </div>
    </>
  );
}
