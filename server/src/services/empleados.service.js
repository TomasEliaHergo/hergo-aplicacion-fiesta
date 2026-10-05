import { getSupabase, traerTodo } from '../lib/supabase.js';
import { check, errores } from '../lib/errors.js';
import { fotoUrl, borrarFotos } from '../lib/storage.js';

const COLS_VISTA = 'id, documento, nombre, empresa, sector, foto_path, asistio, escaneado_at, escaneado_por_nombre, created_at, updated_at';
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

export async function crear(datos) {
  const fila = check(
    await getSupabase().from('empleados')
      .insert({ documento: datos.documento, nombre: datos.nombre, empresa: datos.empresa ?? '', sector: datos.sector ?? '' })
      .select('id').single(),
    { duplicadoMensaje: DUP_MSG },
  );
  return obtener(fila.id);
}

export async function actualizar(id, datos) {
  const cambios = {};
  for (const k of ['documento', 'nombre', 'empresa', 'sector']) if (datos[k] !== undefined) cambios[k] = datos[k];
  if (Object.keys(cambios).length === 0) return obtener(id);
  const fila = check(
    await getSupabase().from('empleados').update(cambios).eq('id', id).select('id').maybeSingle(),
    { duplicadoMensaje: DUP_MSG },
  );
  if (!fila) throw errores.noEncontrado('Empleado no encontrado');
  return obtener(id);
}

export async function eliminar(id, log) {
  const fila = await obtenerFila(id);
  const borradas = check(await getSupabase().from('empleados').delete().eq('id', id).select('id'));
  if (!borradas?.length) throw errores.noEncontrado('Empleado no encontrado');
  await borrarFotos([fila.foto_path], log);
}

export async function obtenerQr(id) {
  const fila = await obtenerFila(id, 'qr_token');
  return { qr_token: fila.qr_token };
}

/** Busca por documento (ya normalizado) para el endpoint público. */
export async function buscarPorDocumento(documento) {
  return check(await getSupabase().from('empleados')
    .select('nombre, empresa, qr_token').eq('documento', documento).maybeSingle());
}
