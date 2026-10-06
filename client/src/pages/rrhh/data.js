import { api } from '../../api.js';
import { setCache } from '../../hooks/useApi.js';

// Nota: /panel y /filtros mandan Cache-Control max-age=10; se piden con cache 'no-cache' para que una
// revalidación tras una acción (p. ej. deshacer ingreso) no traiga una copia vieja del navegador.
// El cache en memoria de useApi ya cubre el cambio instantáneo de pestañas.

// Fetchers compartidos del panel (los usan las páginas y la precarga al pasar el mouse por el menú).

const FILTROS_VACIOS = { empresas: [], sectores: [] };
let panelDisponible = true; // se apaga si el backend todavía no tiene /asistencias/panel

function normFiltros(f) {
  return { empresas: f?.empresas || [], sectores: f?.sectores || [] };
}

/** Resumen + filtros en una sola llamada (con fallback a las dos llamadas viejas). */
export async function fetchPanel({ signal } = {}) {
  if (panelDisponible) {
    try {
      const p = await api.get('/asistencias/panel', null, { signal, cache: 'no-cache' });
      const filtros = normFiltros(p?.filtros);
      setCache('filtros', filtros);
      return { resumen: p?.resumen ?? null, filtros };
    } catch (err) {
      if (err?.status !== 404) throw err;
      panelDisponible = false;
    }
  }
  const [resumen, filtros] = await Promise.all([
    api.get('/asistencias/resumen', null, { signal }),
    api
      .get('/empleados/filtros', null, { signal, cache: 'no-cache' })
      .then(normFiltros)
      .catch((err) => {
        if (err?.name === 'AbortError') throw err;
        return FILTROS_VACIOS;
      }),
  ]);
  setCache('filtros', filtros);
  return { resumen, filtros };
}

export async function fetchFiltros({ signal } = {}) {
  return normFiltros(await api.get('/empleados/filtros', null, { signal, cache: 'no-cache' }));
}

export async function fetchUsuarios({ signal } = {}) {
  const data = await api.get('/usuarios', null, { signal });
  return Array.isArray(data) ? data : data?.items || [];
}

/** Key de cache para un listado de empleados (prefijo "emp:" para invalidar todos juntos). */
export function empleadosKey(params) {
  const clean = {};
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) clean[k] = String(v);
  return `emp:${new URLSearchParams(clean).toString()}`;
}

export function fetchEmpleados(params) {
  return async ({ signal } = {}) => {
    const data = await api.get('/empleados', params, { signal });
    return { items: data?.items || [], total: data?.total || 0 };
  };
}

/** Todos los empleados sin foto (GET /empleados?foto=sin, paginando de a 200). */
export async function fetchSinFoto({ signal } = {}) {
  const pageSize = 200;
  const items = [];
  for (let page = 1; ; page++) {
    const data = await api.get('/empleados', { foto: 'sin', pageSize, page }, { signal });
    const lote = data?.items || [];
    items.push(...lote);
    if (lote.length < pageSize || items.length >= (data?.total ?? 0)) break;
  }
  return items;
}

export const DASH_LIST_DEFAULT = { orden: 'nombre', page: 1, pageSize: 50 };
export const FILTROS_DEFAULT = FILTROS_VACIOS;
