// Lógica pura del import de empleados (sin I/O): normalización de
// encabezados, validación de filas, duplicados en archivo y clasificación
// insertar / actualizar / sin cambios.
import { analizarDocumento } from './documento.js';
import { normalizarTexto, sinAcentos } from './texto.js';

export const CAMPOS = ['documento', 'nombre', 'empresa', 'sector'];
export const CAMPOS_OBLIGATORIOS = ['documento', 'nombre'];

const SINONIMOS = {
  documento: ['documento', 'dni', 'nrodocumento', 'nrodedocumento', 'numerodocumento', 'numerodedocumento',
    'nrodni', 'numerodni', 'doc', 'nrodoc', 'cuit', 'cuil'],
  nombre: ['nombre', 'nombreyapellido', 'apellidoynombre', 'apellidoynombres', 'nombresyapellidos',
    'apellidosynombres', 'nombrecompleto', 'empleado'],
  empresa: ['empresa', 'compania', 'razonsocial'],
  sector: ['sector', 'area', 'departamento'],
  // Columnas de foto: se ignoran explícitamente (no se descargan URLs: evita SSRF).
  _ignorar: ['foto', 'fotourl', 'urlfoto', 'imagen', 'fotografia'],
};

const MAPA_SINONIMOS = new Map();
for (const [campo, lista] of Object.entries(SINONIMOS)) for (const s of lista) MAPA_SINONIMOS.set(s, campo);

/** trim + minúsculas + sin acentos + sin espacios / guiones bajos / guiones / puntos. */
export function normalizarEncabezado(h) {
  return sinAcentos(String(h ?? '').trim().toLowerCase()).replace(/[\s_.\-]+/g, '');
}

/**
 * Mapea la fila de encabezados a índices de columna.
 * @returns {{ indices: Record<string, number>, faltantes: string[] }}
 */
export function mapearEncabezados(filaEncabezados) {
  const indices = {};
  (filaEncabezados ?? []).forEach((h, i) => {
    const campo = MAPA_SINONIMOS.get(normalizarEncabezado(h));
    if (campo && campo !== '_ignorar' && indices[campo] === undefined) indices[campo] = i;
  });
  const faltantes = CAMPOS_OBLIGATORIOS.filter((c) => indices[c] === undefined);
  return { indices, faltantes };
}

function filaVacia(fila) {
  return !fila || fila.every((v) => v === null || v === undefined || String(v).trim() === '');
}

/**
 * Valida y normaliza las filas de datos.
 * @param {unknown[][]} filas filas de datos (sin encabezado)
 * @param {Record<string, number>} indices resultado de mapearEncabezados
 * @param {number} primeraFila número de fila Excel de filas[0] (default 2: el encabezado es la 1)
 * @returns {{ validas: {fila:number, documento:string, nombre:string, empresa?:string, sector?:string}[], errores: {fila:number, motivo:string}[] }}
 */
export function procesarFilas(filas, indices, primeraFila = 2) {
  const candidatas = [];
  const errores = [];
  filas.forEach((fila, i) => {
    const numFila = primeraFila + i;
    if (filaVacia(fila)) return;
    const doc = analizarDocumento(fila[indices.documento]);
    if (doc.motivo) { errores.push({ fila: numFila, motivo: doc.motivo }); return; }
    const nombre = normalizarTexto(fila[indices.nombre]);
    if (!nombre) { errores.push({ fila: numFila, motivo: 'NOMBRE_VACIO' }); return; }
    const r = { fila: numFila, documento: doc.documento, nombre };
    if (indices.empresa !== undefined) r.empresa = normalizarTexto(fila[indices.empresa]);
    if (indices.sector !== undefined) r.sector = normalizarTexto(fila[indices.sector]);
    candidatas.push(r);
  });

  // Duplicados en archivo: ninguna de las filas involucradas se aplica.
  const porDoc = new Map();
  for (const r of candidatas) {
    if (!porDoc.has(r.documento)) porDoc.set(r.documento, []);
    porDoc.get(r.documento).push(r.fila);
  }
  const validas = [];
  for (const r of candidatas) {
    const filasDoc = porDoc.get(r.documento);
    if (filasDoc.length > 1) {
      const otras = filasDoc.filter((f) => f !== r.fila).join(', ');
      errores.push({ fila: r.fila, motivo: `DOCUMENTO_DUPLICADO_EN_ARCHIVO (también en fila ${otras})` });
    } else {
      validas.push(r);
    }
  }
  errores.sort((a, b) => a.fila - b.fila);
  return { validas, errores };
}

/**
 * Clasifica filas válidas contra los empleados existentes.
 * Solo se comparan/actualizan las columnas presentes en el archivo
 * (si el archivo no trae "sector", el sector existente no se toca).
 * Nunca incluye qr_token ni foto_path.
 * @param {ReturnType<typeof procesarFilas>['validas']} validas
 * @param {Map<string, {documento:string, nombre:string, empresa:string, sector:string}>} existentes por documento
 */
export function clasificar(validas, existentes) {
  const insertar = [];
  const actualizar = [];
  let sinCambios = 0;
  for (const r of validas) {
    const actual = existentes.get(r.documento);
    if (!actual) {
      insertar.push({ fila: r.fila, documento: r.documento, nombre: r.nombre, empresa: r.empresa ?? '', sector: r.sector ?? '' });
      continue;
    }
    const cambios = { fila: r.fila, documento: r.documento, nombre: r.nombre };
    let cambio = actual.nombre !== r.nombre;
    for (const c of ['empresa', 'sector']) {
      if (r[c] !== undefined) {
        cambios[c] = r[c];
        if ((actual[c] ?? '') !== r[c]) cambio = true;
      }
    }
    if (cambio) actualizar.push(cambios); else sinCambios++;
  }
  return { insertar, actualizar, sinCambios };
}

/** Parte un array en lotes. */
export function enLotes(arr, tam = 500) {
  const out = [];
  for (let i = 0; i < arr.length; i += tam) out.push(arr.slice(i, i + tam));
  return out;
}
