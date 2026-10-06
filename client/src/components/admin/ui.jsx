import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, MoreHorizontal, Search, X } from 'lucide-react';
import Avatar from '../Avatar.jsx';
import { formatDocumento, formatNumero } from '../../utils.js';

// Primitivas visuales del panel RRHH (solo se cargan en el chunk del panel).

export function PageHeader({ title, description, actions }) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1>{title}</h1>
        {description && <p className="page-header-desc">{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

/** Avatar + nombre + documento (celda principal de tablas y tarjetas). */
export function PersonCell({ nombre, foto_url, documento, extra, size = 36, busy = false }) {
  return (
    <div className="person">
      {busy ? (
        <span className="avatar person-busy" style={{ width: size, height: size }}>
          <span className="spinner" aria-hidden="true" />
          <span className="sr-only">Subiendo foto…</span>
        </span>
      ) : (
        <Avatar nombre={nombre} src={foto_url} size={size} />
      )}
      <div className="person-text">
        <span className="person-name">{nombre}</span>
        <span className="person-sub">
          {documento && <span className="mono">{formatDocumento(documento)}</span>}
          {extra}
        </span>
      </div>
    </div>
  );
}

export function Card({ title, actions, children, className = '', flush = false, ...rest }) {
  return (
    <section className={`card ${flush ? 'card-flush' : ''} ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Píldora de estado. tone: ok | neutral | accent | warn | danger | info */
export function Pill({ tone = 'neutral', dot = false, children, className = '' }) {
  return (
    <span className={`pill pill-${tone} ${className}`}>
      {dot && <span className="pill-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Segmented({ label, value, options, onChange }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, l, count]) => (
        <button
          key={v}
          type="button"
          className={value === v ? 'is-active' : ''}
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          {l}
          {count != null && <span className="segmented-count tabular">{formatNumero(count)}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ id, value, onChange, placeholder = 'Buscar', label = 'Buscar' }) {
  return (
    <div className="search">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search className="search-icon" size={16} aria-hidden="true" />
      <input
        id={id}
        type="search"
        className="input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        enterKeyHint="search"
      />
      {value && (
        <button type="button" className="search-clear" onClick={() => onChange('')} aria-label="Limpiar búsqueda">
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export function SelectFilter({ id, label, value, onChange, options, allLabel }) {
  return (
    <div className="select-filter">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty-state">
      {Icon && (
        <span className="empty-state-icon" aria-hidden="true">
          <Icon size={22} />
        </span>
      )}
      <p className="empty-state-title">{title}</p>
      {children && <p className="empty-state-text">{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ w = '100%', h = 14, r, className = '' }) {
  return <span className={`skeleton ${className}`} style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

/** Filas fantasma para la primera carga (tabla o tarjetas según el layout). */
export function ListSkeleton({ rows = 6, cards = false }) {
  return (
    <div className={cards ? 'skeleton-cards' : 'skeleton-rows'} role="status" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <Skeleton w={36} h={36} r="50%" />
          <div className="skeleton-row-text">
            <Skeleton w={`${50 + ((i * 17) % 35)}%`} h={13} />
            <Skeleton w={`${30 + ((i * 11) % 25)}%`} h={11} />
          </div>
          {!cards && <Skeleton w={72} h={22} r={999} />}
        </div>
      ))}
    </div>
  );
}

export function StatChip({ label, value, tone = 'neutral', icon: Icon }) {
  return (
    <div className={`stat-chip stat-chip-${tone}`}>
      {Icon && <Icon size={16} aria-hidden="true" />}
      <span className="stat-chip-label">{label}</span>
      <span className="stat-chip-value tabular">{formatNumero(value)}</span>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const desde = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const hasta = Math.min(total, page * pageSize);
  if (total === 0) return null;
  return (
    <nav className="pagination" aria-label="Paginación">
      <span className="pagination-info tabular">
        {formatNumero(desde)}–{formatNumero(hasta)} de {formatNumero(total)}
      </span>
      <div className="pagination-buttons">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          <span className="hide-sm">Anterior</span>
        </button>
        <span className="pagination-page tabular" aria-current="page">
          {page} / {pages}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          aria-label="Página siguiente"
        >
          <span className="hide-sm">Siguiente</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

/**
 * Menú de acciones "⋯" accesible.
 * items: [{ label, icon, onSelect, danger, disabled, title, separator }] (falsy se ignoran).
 * Se renderiza en un portal con position: fixed para no quedar cortado por la tabla.
 */
export function ActionMenu({ label, items }) {
  const visibles = items.filter(Boolean);
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  const close = (focusBtn = true) => {
    setOpen(false);
    if (focusBtn) btnRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;
    const r = btn.getBoundingClientRect();
    const h = menu.offsetHeight;
    const w = menu.offsetWidth;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.left = `${left}px`;
    menu.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = (e) => {
      // `resize` llega con target = window (no es un Node).
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const onKeyDown = (e) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])') || []);
    const i = nodes.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      nodes[(i + 1) % nodes.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nodes[(i - 1 + nodes.length) % nodes.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      nodes[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      nodes[nodes.length - 1]?.focus();
    }
  };

  if (visibles.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="btn btn-ghost btn-icon menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} id={menuId} className="menu" role="menu" aria-label={label} onKeyDown={onKeyDown}>
            {visibles.map((it, i) => (
              <div key={i} role="none">
                {it.separator && <div className="menu-sep" role="separator" />}
                <button
                  type="button"
                  role="menuitem"
                  className={`menu-item ${it.danger ? 'is-danger' : ''}`}
                  aria-disabled={it.disabled ? 'true' : undefined}
                  title={it.title}
                  tabIndex={-1}
                  onClick={() => {
                    if (it.disabled) return;
                    close();
                    it.onSelect();
                  }}
                >
                  {it.icon && <it.icon size={16} aria-hidden="true" />}
                  <span>{it.label}</span>
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
