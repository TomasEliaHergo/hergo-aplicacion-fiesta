const TZ = 'America/Argentina/Buenos_Aires';

const fmtHora = new Intl.DateTimeFormat('es-AR', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const fmtFechaHora = new Intl.DateTimeFormat('es-AR', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const fmtNumero = new Intl.NumberFormat('es-AR');
const fmtPorcentaje = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

export function formatHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : fmtHora.format(d);
}

export function formatFechaHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : fmtFechaHora.format(d);
}

export const formatNumero = (n) => fmtNumero.format(n ?? 0);
export const formatPorcentaje = (n) => `${fmtPorcentaje.format(n ?? 0)}%`;

export function porcentaje(parte, total) {
  if (!total) return 0;
  return Math.round((parte / total) * 1000) / 10;
}

export function iniciales(nombre) {
  if (!nombre) return '?';
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const a = partes[0][0] || '';
  const b = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (a + b).toUpperCase();
}

export function soloDigitos(s) {
  return String(s ?? '').replace(/\D/g, '');
}

/** Formatea un documento con puntos de miles para mostrarlo (30123456 -> 30.123.456). */
export function formatDocumento(doc) {
  const d = soloDigitos(doc);
  if (d.length < 7 || d.length > 8) return d;
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function slug(s) {
  return String(s || 'qr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'qr';
}

// Límites de subida. Vercel corta cualquier request a 4.5 MB (cuerpo completo),
// así que el backend acepta hasta 4 MB por archivo y la carga masiva de fotos
// se parte en lotes por tamaño acumulado.
const MB = 1024 * 1024;
export const MAX_FOTO_BYTES = 4 * MB;
export const MAX_IMPORT_BYTES = 4 * MB;
export const LOTE_FOTOS_MAX_BYTES = 3.5 * MB; // tamaño acumulado por request (deja margen al multipart)
export const LOTE_FOTOS_MAX_ARCHIVOS = 20;

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MOTIVOS = {
  DOCUMENTO_VACIO: 'Documento vacío',
  DOCUMENTO_INVALIDO: 'Documento inválido (solo dígitos, 5 a 12)',
  NOMBRE_VACIO: 'Nombre vacío',
  DOCUMENTO_DUPLICADO_EN_ARCHIVO: 'Documento repetido en el archivo',
  DOCUMENTO_NO_EXISTE: 'No hay ningún empleado con ese documento',
  TIPO_NO_SOPORTADO: 'Formato no soportado (usar JPG, PNG o WebP)',
  ARCHIVO_MUY_GRANDE: 'Supera los 4 MB',
  IMAGEN_INVALIDA: 'La imagen está dañada o no se pudo leer',
  SIN_COINCIDENCIA: 'Sin coincidencia con ningún empleado',
  AMBIGUO: 'Nombre repetido en varios empleados',
  DUPLICADO_EN_LOTE: 'Archivo repetido para la misma persona',
  ERROR_AL_GUARDAR: 'No se pudo guardar (reintentá)',
  FORMATO_HEIC: 'Formato HEIC (iPhone) no aceptado: convertila a JPG',
};

/** Traduce un motivo del backend. Conserva el sufijo (ej: "(también en fila 7)"). */
export function traducirMotivo(motivo) {
  if (!motivo) return '';
  const m = /^([A-Z_]+)(.*)$/.exec(String(motivo));
  if (m && MOTIVOS[m[1]]) return `${MOTIVOS[m[1]]}${m[2]}`;
  return motivo;
}

export const ROL_LABEL = { rrhh: 'RRHH', scanner: 'Escáner' };

export function homeForRole(rol) {
  if (rol === 'rrhh') return '/admin';
  if (rol === 'scanner') return '/scanner';
  return '/';
}

/** Convierte detalles [{campo, motivo}] en un objeto {campo: motivo}. */
export function erroresPorCampo(err) {
  const out = {};
  for (const d of err?.detalles || []) {
    if (d && d.campo) out[d.campo] = d.motivo || 'Valor inválido';
  }
  return out;
}
