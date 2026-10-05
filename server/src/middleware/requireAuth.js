import { verificarToken } from '../lib/jwt.js';
import { errores } from '../lib/errors.js';
import { getSupabase } from '../lib/supabase.js';

const TTL_MS = 60_000;
const cache = new Map(); // id -> { usuario, at }

export function invalidarCacheUsuario(id) {
  cache.delete(id);
}

async function cargarUsuario(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.usuario;
  const { data, error } = await getSupabase()
    .from('usuarios')
    .select('id, username, nombre, rol, activo, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw Object.assign(new Error(`Error de base de datos: ${error.message}`), { cause: error });
  cache.set(id, { usuario: data, at: Date.now() });
  return data;
}

/**
 * Valida el Bearer JWT y que el usuario siga activo con el mismo rol.
 * @param {string[]} [roles] roles permitidos (vacío = cualquiera autenticado)
 */
export function requireAuth(roles = []) {
  return async (req, _res, next) => {
    const auth = req.get('authorization') ?? '';
    const [esquema, token] = auth.split(' ');
    if (esquema?.toLowerCase() !== 'bearer' || !token) throw errores.noAutenticado();
    const claims = verificarToken(token);
    if (!claims) throw errores.noAutenticado();
    const usuario = await cargarUsuario(claims.sub);
    if (!usuario || !usuario.activo || usuario.rol !== claims.rol) throw errores.noAutenticado();
    if (roles.length > 0 && !roles.includes(usuario.rol)) throw errores.sinPermiso();
    req.usuario = usuario;
    req.log = req.log?.child({ usuarioId: usuario.id }) ?? req.log;
    next();
  };
}
