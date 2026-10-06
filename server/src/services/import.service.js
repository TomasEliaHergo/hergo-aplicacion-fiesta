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
    hoja = await leerPrimeraHoja(file.buffer, ext);
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
  // Existentes, en lotes de 500 documentos consultados en paralelo.
  const existentes = new Map();
  const lotesDocs = enLotes(validas.map((v) => v.documento), LOTE);
  const leidos = await Promise.all(lotesDocs.map((lote) =>
    getSupabase().from('empleados').select('documento, nombre, empresa, sector').in('documento', lote)));
  for (const f of leidos.flatMap((res) => check(res))) existentes.set(f.documento, f);

  const { insertar, actualizar, sinCambios } = clasificar(validas, existentes);

  // Lotes en paralelo: cada documento aparece en un solo lote (los duplicados del
  // archivo ya se descartaron), así que no hay conflictos entre lotes.
  const aplicarLote = async (lote) => {
    const payload = lote.map(({ fila, ...resto }) => resto);
    // upsert por documento: solo setea las columnas del payload (nunca qr_token / foto_path).
    const { error } = await getSupabase().from('empleados').upsert(payload, { onConflict: 'documento' });
    if (!error) return lote.length;
    log?.error({ err: error }, 'Error aplicando lote de import');
    for (const r of lote) errores.push({ fila: r.fila, motivo: 'ERROR_AL_GUARDAR' });
    return 0;
  };
  const aplicar = async (filas) => (await Promise.all(enLotes(filas, LOTE).map(aplicarLote))).reduce((a, b) => a + b, 0);

  // insertar y actualizar tienen columnas distintas (por eso van en upserts separados), pero son independientes.
  const [insertados, actualizados] = await Promise.all([aplicar(insertar), aplicar(actualizar)]);
  errores.sort((a, b) => a.fila - b.fila);
  log?.info({ insertados, actualizados, sinCambios, errores: errores.length, archivo: file.originalname }, 'Import de empleados');
  return { insertados, actualizados, sinCambios, errores };
}
