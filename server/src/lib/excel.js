import { mapearEncabezados } from './import-core.js';

// SheetJS se carga recién al usarlo (import / export): no pesa en el cold start del resto de la API.
let xlsxPromise;
const cargarXlsx = () => (xlsxPromise ??= import('xlsx').catch((err) => { xlsxPromise = undefined; throw err; }));

/**
 * Lee la hoja de empleados de un .xlsx/.xls/.csv como matriz de celdas.
 * Devuelve { filas, primeraFila } donde primeraFila es el número de fila Excel de filas[0].
 */
export async function leerPrimeraHoja(buffer, extension) {
  const XLSX = await cargarXlsx();
  let wb;
  if (extension === '.csv') {
    // CSV: decodificar como UTF-8 (sin BOM) y no convertir tipos (preserva ceros a la izquierda).
    let texto = buffer.toString('utf8');
    if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
    wb = XLSX.read(texto, { type: 'string', raw: true, dense: true });
  } else {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, dense: true });
  }
  // Usa la primera hoja que tenga las columnas obligatorias (nombre + documento); si ninguna
  // las tiene, la primera hoja (el import reporta COLUMNAS_FALTANTES).
  let elegida = null;
  for (const nombreHoja of wb.SheetNames) {
    const hoja = wb.Sheets[nombreHoja];
    const ref = hoja?.['!ref'];
    if (!ref) continue;
    const rango = XLSX.utils.decode_range(ref);
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '', blankrows: true });
    const lectura = { filas, primeraFila: rango.s.r + 1, hoja: nombreHoja };
    elegida ??= lectura;
    if (mapearEncabezados(filas[0]).faltantes.length === 0) return lectura;
  }
  return elegida ?? { filas: [], primeraFila: 1 };
}

/**
 * Genera un .xlsx con varias hojas a partir de arrays de objetos.
 * @param {{nombre:string, filas:object[], encabezados:string[], anchos?:number[]}[]} hojas
 */
export async function generarXlsx(hojas) {
  const XLSX = await cargarXlsx();
  const wb = XLSX.utils.book_new();
  for (const h of hojas) {
    const ws = XLSX.utils.json_to_sheet(h.filas, { header: h.encabezados });
    if (h.filas.length === 0) XLSX.utils.sheet_add_aoa(ws, [h.encabezados], { origin: 'A1' });
    if (h.anchos) ws['!cols'] = h.anchos.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, h.nombre);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}
