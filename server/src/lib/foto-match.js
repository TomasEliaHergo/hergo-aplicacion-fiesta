// Vinculación de fotos (carga masiva) con empleados por NOMBRE DE ARCHIVO.
// Lógica pura (sin DB) para poder testearla: el service arma el índice con todos
// los empleados y resuelve cada archivo contra él.
//
// Reglas:
//  1. Se quita la extensión (y marcas de copia " (1)", " - copia", " copy").
//     Si lo que queda, sin puntos/espacios/guiones/guiones bajos, son 5 a 12 dígitos
//     → se busca por documento (DNI o CUIT).
//  2. Si no, se normaliza (minúsculas, sin acentos, `_ - . ,` → espacio, espacios
//     colapsados) y se compara contra empleados.nombre normalizado:
//       a. igualdad exacta;
//       b. si no, mismas palabras en cualquier orden ("joaquin abius" == "abius joaquin").
//     Sin coincidencia aproximada: lo demás es SIN_COINCIDENCIA.
//     Más de un empleado en (a) o (b) → AMBIGUO (con los documentos en el motivo).
//  3. Dos archivos de la misma solicitud que resuelven al mismo empleado: el segundo
//     es DUPLICADO_EN_LOTE.

import { documentoValido } from './documento.js';

const COMBINANTES = /[̀-ͯ]/g;

/** Nombre del archivo sin carpeta ni extensión. */
export function baseArchivo(nombreArchivo) {
  const base = String(nombreArchivo ?? '').split(/[\\/]/).pop();
  const punto = base.lastIndexOf('.');
  return punto > 0 ? base.slice(0, punto) : base;
}

/** minúsculas + sin acentos (á→a, ñ→n) + `_ - . ,` → espacio + espacios colapsados. */
export function normalizarNombre(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(COMBINANTES, '')
    .toLowerCase()
    .replace(/[_\-.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Marcas que agregan Windows/macOS al duplicar un archivo (se aplican sobre el texto normalizado).
const MARCAS_COPIA = [
  /\s*\(\d+\)$/,               // "x (1)"
  /\s+(copia|copy)(\s+\d+)?$/,  // "x - copia", "x copy", "x copy 2"
  /^(copia de|copy of)\s+/,    // "Copia de x"
];

/** Normaliza un nombre de archivo (sin extensión) y quita marcas de copia al final/principio. */
export function normalizarBaseArchivo(base) {
  let s = normalizarNombre(base);
  for (let cambio = true; cambio;) {
    cambio = false;
    for (const re of MARCAS_COPIA) {
      const t = s.replace(re, '').trim();
      if (t !== s && t !== '') { s = t; cambio = true; }
    }
  }
  return s;
}

/** Clave "bolsa de palabras": mismas palabras en cualquier orden. */
export function clavePalabras(normalizado) {
  return normalizado.split(' ').filter(Boolean).sort().join(' ');
}

/** Si el archivo es un documento (5-12 dígitos, ignorando `. - _` y espacios), lo devuelve; si no, null. */
export function documentoDeArchivo(nombreArchivo) {
  const base = normalizarBaseArchivo(baseArchivo(nombreArchivo));
  const digitos = base.replace(/[\s.\-_]/g, '');
  return documentoValido(digitos) ? digitos : null;
}

function agregar(mapa, clave, emp) {
  if (!clave) return;
  const lista = mapa.get(clave);
  if (lista) lista.push(emp);
  else mapa.set(clave, [emp]);
}

/**
 * Índice de búsqueda (una vez por request).
 * @param {Array<{id:string, documento:string, nombre:string, foto_path?:string|null}>} empleados
 */
export function crearIndice(empleados) {
  const porDocumento = new Map();
  const porNombre = new Map();
  const porPalabras = new Map();
  for (const emp of empleados) {
    if (emp.documento) porDocumento.set(String(emp.documento), emp);
    const n = normalizarNombre(emp.nombre);
    agregar(porNombre, n, emp);
    agregar(porPalabras, clavePalabras(n), emp);
  }
  return { porDocumento, porNombre, porPalabras };
}

function ambiguo(lista) {
  const docs = lista.map((e) => e.documento).sort();
  return { motivo: `AMBIGUO (documentos ${docs.join(', ')})` };
}

/**
 * Resuelve un archivo contra el índice.
 * @returns {{empleado:object, via:'documento'|'nombre'} | {motivo:string}}
 */
export function resolverArchivo(nombreArchivo, indice) {
  const documento = documentoDeArchivo(nombreArchivo);
  if (documento) {
    const emp = indice.porDocumento.get(documento);
    return emp ? { empleado: emp, via: 'documento' } : { motivo: 'DOCUMENTO_NO_EXISTE' };
  }
  const n = normalizarBaseArchivo(baseArchivo(nombreArchivo));
  if (!n) return { motivo: 'SIN_COINCIDENCIA' };

  const exactos = indice.porNombre.get(n);
  if (exactos?.length === 1) return { empleado: exactos[0], via: 'nombre' };
  if (exactos?.length > 1) return ambiguo(exactos);

  const mismasPalabras = indice.porPalabras.get(clavePalabras(n));
  if (mismasPalabras?.length === 1) return { empleado: mismasPalabras[0], via: 'nombre' };
  if (mismasPalabras?.length > 1) return ambiguo(mismasPalabras);

  return { motivo: 'SIN_COINCIDENCIA' };
}

/**
 * Resuelve un lote de nombres de archivo (en orden). El segundo archivo que cae en el
 * mismo empleado es DUPLICADO_EN_LOTE.
 * @param {string[]} archivos
 * @returns {{ asignados: Array<{indice:number, archivo:string, empleado:object, via:string}>,
 *             errores: Array<{indice:number, archivo:string, motivo:string}> }}
 */
export function resolverLote(archivos, indice) {
  const asignados = [];
  const errores = [];
  const usados = new Map(); // empleado.id -> archivo
  archivos.forEach((archivo, i) => {
    const r = resolverArchivo(archivo, indice);
    if (r.motivo) { errores.push({ indice: i, archivo, motivo: r.motivo }); return; }
    const clave = r.empleado.id ?? r.empleado.documento;
    if (usados.has(clave)) { errores.push({ indice: i, archivo, motivo: 'DUPLICADO_EN_LOTE' }); return; }
    usados.set(clave, archivo);
    asignados.push({ indice: i, archivo, empleado: r.empleado, via: r.via });
  });
  return { asignados, errores };
}
