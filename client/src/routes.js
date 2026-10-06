// Módulos cargados bajo demanda. Se usan tanto en React.lazy() como para precargar
// (mismo specifier => mismo chunk; el navegador reutiliza el módulo ya descargado).

export const loaders = {
  login: () => import('./pages/Login.jsx'),
  scanner: () => import('./pages/scanner/Scanner.jsx'),
  adminLayout: () => import('./pages/rrhh/AdminLayout.jsx'),
  dashboard: () => import('./pages/rrhh/Dashboard.jsx'),
  empleados: () => import('./pages/rrhh/Empleados.jsx'),
  importar: () => import('./pages/rrhh/Importar.jsx'),
  fotos: () => import('./pages/rrhh/Fotos.jsx'),
  usuarios: () => import('./pages/rrhh/Usuarios.jsx'),
};

const hechos = new Set();

/** Precarga uno o más chunks (ignora errores: si falla, se reintenta al navegar). */
export function prefetch(...nombres) {
  for (const n of nombres) {
    if (hechos.has(n) || !loaders[n]) continue;
    hechos.add(n);
    loaders[n]().catch(() => hechos.delete(n));
  }
}

const whenIdle = (fn) =>
  typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 300);

/** Tras el login: primero lo que se va a ver, después el resto en tiempo ocioso. */
export function prefetchForRole(rol) {
  if (rol === 'rrhh') {
    prefetch('adminLayout', 'dashboard');
    whenIdle(() => prefetch('empleados', 'usuarios', 'importar', 'fotos'));
  } else if (rol === 'scanner') {
    prefetch('scanner');
  }
}

export { whenIdle };
