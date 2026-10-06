import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ClipboardCheck,
  FileSpreadsheet,
  Images,
  LogOut,
  Menu,
  ScanLine,
  Sparkles,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthContext.jsx';
import Avatar from '../../components/Avatar.jsx';
import { useTheme } from '../../hooks/hooks.js';
import { preload } from '../../hooks/useApi.js';
import { prefetch, whenIdle } from '../../routes.js';
import { ROL_LABEL } from '../../utils.js';
import { fetchPanel, fetchUsuarios } from './data.js';
import '../../styles/admin.css';

const NAV = [
  { to: '/admin', label: 'Asistencia', icon: ClipboardCheck, end: true, chunk: 'dashboard', data: ['panel', fetchPanel] },
  { to: '/admin/empleados', label: 'Empleados', icon: Users, chunk: 'empleados' },
  { to: '/admin/importar', label: 'Importar', icon: FileSpreadsheet, chunk: 'importar' },
  { to: '/admin/fotos', label: 'Fotos', icon: Images, chunk: 'fotos' },
  { to: '/admin/usuarios', label: 'Usuarios', icon: UserCog, chunk: 'usuarios', data: ['usuarios', fetchUsuarios] },
];

/** Al pasar el mouse / enfocar un ítem: baja el chunk de la página y, si aplica, sus datos. */
function precargar(item) {
  prefetch(item.chunk);
  if (item.data) preload(item.data[0], item.data[1]);
}

function Brand() {
  return (
    <Link to="/admin" className="brand">
      <span className="brand-mark" aria-hidden="true">
        <Sparkles size={18} />
      </span>
      <span className="brand-text">
        <strong>Fiesta Hergo</strong>
        <small>Panel RRHH</small>
      </span>
    </Link>
  );
}

function NavContent({ usuario, onLogout }) {
  return (
    <>
      <nav className="side-nav" aria-label="Secciones del panel">
        <ul>
          {NAV.map((it) => (
            <li key={it.to}>
              <NavLink
                to={it.to}
                end={it.end}
                className={({ isActive }) => `side-link ${isActive ? 'is-active' : ''}`}
                onMouseEnter={() => precargar(it)}
                onFocus={() => precargar(it)}
                onTouchStart={() => precargar(it)}
              >
                <it.icon size={18} aria-hidden="true" />
                <span>{it.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="side-sep" role="separator" />
        <Link to="/scanner" className="side-link" onMouseEnter={() => prefetch('scanner')} onFocus={() => prefetch('scanner')}>
          <ScanLine size={18} aria-hidden="true" />
          <span>Abrir escáner</span>
        </Link>
      </nav>

      <div className="side-user">
        <Avatar nombre={usuario?.nombre || '?'} size={36} />
        <div className="side-user-text">
          <strong>{usuario?.nombre}</strong>
          <small>{ROL_LABEL[usuario?.rol] || usuario?.rol}</small>
        </div>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onLogout} aria-label="Cerrar sesión" title="Cerrar sesión">
          <LogOut size={18} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

/** Drawer para pantallas < 1024px. <dialog> nativo: foco atrapado, Esc cierra, fondo inerte. */
function Drawer({ open, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return undefined;
    const onCancel = (e) => {
      e.preventDefault();
      onClose();
    };
    dlg.addEventListener('cancel', onCancel);
    return () => dlg.removeEventListener('cancel', onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label="Menú"
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="drawer-inner">
        <div className="drawer-head">
          <Brand />
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar menú">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export default function AdminLayout() {
  useTheme('light');
  const { usuario, logout } = useAuth();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const mainRef = useRef(null);

  // Precarga el resto de las páginas en tiempo ocioso: navegar entre pestañas es instantáneo.
  useEffect(() => {
    whenIdle(() => prefetch('dashboard', 'empleados', 'usuarios', 'importar', 'fotos'));
  }, []);

  // Al navegar: cierra el drawer y lleva el foco al contenido.
  const primera = useRef(true);
  useEffect(() => {
    setDrawer(false);
    if (primera.current) {
      primera.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <div className="admin-shell">
      <a href="#contenido" className="skip-link">
        Saltar al contenido
      </a>

      <aside className="sidebar" aria-label="Navegación principal">
        <Brand />
        <NavContent usuario={usuario} onLogout={logout} />
      </aside>

      <header className="topbar">
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => setDrawer(true)}
          aria-label="Abrir menú"
          aria-expanded={drawer}
        >
          <Menu size={22} aria-hidden="true" />
        </button>
        <Brand />
        <Link to="/scanner" className="btn btn-ghost btn-icon topbar-scan" aria-label="Abrir escáner" title="Abrir escáner">
          <ScanLine size={20} aria-hidden="true" />
        </Link>
      </header>

      <Drawer open={drawer} onClose={() => setDrawer(false)}>
        <NavContent usuario={usuario} onLogout={logout} />
      </Drawer>

      <main id="contenido" className="admin-main" tabIndex={-1} ref={mainRef}>
        <div className="admin-container">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
