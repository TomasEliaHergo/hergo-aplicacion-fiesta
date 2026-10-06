import { AppError } from '../lib/errors.js';

export function notFoundApi(_req, _res, next) {
  next(new AppError(404, 'NO_ENCONTRADO', 'Ruta no encontrada'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let e = err;
  // Por nombre y no con instanceof multer.MulterError: multer se carga de forma perezosa.
  if (err?.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') e = new AppError(413, 'ARCHIVO_MUY_GRANDE', 'El archivo supera el tamaño máximo permitido');
    else if (err.code === 'LIMIT_FILE_COUNT') e = new AppError(413, 'ARCHIVO_MUY_GRANDE', 'Demasiados archivos en una sola subida');
    else if (err.code === 'LIMIT_UNEXPECTED_FILE') e = new AppError(400, 'VALIDACION', 'Campo de archivo inesperado', [{ campo: err.field ?? 'archivo', motivo: 'Campo no esperado' }]);
    else e = new AppError(400, 'VALIDACION', 'Error en la subida de archivos', [{ campo: err.field ?? 'archivo', motivo: err.code }]);
  } else if (err?.type === 'entity.parse.failed') {
    e = new AppError(400, 'VALIDACION', 'JSON inválido', [{ campo: 'body', motivo: 'JSON mal formado' }]);
  } else if (err?.type === 'entity.too.large') {
    e = new AppError(413, 'ARCHIVO_MUY_GRANDE', 'El cuerpo de la solicitud es demasiado grande');
  }

  if (!(e instanceof AppError)) {
    (req.log ?? console).error({ err }, 'Error no controlado');
    e = new AppError(500, 'ERROR_INTERNO', 'Ocurrió un error inesperado. Intentá de nuevo.');
  } else if (e.status >= 500) {
    (req.log ?? console).error({ err }, e.mensaje);
  }

  if (res.headersSent) return;
  const body = { error: e.error, mensaje: e.mensaje };
  if (e.detalles !== undefined) body.detalles = e.detalles;
  res.status(e.status).json(body);
}
