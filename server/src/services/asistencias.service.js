import { getSupabase, traerTodo } from '../lib/supabase.js';
import { check, errores } from '../lib/errors.js';
import { fotoUrl } from '../lib/storage.js';
import { generarXlsx } from '../lib/excel.js';
import { formatoAR, sufijoArchivoAR } from '../lib/fechas.js';
import { logger } from '../lib/logger.js';
import { tokenQrValido } from './empleados.service.js';

const INVALIDO_REGISTRO = Object.freeze({ estado: 'INVALIDO', empleado: null, escaneado_at: null });
const INVALIDO_VERIFICACION = Object.freeze({ estado: 'INVALIDO', empleado: null, escaneado_at: null, escaneado_por_nombre: null });

const primeraFila = (data) => (Array.isArray(data) ? data[0] : data) ?? null;

const aEmpleadoScan = (r, urlFoto) => ({
  id: r.empleado_id ?? null,
  nombre: r.nombre,
  documento: r.documento,
  empresa: r.empresa,
  sector: r.sector,
  foto_url: urlFoto(r.foto_path),
});

/**
 * Fila de la RPC registrar_asistencia -> respuesta de POST /api/scan y /api/scan/confirmar.
 * Pura (urlFoto inyectable para tests).
 */
export function aResultadoRegistro(data, urlFoto = fotoUrl) {
  const r = primeraFila(data);
  if (!r || r.estado === 'INVALIDO') return { ...INVALIDO_REGISTRO };
  return { estado: r.estado, empleado: aEmpleadoScan(r, urlFoto), escaneado_at: r.escaneado_at ?? null };
}

/**
 * Filas de la RPC verificar_qr -> respuesta de POST /api/scan/verificar.
 * 0 filas = token inexistente (INVALIDO). Pura (urlFoto inyectable para tests).
 */
export function aResultadoVerificacion(data, urlFoto = fotoUrl) {
  const r = primeraFila(data);
  if (!r) return { ...INVALIDO_VERIFICACION };
  const yaIngreso = r.estado === 'YA_INGRESO' || r.escaneado_at != null;
  return {
    estado: yaIngreso ? 'YA_INGRESO' : 'PENDIENTE',
    empleado: aEmpleadoScan(r, urlFoto),
    escaneado_at: yaIngreso ? r.escaneado_at ?? null : null,
    escaneado_por_nombre: yaIngreso ? r.escaneado_por_nombre ?? null : null,
  };
}

/** PGRST202 = PostgREST no encuentra la función; 42883 = undefined_function (Postgres). */
const esFuncionFaltante = (error) => error?.code === 'PGRST202' || error?.code === '42883';

function errorMigracion002(error) {
  return Object.assign(
    new Error('Falta la migración 002: correr server/db/migraciones/002_confirmacion_ingreso.sql en Supabase'),
    { cause: error },
  );
}

/** Registra el ingreso vía RPC atómica registrar_asistencia (OK | YA_INGRESO | INVALIDO). */
export async function registrar(token, usuarioId) {
  // Formato inválido => INVALIDO sin tocar la DB.
  if (!tokenQrValido(token)) return { ...INVALIDO_REGISTRO };
  const data = check(await getSupabase().rpc('registrar_asistencia', { p_token: token, p_usuario: usuarioId }));
  return aResultadoRegistro(data);
}

/** Solo lectura: PENDIENTE | YA_INGRESO | INVALIDO. 1 round trip (RPC verificar_qr). */
export async function verificar(token) {
  if (!tokenQrValido(token)) return { ...INVALIDO_VERIFICACION };
  const { data, error } = await getSupabase().rpc('verificar_qr', { p_token: token });
  if (esFuncionFaltante(error)) throw errorMigracion002(error);
  return aResultadoVerificacion(check({ data, error }));
}

/**
 * Registra un rechazo ("No es la persona") para auditoría. NO registra asistencia.
 * @returns {Promise<string|null>} empleado_id, o null si el token no existe.
 */
export async function rechazar(token, usuarioId, motivo) {
  if (!tokenQrValido(token)) return null;
  const { data, error } = await getSupabase().rpc('registrar_rechazo', {
    p_token: token, p_usuario: usuarioId, p_motivo: motivo || null,
  });
  if (esFuncionFaltante(error)) throw errorMigracion002(error);
  const r = check({ data, error });
  // Escalar (supabase-js y cliente local); tolerante a una fila/objeto por si cambia el formato.
  const fila = primeraFila(r);
  if (fila && typeof fila === 'object') return Object.values(fila)[0] ?? null;
  return fila;
}

const porcentaje = (p, t) => (t > 0 ? Math.round((p / t) * 1000) / 10 : 0);

/** Convierte las filas del rollup en la estructura del contrato. Pura (exportada para tests). */
export function armarResumen(filas, ahora = new Date(), rechazos = null) {
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
    // Rechazos en la puerta ("No es la persona"); null si no se pudo contar (migración 002 sin correr).
    rechazos: rechazos === null || rechazos === undefined ? null : Number(rechazos),
    actualizadoAt: ahora.toISOString(),
  };
}

let avisoSinRechazos = false;

export async function resumen() {
  const sb = getSupabase();
  // En paralelo: 1 round trip de latencia.
  const [resResumen, resRechazos] = await Promise.all([
    sb.rpc('resumen_asistencias'),
    sb.from('rechazos').select('id', { count: 'exact', head: true }),
  ]);
  const data = check(resResumen);
  if (resRechazos.error && !avisoSinRechazos) {
    // No rompe el dashboard si falta la tabla (migración 002 sin correr): rechazos = null.
    avisoSinRechazos = true;
    logger.warn({ err: resRechazos.error }, 'No se pudieron contar los rechazos (¿falta la migración 002?)');
  }
  return armarResumen(data, new Date(), resRechazos.error ? null : resRechazos.count ?? 0);
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
