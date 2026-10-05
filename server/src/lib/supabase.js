import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../config.js';
import { crearClienteLocal } from './local-client.js';

let client;

/**
 * Cliente Supabase con SERVICE_ROLE (bypassa RLS), apuntado al schema DB_SCHEMA. Solo server-side.
 * En DB_MODE=local devuelve un cliente compatible respaldado por PGlite (ver local-client.js).
 */
export function getSupabase() {
  if (!client && getConfig().isLocal) client = crearClienteLocal();
  if (!client) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DB_SCHEMA } = getConfig();
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      // Todas las tablas/vistas/RPC viven en el schema propio (Accept-Profile/Content-Profile).
      // Requiere que DB_SCHEMA figure en Dashboard > Settings > Data API > Exposed schemas.
      db: { schema: DB_SCHEMA },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'X-Client-Info': 'asistencia-fiesta-server' } },
    });
  }
  return client;
}

/**
 * Trae todas las filas de una consulta paginando de a 1000 (límite max-rows de PostgREST).
 * @param {(from:number, to:number) => PromiseLike<{data:any[], error:any}>} consulta
 */
export async function traerTodo(consulta, tam = 1000) {
  const out = [];
  for (let desde = 0; ; desde += tam) {
    const { data, error } = await consulta(desde, desde + tam - 1);
    if (error) throw Object.assign(new Error(`Error de base de datos: ${error.message}`), { cause: error });
    out.push(...data);
    if (data.length < tam) break;
  }
  return out;
}
