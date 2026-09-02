import { NavLink } from 'react-router-dom';
import { usePermissions } from '../authz/usePermissions';
import { NAVIGATION } from './navigation';

/**
 * Navegação lateral por módulo (UI-004 / UI-005).
 *
 * Itens sem permissão aparecem desabilitados com o aviso "Sem permissão no
 * perfil" — como nas telas — em vez de sumirem, para que o usuário saiba que o
 * módulo existe e possa pedir acesso.
 */
export function Sidebar() {
  const { allows } = usePermissions();
  const denied = NAVIGATION.filter((item) => !allows(item.permissions));

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__brand-name">SGE</span>
        <span className="sidebar__brand-tagline">Sistema Integrado</span>
      </div>

      <nav className="sidebar__nav" aria-label="Módulos">
        {NAVIGATION.map((item) => {
          if (!allows(item.permissions)) {
            return (
              <span
                key={item.path}
                className="sidebar__link sidebar__link--denied"
                aria-disabled="true"
                title="Sem permissão no perfil"
              >
                {item.label}
              </span>
            );
          }
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `sidebar__link${isActive ? ' sidebar__link--active' : ''}`
              }
            >
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      {denied.length > 0 ? (
        <p className="sidebar__denied-hint">Sem permissão no perfil: {denied.length} módulo(s)</p>
      ) : null}

      <div className="sidebar__footer">© 2026 SGE — Gestão Empresarial e Financeira</div>
    </aside>
  );
}
