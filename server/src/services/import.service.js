import path from 'node:path';
import { getSupabase } from '../lib/supabase.js';
import { AppError, check } from '../lib/errors.js';
import { leerPrimeraHoja } from '../lib/excel.js';
import { mapearEncabezados, procesarFilas, clasificar, enLotes } from '../lib/import-core.js';

const LOTE = 500;

/**
 * Importa empleados desde .xlsx/.xls/.csv (upsert por documento, nunca borra,
 * nunca toca qr_token ni foto_path).
 * @returns {{insertados:number, actualizados:number, sinCambios:number, errores:{fila:number, motivo:string}[]}}
 */
export async function importar(file, log) {
  if (!file) throw new AppError(400, 'VALIDACION', 'Falta el archivo', [{ campo: 'archivo', motivo: 'Requerido' }]);
  const ext = path.extname(file.originalname).toLowerCase();

  let hoja;
  try {
    hoja = leerPrimeraHoja(file.buffer, ext);
  } catch (err) {
    log?.warn({ err }, 'Archivo de import ilegible');
    throw new AppError(415, 'TIPO_NO_SOPORTADO', 'No se pudo leer el archivo. Verificá que sea un Excel o CSV válido.');
  }

  const [encabezados = [], ...datos] = hoja.filas;
  const { indices, faltantes } = mapearEncabezados(encabezados);
  if (faltantes.length) {
    throw new AppError(400, 'COLUMNAS_FALTANTES', `Faltan columnas obligatorias: ${faltantes.join(', ')}`,
      faltantes.map((campo) => ({ campo, motivo: `Falta la columna "${campo}"` })));
  }

  const { validas, errores } = procesarFilas(datos, indices, hoja.primeraFila + 1);

  // Existentes, en lotes de 500 documentos.
  const existentes = new Map();
  for (const lote of enLotes(validas.map((v) => v.documento), LOTE)) {
    const filas = check(await getSupabase().from('empleados').select('documento, nombre, empresa, sector').in('documento', lote));
    for (const f of filas) existentes.set(f.documento, f);
  }

  const { insertar, actualizar, sinCambios } = clasificar(validas, existentes);

  const aplicar = async (filas) => {
    let ok = 0;
    for (const lote of enLotes(filas, LOTE)) {
      const payload = lote.map(({ fila, ...resto }) => resto);
      // upsert por documento: solo setea las columnas del payload (nunca qr_token / foto_path).
      const { error } = await getSupabase().from('empleados').upsert(payload, { onConflict: 'documento' });
      if (error) {
        log?.error({ err: error }, 'Error aplicando lote de import');
        for (const r of lote) errores.push({ fila: r.fila, motivo: 'ERROR_AL_GUARDAR' });
      } else {
        ok += lote.length;
      }
    }
    return ok;
  };

  const insertados = await aplicar(insertar);
  const actualizados = await aplicar(actualizar);
  errores.sort((a, b) => a.fila - b.fila);
  log?.info({ insertados, actualizados, sinCambios, errores: errores.length, archivo: file.originalname }, 'Import de empleados');
  return { insertados, actualizados, sinCambios, errores };
}
