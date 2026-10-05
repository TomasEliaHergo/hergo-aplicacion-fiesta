import { randomBytes } from 'node:crypto';
import { getSupabase } from './supabase.js';
import { getConfig } from '../config.js';

/** URL pública de una foto o null. */
export function fotoUrl(fotoPath) {
  if (!fotoPath) return null;
  return getSupabase().storage.from(getConfig().fotosBucket).getPublicUrl(fotoPath).data.publicUrl;
}

/** Path no adivinable: empleados/{id}/{random}.webp */
export function nuevoFotoPath(empleadoId) {
  return `empleados/${empleadoId}/${randomBytes(16).toString('base64url')}.webp`;
}

export async function subirFoto(path, buffer) {
  const { error } = await getSupabase().storage.from(getConfig().fotosBucket).upload(path, buffer, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw Object.assign(new Error(`Error subiendo foto: ${error.message}`), { cause: error });
}

/** Borra archivos (best effort: loguea pero no falla). */
export async function borrarFotos(paths, log) {
  const lista = paths.filter(Boolean);
  if (lista.length === 0) return;
  const { error } = await getSupabase().storage.from(getConfig().fotosBucket).remove(lista);
  if (error) log?.warn({ err: error, paths: lista }, 'No se pudo borrar foto(s) anterior(es)');
}
