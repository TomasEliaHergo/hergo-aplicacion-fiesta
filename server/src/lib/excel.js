import * as XLSX from 'xlsx';

/**
 * Lee la primera hoja de un .xlsx/.xls/.csv como matriz de celdas.
 * Devuelve { filas, primeraFila } donde primeraFila es el número de fila Excel de filas[0].
 */
export function leerPrimeraHoja(buffer, extension) {
  let wb;
  if (extension === '.csv') {
    // CSV: decodificar como UTF-8 (sin BOM) y no convertir tipos (preserva ceros a la izquierda).
    let texto = buffer.toString('utf8');
    if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
    wb = XLSX.read(texto, { type: 'string', raw: true, dense: true });
  } else {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, dense: true });
  }
  const nombreHoja = wb.SheetNames[0];
  if (!nombreHoja) return { filas: [], primeraFila: 1 };
  const hoja = wb.Sheets[nombreHoja];
  const ref = hoja['!ref'];
  if (!ref) return { filas: [], primeraFila: 1 };
  const rango = XLSX.utils.decode_range(ref);
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '', blankrows: true });
  return { filas, primeraFila: rango.s.r + 1 };
}

/**
 * Genera un .xlsx con varias hojas a partir de arrays de objetos.
 * @param {{nombre:string, filas:object[], encabezados:string[], anchos?:number[]}[]} hojas
 */
export function generarXlsx(hojas) {
  const wb = XLSX.utils.book_new();
  for (const h of hojas) {
    const ws = XLSX.utils.json_to_sheet(h.filas, { header: h.encabezados });
    if (h.filas.length === 0) XLSX.utils.sheet_add_aoa(ws, [h.encabezados], { origin: 'A1' });
    if (h.anchos) ws['!cols'] = h.anchos.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, h.nombre);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}
