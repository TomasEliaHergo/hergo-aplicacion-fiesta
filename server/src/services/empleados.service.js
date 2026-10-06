import { getSupabase, traerTodo } from '../lib/supabase.js';
import { check, errores } from '../lib/errors.js';
import { fotoUrl, borrarFotos } from '../lib/storage.js';

const COLS_VISTA = 'id, documento, nombre, empresa, sector, foto_path, asistio, escaneado_at, escaneado_por_nombre, created_at, updated_at';
const COLS_TABLA = 'id, documento, nombre, empresa, sector, foto_path, created_at, updated_at';
const DUP_MSG = 'Ya existe un empleado con ese documento';

/** Fila de v_empleados -> objeto Empleado del contrato (foto_url calculada, sin foto_path). */
export function aEmpleado(row) {
  const { foto_path, ...resto } = row;
  return {
    id: resto.id,
    documento: resto.documento,
    nombre: resto.nombre,
    empresa: resto.empresa,
    sector: resto.sector,
    foto_url: fotoUrl(foto_path),
    asistio: Boolean(resto.asistio),
    escaneado_at: resto.escaneado_at ?? null,
    escaneado_por_nombre: resto.escaneado_por_nombre ?? null,
    created_at: resto.created_at,
    updated_at: resto.updated_at,
  };
}

/** Quita caracteres con significado en la sintaxis de filtros de PostgREST. */
function sanitizarBusqueda(q) {
  return q.replace(/[,()"\%*_:]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function listar({ q, empresa, sector, asistio, page, pageSize, orden }) {
  let query = getSupabase().from('v_empleados').select(COLS_VISTA, { count: 'exact' });
  if (q) {
    const texto = sanitizarBusqueda(q);
    const digitos = q.replace(/[.\s-]/g, '');
    if (/^\d+$/.test(digitos)) {
      query = query.or(`documento.like.${digitos}*,nombre.ilike.*${texto}*`);
    } else if (texto) {
      query = query.ilike('nombre', `%${texto}%`);
    }
  }
  if (empresa !== undefined) query = query.eq('empresa', empresa);
  if (sector !== undefined) query = query.eq('sector', sector);
  if (asistio !== undefined) query = query.eq('asistio', asistio);
  if (orden === 'escaneado_at') query = query.order('escaneado_at', { ascending: false, nullsFirst: false });
  query = query.order('nombre', { ascending: true }).order('id', { ascending: true });
  const desde = (page - 1) * pageSize;
  const { data, count } = check(await query.range(desde, desde + pageSize - 1));
  return { items: (data ?? []).map(aEmpleado), total: count ?? 0, page, pageSize };
}

export async function filtros() {
  const filas = await traerTodo((d, h) =>
    getSupabase().from('empleados').select('empresa, sector').order('id').range(d, h));
  const orden = (a, b) => a.localeCompare(b, 'es');
  const empresas = [...new Set(filas.map((f) => f.empresa).filter(Boolean))].sort(orden);
  const sectores = [...new Set(filas.map((f) => f.sector).filter(Boolean))].sort(orden);
  return { empresas, sectores };
}

export async function obtener(id) {
  const data = check(await getSupabase().from('v_empleados').select(COLS_VISTA).eq('id', id).maybeSingle());
  if (!data) throw errores.noEncontrado('Empleado no encontrado');
  return aEmpleado(data);
}

/** Fila cruda de la tabla (incluye foto_path / qr_token). */
export async function obtenerFila(id, cols = 'id, documento, foto_path') {
  const data = check(await getSupabase().from('empleados').select(cols).eq('id', id).maybeSingle());
  if (!data) throw errores.noEncontrado('Empleado no encontrado');
  return data;
}

/** 1 round trip: un empleado recién creado no puede tener asistencia. */
export async function crear(datos) {
  const fila = check(
    await getSupabase().from('empleados')
      .insert({ documento: datos.documento, nombre: datos.nombre, empresa: datos.empresa ?? '', sector: datos.sector ?? '' })
      .select(COLS_TABLA).single(),
    { duplicadoMensaje: DUP_MSG },
  );
  return aEmpleado({ ...fila, asistio: false, escaneado_at: null, escaneado_por_nombre: null });
}

export async function actualizar(id, datos) {
  const cambios = {};
  for (const k of ['documento', 'nombre', 'empresa', 'sector']) if (datos[k] !== undefined) cambios[k] = datos[k];
  if (Object.keys(cambios).length === 0) return obtener(id);
  // En paralelo (1 round trip de latencia): el update devuelve la fila nueva y la
  // asistencia se lee aparte (el update no la toca).
  const sb = getSupabase();
  const [resUpdate, resAsistencia] = await Promise.all([
    sb.from('empleados').update(cambios).eq('id', id).select(COLS_TABLA).maybeSingle(),
    sb.from('v_empleados').select('asistio, escaneado_at, escaneado_por_nombre').eq('id', id).maybeSingle(),
  ]);
  const fila = check(resUpdate, { duplicadoMensaje: DUP_MSG });
  if (!fila) throw errores.noEncontrado('Empleado no encontrado');
  const asistencia = check(resAsistencia) ?? {};
  return aEmpleado({ ...fila, ...asistencia });
}

export async function eliminar(id, log) {
  // delete ... returning foto_path: 1 round trip en vez de leer + borrar.
  const borradas = check(await getSupabase().from('empleados').delete().eq('id', id).select('id, foto_path'));
  if (!borradas?.length) throw errores.noEncontrado('Empleado no encontrado');
  await borrarFotos([borradas[0].foto_path], log);
}

export async function obtenerQr(id) {
  const fila = await obtenerFila(id, 'qr_token');
  return { qr_token: fila.qr_token };
}

/**
 * Busca por documento (ya normalizado) para el endpoint público.
 * Dos consultas en paralelo (1 round trip de latencia): la tabla trae qr_token y la
 * vista el estado de ingreso (la vista no expone qr_token).
 * @returns {Promise<null | {nombre, empresa, qr_token, ingreso:boolean, escaneado_at:string|null}>}
 */
export async function buscarPorDocumento(documento) {
  const sb = getSupabase();
  const [resEmp, resVista] = await Promise.all([
    sb.from('empleados').select('nombre, empresa, qr_token').eq('documento', documento).maybeSingle(),
    sb.from('v_empleados').select('asistio, escaneado_at').eq('documento', documento).maybeSingle(),
  ]);
  const emp = check(resEmp);
  if (!emp) return null;
  const vista = check(resVista);
  return { ...emp, ingreso: Boolean(vista?.asistio), escaneado_at: vista?.escaneado_at ?? null };
}

/** Formato de qr_token: 32 bytes en base64url sin padding = 43 caracteres. */
export const QR_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
export const tokenQrValido = (t) => typeof t === 'string' && QR_TOKEN_REGEX.test(t);

let avisoSinFuncionEstado = false;

/**
 * Estado público de ingreso por qr_token. 1 round trip (RPC estado_por_token).
 * Si la función todavía no existe en la base (migración 001 sin correr) cae a 2
 * consultas en serie y lo avisa una vez en el log.
 * @returns {Promise<null | {nombre:string, ingreso:boolean, escaneado_at:string|null}>}
 */
export async function estadoPorToken(token, log) {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('estado_por_token', { p_token: token });
  if (!error) {
    const r = Array.isArray(data) ? data[0] : data;
    if (!r) return null;
    return { nombre: r.nombre, ingreso: r.escaneado_at != null, escaneado_at: r.escaneado_at ?? null };
  }
  // PGRST202 = PostgREST no encuentra la función; 42883 = undefined_function (Postgres).
  if (error.code !== 'PGRST202' && error.code !== '42883') check({ data, error });
  if (!avisoSinFuncionEstado) {
    avisoSinFuncionEstado = true;
    log?.warn('Falta la función estado_por_token: correr server/db/migraciones/001_estado_por_token.sql en Supabase');
  }
  const emp = check(await sb.from('empleados').select('id, nombre').eq('qr_token', token).maybeSingle());
  if (!emp) return null;
  const a = check(await sb.from('asistencias').select('escaneado_at').eq('empleado_id', emp.id).maybeSingle());
  return { nombre: emp.nombre, ingreso: Boolean(a), escaneado_at: a?.escaneado_at ?? null };
}
