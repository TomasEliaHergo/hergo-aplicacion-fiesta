import { getSupabase, traerTodo } from '../lib/supabase.js';
import { check, errores } from '../lib/errors.js';
import { fotoUrl } from '../lib/storage.js';
import { generarXlsx } from '../lib/excel.js';
import { formatoAR, sufijoArchivoAR } from '../lib/fechas.js';

/** Escaneo vía RPC atómica registrar_asistencia. */
export async function registrar(token, usuarioId) {
  const data = check(await getSupabase().rpc('registrar_asistencia', { p_token: token, p_usuario: usuarioId }));
  const r = Array.isArray(data) ? data[0] : data;
  if (!r || r.estado === 'INVALIDO') return { estado: 'INVALIDO', empleado: null, escaneado_at: null };
  return {
    estado: r.estado,
    empleado: {
      nombre: r.nombre, documento: r.documento, empresa: r.empresa, sector: r.sector, foto_url: fotoUrl(r.foto_path),
    },
    escaneado_at: r.escaneado_at,
  };
}

const porcentaje = (p, t) => (t > 0 ? Math.round((p / t) * 1000) / 10 : 0);

/** Convierte las filas del rollup en la estructura del contrato. Pura (exportada para tests). */
export function armarResumen(filas, ahora = new Date()) {
  let total = 0;
  let presentes = 0;
  const empresas = new Map();
  for (const f of filas ?? []) {
    const t = Number(f.total);
    const p = Number(f.presentes);
    if (f.empresa === null && f.sector === null) { total = t; presentes = p; continue; }
    if (!empresas.has(f.empresa)) empresas.set(f.empresa, { empresa: f.empresa, total: 0, presentes: 0, sectores: [] });
    const e = empresas.get(f.empresa);
    if (f.sector === null) { e.total = t; e.presentes = p; } else e.sectores.push({ sector: f.sector, total: t, presentes: p });
  }
  return {
    total,
    presentes,
    ausentes: total - presentes,
    porcentaje: porcentaje(presentes, total),
    porEmpresa: [...empresas.values()],
    actualizadoAt: ahora.toISOString(),
  };
}

export async function resumen() {
  const data = check(await getSupabase().rpc('resumen_asistencias'));
  return armarResumen(data);
}

export async function exportar({ empresa, sector }) {
  const filas = await traerTodo((d, h) => {
    let q = getSupabase().from('v_empleados')
      .select('documento, nombre, empresa, sector, asistio, escaneado_at, escaneado_por_nombre');
    if (empresa !== undefined) q = q.eq('empresa', empresa);
    if (sector !== undefined) q = q.eq('sector', sector);
    return q.order('empresa').order('sector').order('nombre').order('id').range(d, h);
  });
  const encabezados = ['Documento', 'Nombre', 'Empresa', 'Sector', 'Hora ingreso', 'Escaneado por'];
  const aFila = (r) => ({
    Documento: r.documento, Nombre: r.nombre, Empresa: r.empresa, Sector: r.sector,
    'Hora ingreso': formatoAR(r.escaneado_at), 'Escaneado por': r.escaneado_por_nombre ?? '',
  });
  const presentes = filas.filter((r) => r.asistio)
    .sort((a, b) => String(a.escaneado_at).localeCompare(String(b.escaneado_at))).map(aFila);
  const ausentes = filas.filter((r) => !r.asistio).map(aFila);
  const anchos = [14, 34, 20, 20, 20, 18];
  const buffer = await generarXlsx([
    { nombre: 'Presentes', filas: presentes, encabezados, anchos },
    { nombre: 'Ausentes', filas: ausentes, encabezados, anchos },
  ]);
  return { buffer, nombreArchivo: `asistencia-${sufijoArchivoAR()}.xlsx` };
}

export async function deshacer(empleadoId) {
  const borradas = check(await getSupabase().from('asistencias').delete().eq('empleado_id', empleadoId).select('id, escaneado_at'));
  if (!borradas?.length) throw errores.noEncontrado('El empleado no tenía ingreso registrado');
  return borradas[0];
}
