import { verificarToken } from '../lib/jwt.js';
import { errores } from '../lib/errors.js';
import { getSupabase } from '../lib/supabase.js';

/**
 * Cada cuánto se re-valida contra la DB que el usuario siga activo y con el mismo rol.
 *
 * El JWT ya trae `rol` y `nombre` (firmados en el login, que exige activo=true) e `iat`.
 * Para no sumar un round trip serie a Supabase (~150 ms desde AR) en cada request:
 *  1. si hay una entrada de cache (por instancia) de menos de REVALIDAR_MS -> se usa esa;
 *  2. si no, y el token tiene menos de REVALIDAR_MS de emitido -> se confía en los claims;
 *  3. si no -> se consulta `usuarios` y se cachea.
 * Trade-off: un usuario desactivado (o con rol cambiado) puede seguir operando hasta
 * 5 min en las instancias que no procesaron el cambio. En la instancia que atendió el
 * PUT /usuarios/:id el cache se actualiza en el acto (recordarUsuario).
 */
export const REVALIDAR_MS = 5 * 60_000;
const cache = new Map(); // id -> { usuario, at }

/** Guarda el estado actual de un usuario (login, update) para esta instancia. */
export function recordarUsuario(usuario) {
  if (usuario?.id) cache.set(usuario.id, { usuario, at: Date.now() });
}

/** @deprecated usar recordarUsuario; se mantiene por compatibilidad. */
export function invalidarCacheUsuario(id) {
  cache.delete(id);
}

/**
 * Decide de dónde sale el usuario del request (pura, exportada para tests).
 * @returns {'cache'|'claims'|'db'}
 */
export function fuenteUsuario({ iat, hit, ahora = Date.now() }) {
  if (hit && ahora - hit.at < REVALIDAR_MS) return 'cache';
  if (typeof iat === 'number' && ahora - iat * 1000 < REVALIDAR_MS && iat * 1000 <= ahora + 60_000) return 'claims';
  return 'db';
}

async function cargarUsuarioDb(id) {
  const { data, error } = await getSupabase()
    .from('usuarios')
    .select('id, username, nombre, rol, activo, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw Object.assign(new Error(`Error de base de datos: ${error.message}`), { cause: error });
  cache.set(id, { usuario: data, at: Date.now() });
  return data;
}

async function resolverUsuario(claims) {
  const hit = cache.get(claims.sub);
  const fuente = fuenteUsuario({ iat: claims.iat, hit });
  if (fuente === 'cache') return hit.usuario;
  if (fuente === 'claims') return { id: claims.sub, nombre: claims.nombre, rol: claims.rol, activo: true };
  return cargarUsuarioDb(claims.sub);
}

/**
 * Valida el Bearer JWT y que el usuario siga activo con el mismo rol (ver REVALIDAR_MS).
 * req.usuario = { id, nombre, rol, activo, ... } (solo `id`/`rol` están garantizados).
 * @param {string[]} [roles] roles permitidos (vacío = cualquiera autenticado)
 */
export function requireAuth(roles = []) {
  return async (req, _res, next) => {
    const auth = req.get('authorization') ?? '';
    const [esquema, token] = auth.split(' ');
    if (esquema?.toLowerCase() !== 'bearer' || !token) throw errores.noAutenticado();
    const claims = verificarToken(token);
    if (!claims) throw errores.noAutenticado();
    const usuario = await resolverUsuario(claims);
    if (!usuario || !usuario.activo || usuario.rol !== claims.rol) throw errores.noAutenticado();
    if (roles.length > 0 && !roles.includes(usuario.rol)) throw errores.sinPermiso();
    req.usuario = usuario;
    req.log = req.log?.child({ usuarioId: usuario.id }) ?? req.log;
    next();
  };
}
