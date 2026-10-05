import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';

const TABS = [
  { to: '/admin', label: 'Asistencia', end: true },
  { to: '/admin/empleados', label: 'Empleados' },
  { to: '/admin/importar', label: 'Importar Excel' },
  { to: '/admin/fotos', label: 'Fotos masivas' },
  { to: '/admin/usuarios', label: 'Usuarios' },
];

export default function AdminLayout() {
  const { usuario, logout } = useAuth();

  return (
    <div className="admin">
      <a href="#contenido" className="skip-link">
        Saltar al contenido
      </a>
      <header className="admin-header">
        <div className="admin-brand">
          <span className="brand-star" aria-hidden="true">★</span>
          <span>
            Fiesta de fin de año <small>· Panel RRHH</small>
          </span>
        </div>
        <div className="admin-user">
          <span className="muted-on-dark">{usuario?.nombre}</span>
          <NavLink to="/scanner" className="btn btn-ghost btn-sm">
            Abrir escáner
          </NavLink>
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </header>
      <nav className="admin-tabs" aria-label="Secciones del panel">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab ${isActive ? 'is-active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <main id="contenido" className="admin-main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
