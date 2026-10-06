import { getSupabase } from '../lib/supabase.js';
import { AppError, check, errores } from '../lib/errors.js';
import { hashPassword, verificarPassword, necesitaRehash } from '../lib/passwords.js';
import { recordarUsuario } from '../middleware/requireAuth.js';

export const COLS_USUARIO = 'id, username, nombre, rol, activo, created_at';

export async function login(username, password, log) {
  const u = check(await getSupabase().from('usuarios')
    .select(`${COLS_USUARIO}, password_hash`).eq('username', username.toLowerCase()).maybeSingle());
  // Siempre se ejecuta bcrypt (hash señuelo si no existe) para no filtrar por tiempos.
  const ok = await verificarPassword(password, u?.password_hash);
  if (!u || !ok || !u.activo) throw new AppError(401, 'CREDENCIALES_INVALIDAS', 'Usuario o contraseña incorrectos');
  const { password_hash, ...usuario } = u;
  if (necesitaRehash(password_hash)) {
    // Hash viejo (costo 12): se migra al costo actual para que los próximos logins sean rápidos.
    // Best effort: si falla, el login igual sale bien.
    try {
      const nuevo = await hashPassword(password);
      const { error } = await getSupabase().from('usuarios').update({ password_hash: nuevo }).eq('id', u.id);
      if (error) throw error;
    } catch (err) {
      log?.warn({ err, usuarioId: u.id }, 'No se pudo rehashear la contraseña');
    }
  }
  recordarUsuario(usuario);
  return usuario;
}

export async function obtener(id) {
  const u = check(await getSupabase().from('usuarios').select(COLS_USUARIO).eq('id', id).maybeSingle());
  if (!u) throw errores.noEncontrado('Usuario no encontrado');
  return u;
}

export async function listar({ rol, activo }) {
  let q = getSupabase().from('usuarios').select(COLS_USUARIO);
  if (rol !== undefined) q = q.eq('rol', rol);
  if (activo !== undefined) q = q.eq('activo', activo);
  return check(await q.order('rol').order('nombre'));
}

export async function crear({ username, nombre, rol, password }) {
  const password_hash = await hashPassword(password);
  return check(
    await getSupabase().from('usuarios').insert({ username, nombre, rol, password_hash }).select(COLS_USUARIO).single(),
    { duplicadoMensaje: 'Ya existe un usuario con ese nombre de usuario' },
  );
}

async function contarRrhhActivos() {
  const { count } = check(await getSupabase().from('usuarios')
    .select('id', { count: 'exact', head: true }).eq('rol', 'rrhh').eq('activo', true));
  return count ?? 0;
}

/**
 * Reglas de negocio (puras, exportadas para tests).
 * @returns {null | 'OPERACION_SOBRE_SI_MISMO' | 'VERIFICAR_ULTIMO_RRHH'}
 */
export function evaluarCambioUsuario(actual, cambios, actorId) {
  const cambiaRol = cambios.rol !== undefined && cambios.rol !== actual.rol;
  const desactiva = cambios.activo === false && actual.activo;
  if (actual.id === actorId && (cambiaRol || desactiva)) return 'OPERACION_SOBRE_SI_MISMO';
  if (actual.rol === 'rrhh' && actual.activo && (cambiaRol || desactiva)) return 'VERIFICAR_ULTIMO_RRHH';
  return null;
}

export async function actualizar(id, cambios, actor) {
  // Si el cambio podría dejar sin RRHH activos, el conteo se pide en paralelo con la
  // lectura del usuario (1 round trip de latencia en vez de 2).
  const puedeQuitarRrhh = cambios.rol !== undefined || cambios.activo === false;
  const [actual, rrhhActivos] = await Promise.all([obtener(id), puedeQuitarRrhh ? contarRrhhActivos() : null]);
  const regla = evaluarCambioUsuario(actual, cambios, actor.id);
  if (regla === 'OPERACION_SOBRE_SI_MISMO') {
    throw new AppError(409, 'OPERACION_SOBRE_SI_MISMO', 'No podés desactivarte ni cambiarte el rol a vos mismo');
  }
  if (regla === 'VERIFICAR_ULTIMO_RRHH' && rrhhActivos <= 1) {
    throw new AppError(409, 'ULTIMO_RRHH', 'No se puede quitar al último usuario RRHH activo');
  }
  const payload = {};
  for (const k of ['nombre', 'rol', 'activo']) if (cambios[k] !== undefined) payload[k] = cambios[k];
  if (Object.keys(payload).length === 0) return actual;
  const u = check(await getSupabase().from('usuarios').update(payload).eq('id', id).select(COLS_USUARIO).maybeSingle());
  if (!u) throw errores.noEncontrado('Usuario no encontrado');
  recordarUsuario(u); // en esta instancia el cambio (rol/activo) aplica de inmediato
  return u;
}

export async function cambiarPassword(id, password) {
  const password_hash = await hashPassword(password);
  const u = check(await getSupabase().from('usuarios').update({ password_hash }).eq('id', id).select('id').maybeSingle());
  if (!u) throw errores.noEncontrado('Usuario no encontrado');
}
