import multer from 'multer';
import path from 'node:path';
import { errores } from '../lib/errors.js';

export const MB = 1024 * 1024;
// Vercel corta los requests a 4.5 MB (cuerpo completo): cada archivo debe entrar
// con margen en un request. El cliente arma los lotes de fotos por tamaño acumulado.
export const MAX_FOTO_BYTES = 4 * MB;
export const MAX_IMPORT_BYTES = 4 * MB;
export const MIME_FOTOS = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT_FOTOS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const EXT_IMPORT = new Set(['.xlsx', '.xls', '.csv']);

/** Foto individual: campo "foto", máx 4 MB. */
export const uploadFoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FOTO_BYTES, files: 1, fields: 5 },
}).single('foto');

/**
 * Storage en memoria que NO aborta el request si un archivo supera el límite:
 * descarta el contenido y lo marca como `muyGrande` (para reportarlo por archivo).
 */
function memoriaConLimite(maxBytes) {
  return {
    _handleFile(_req, file, cb) {
      const partes = [];
      let size = 0;
      let muyGrande = false;
      file.stream.on('data', (chunk) => {
        size += chunk.length;
        if (muyGrande) return;
        if (size > maxBytes) { muyGrande = true; partes.length = 0; return; }
        partes.push(chunk);
      });
      file.stream.on('error', cb);
      file.stream.on('end', () => cb(null, { buffer: muyGrande ? null : Buffer.concat(partes), size, muyGrande }));
    },
    _removeFile(_req, file, cb) { file.buffer = null; cb(null); },
  };
}

/** Fotos bulk: campo "fotos" o "fotos[]", hasta 300 archivos de 4 MB c/u (los más grandes se reportan, no abortan). */
const fotosBulk = multer({
  storage: memoriaConLimite(MAX_FOTO_BYTES),
  limits: { fileSize: 50 * MB, files: 300, fields: 10 },
}).fields([{ name: 'fotos', maxCount: 300 }, { name: 'fotos[]', maxCount: 300 }]);

export function uploadFotosBulk(req, res, next) {
  fotosBulk(req, res, (err) => {
    if (err) return next(err);
    req.files = [...(req.files?.fotos ?? []), ...(req.files?.['fotos[]'] ?? [])];
    next();
  });
}

/** Import: campo "archivo", .xlsx/.xls/.csv, máx 4 MB. */
export const uploadImport = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 5 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!EXT_IMPORT.has(ext)) return cb(errores.tipoNoSoportado('El archivo debe ser .xlsx, .xls o .csv'));
    cb(null, true);
  },
}).single('archivo');

/** ¿Es un tipo de imagen aceptado (por MIME o extensión)? La validación real la hace sharp al decodificar. */
export function esImagenAceptada(file) {
  const ext = path.extname(file.originalname ?? '').toLowerCase();
  return MIME_FOTOS.has(file.mimetype) || (file.mimetype === 'application/octet-stream' && EXT_FOTOS.has(ext));
}
