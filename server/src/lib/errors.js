/** Error de aplicación con forma estándar { error, mensaje, detalles? }. */
export class AppError extends Error {
  constructor(status, error, mensaje, detalles) {
    super(mensaje);
    this.status = status;
    this.error = error;
    this.mensaje = mensaje;
    if (detalles !== undefined) this.detalles = detalles;
  }
}

export const errores = {
  validacion: (detalles, mensaje = 'Datos inválidos') => new AppError(400, 'VALIDACION', mensaje, detalles),
  noAutenticado: (mensaje = 'Sesión inválida o expirada') => new AppError(401, 'NO_AUTENTICADO', mensaje),
  sinPermiso: (mensaje = 'No tenés permiso para esta operación') => new AppError(403, 'SIN_PERMISO', mensaje),
  noEncontrado: (mensaje = 'No encontrado') => new AppError(404, 'NO_ENCONTRADO', mensaje),
  duplicado: (mensaje = 'Ya existe un registro con esos datos', detalles) => new AppError(409, 'DUPLICADO', mensaje, detalles),
  archivoMuyGrande: (mensaje = 'El archivo supera el tamaño máximo permitido') => new AppError(413, 'ARCHIVO_MUY_GRANDE', mensaje),
  tipoNoSoportado: (mensaje = 'Tipo de archivo no soportado') => new AppError(415, 'TIPO_NO_SOPORTADO', mensaje),
};

/** Convierte un error de PostgREST/Postgres en AppError cuando es reconocible; si no, lo relanza. */
export function traducirErrorDb(err, { duplicadoMensaje } = {}) {
  if (!err) return null;
  if (err.code === '23505') return errores.duplicado(duplicadoMensaje);
  if (err.code === '23514') return errores.validacion([{ campo: 'general', motivo: 'Restricción de datos violada' }]);
  if (err.code === '22P02') return errores.noEncontrado();
  const e = new Error(`Error de base de datos: ${err.message ?? 'desconocido'}`);
  e.cause = err;
  return e;
}

/** Lanza si `error` (de supabase-js) existe. */
export function check({ data, error, count }, opts) {
  if (error) throw traducirErrorDb(error, opts);
  return count !== undefined && count !== null ? { data, count } : data;
}
