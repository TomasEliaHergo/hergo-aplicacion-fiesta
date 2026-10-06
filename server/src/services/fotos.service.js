import { getSupabase } from '../lib/supabase.js';
import { AppError, check } from '../lib/errors.js';
import { nuevoFotoPath, subirFoto, borrarFotos } from '../lib/storage.js';
import { documentoDesdeNombreArchivo, documentoValido } from '../lib/documento.js';
import { enLotes } from '../lib/import-core.js';
import { esImagenAceptada } from '../middleware/upload.js';
import { obtenerFila, obtener } from './empleados.service.js';

// sharp (binario nativo, ~300 ms de carga) se importa recién al procesar la primera
// foto: así no pesa en el cold start de la función para el resto de los endpoints.
let sharpPromise;
function cargarSharp() {
  sharpPromise ??= import('sharp').then(({ default: sharp }) => {
    sharp.cache(false);
    sharp.concurrency(2);
    return sharp;
  }).catch((err) => { sharpPromise = undefined; throw err; });
  return sharpPromise;
}

/** Decodifica, corrige orientación EXIF y redimensiona a máx 600px, WebP q80. Lanza IMAGEN_INVALIDA. */
export async function procesarImagen(buffer) {
  const sharp = await cargarSharp(); // fuera del try: un fallo al cargar sharp es 500, no IMAGEN_INVALIDA
  try {
    return await sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new AppError(400, 'IMAGEN_INVALIDA', 'La imagen no se pudo procesar (archivo dañado o formato inválido)');
  }
}

/** Sube la foto, actualiza foto_path y borra la anterior. */
async function reemplazarFoto(empleadoId, fotoPathAnterior, webp, log) {
  const path = nuevoFotoPath(empleadoId);
  await subirFoto(path, webp);
  const { error } = await getSupabase().from('empleados').update({ foto_path: path }).eq('id', empleadoId);
  if (error) {
    await borrarFotos([path], log);
    throw Object.assign(new Error(`Error guardando foto: ${error.message}`), { cause: error });
  }
  if (fotoPathAnterior && fotoPathAnterior !== path) await borrarFotos([fotoPathAnterior], log);
  return path;
}

export async function subirUna(empleadoId, file, log) {
  if (!file) throw new AppError(400, 'VALIDACION', 'Falta el archivo', [{ campo: 'foto', motivo: 'Requerido' }]);
  if (!esImagenAceptada(file)) throw new AppError(415, 'TIPO_NO_SOPORTADO', 'La foto debe ser JPG, PNG o WebP');
  // La lectura en DB corre mientras sharp procesa la imagen (CPU).
  const [fila, webp] = await Promise.all([obtenerFila(empleadoId), procesarImagen(file.buffer)]);
  await reemplazarFoto(empleadoId, fila.foto_path, webp, log);
  return obtener(empleadoId);
}

export async function borrarFotoEmpleado(empleadoId, log) {
  const fila = await obtenerFila(empleadoId);
  if (!fila.foto_path) return;
  check(await getSupabase().from('empleados').update({ foto_path: null }).eq('id', empleadoId));
  await borrarFotos([fila.foto_path], log);
}

/** Bulk: nombre de archivo = documento. Devuelve { subidas, errores:[{archivo, motivo}] }. */
export async function subirBulk(files, log) {
  const errores = [];
  const pendientes = [];
  for (const f of files) {
    const archivo = f.originalname;
    if (f.muyGrande) { errores.push({ archivo, motivo: 'ARCHIVO_MUY_GRANDE' }); continue; }
    if (!esImagenAceptada(f)) { errores.push({ archivo, motivo: 'TIPO_NO_SOPORTADO' }); continue; }
    const documento = documentoDesdeNombreArchivo(archivo);
    if (!documentoValido(documento)) { errores.push({ archivo, motivo: 'DOCUMENTO_NO_EXISTE' }); continue; }
    pendientes.push({ archivo, documento, file: f });
  }

  const porDoc = new Map();
  const lotes = enLotes([...new Set(pendientes.map((p) => p.documento))], 500);
  const resultados = await Promise.all(lotes.map((lote) =>
    getSupabase().from('empleados').select('id, documento, foto_path').in('documento', lote)));
  for (const r of resultados.flatMap((res) => check(res))) porDoc.set(r.documento, r);

  let subidas = 0;
  const cola = [...pendientes];
  const trabajador = async () => {
    for (let p = cola.shift(); p; p = cola.shift()) {
      const emp = porDoc.get(p.documento);
      if (!emp) { errores.push({ archivo: p.archivo, motivo: 'DOCUMENTO_NO_EXISTE' }); continue; }
      let webp;
      try {
        webp = await procesarImagen(p.file.buffer);
      } catch {
        errores.push({ archivo: p.archivo, motivo: 'IMAGEN_INVALIDA' });
        continue;
      } finally {
        p.file.buffer = null; // liberar memoria
      }
      try {
        // si el mismo documento viene dos veces, la segunda reemplaza (y borra) a la primera
        emp.foto_path = await reemplazarFoto(emp.id, emp.foto_path, webp, log);
        subidas++;
      } catch (err) {
        log?.error({ err, archivo: p.archivo }, 'Error subiendo foto bulk');
        errores.push({ archivo: p.archivo, motivo: 'ERROR_AL_GUARDAR' });
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, trabajador));
  return { subidas, errores };
}
