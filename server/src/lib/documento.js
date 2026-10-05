// Normalización de documentos (DNI/CUIT): solo dígitos, 5 a 12 caracteres.

export const DOCUMENTO_REGEX = /^[0-9]{5,12}$/;

/** Devuelve solo los dígitos de un valor (string o número). Números sin decimales ni notación exponencial. */
export function normalizarDocumento(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return '';
    return Math.trunc(Math.abs(valor)).toFixed(0);
  }
  if (typeof valor === 'bigint') return (valor < 0n ? -valor : valor).toString();
  return String(valor).replace(/\D/g, '');
}

export function documentoValido(doc) {
  return typeof doc === 'string' && DOCUMENTO_REGEX.test(doc);
}

/**
 * Analiza una celda de documento. Devuelve { documento } o { motivo } con
 * DOCUMENTO_VACIO | DOCUMENTO_INVALIDO.
 */
export function analizarDocumento(valor) {
  const crudo = valor === null || valor === undefined ? '' : String(valor).trim();
  if (crudo === '') return { motivo: 'DOCUMENTO_VACIO' };
  const doc = normalizarDocumento(valor);
  if (!documentoValido(doc)) return { motivo: 'DOCUMENTO_INVALIDO' };
  return { documento: doc };
}

/** Extrae el documento del nombre de archivo de una foto: "30.123.456.jpg" -> "30123456". */
export function documentoDesdeNombreArchivo(nombreArchivo) {
  const base = String(nombreArchivo ?? '').split(/[\/]/).pop();
  const sinExt = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  return normalizarDocumento(sinExt);
}
