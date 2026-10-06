import { z } from 'zod';
import { normalizarDocumento, DOCUMENTO_REGEX } from './documento.js';
import { normalizarTexto } from './texto.js';

// Mensajes de validación de zod en español (global; este módulo lo importan todas las rutas).
z.config(z.locales.es());

/** Documento: acepta string o número, se normaliza a dígitos y se valida 5-12. */
export const documentoSchema = z
  .union([z.string(), z.number()], { message: 'Documento requerido' })
  .transform((v) => normalizarDocumento(v))
  .refine((v) => v.length > 0, { message: 'Documento requerido' })
  .refine((v) => DOCUMENTO_REGEX.test(v), { message: 'El documento debe tener entre 5 y 12 dígitos' });

/** Texto con trim + colapso de espacios. */
export const textoSchema = (max = 120) =>
  z.string({ message: 'Debe ser texto' }).transform(normalizarTexto).pipe(z.string().max(max, `Máximo ${max} caracteres`));

export const nombreSchema = textoSchema(150).pipe(z.string().min(1, 'El nombre es obligatorio'));

export const idParams = z.object({ id: z.uuid({ message: 'ID inválido' }) });

/** Query string opcional: '' => undefined. */
export const queryOpcional = (schema) =>
  z.preprocess((v) => (v === '' || v === undefined || v === null ? undefined : v), schema.optional());

export const booleanQuery = z.enum(['true', 'false'], { message: 'Debe ser true o false' }).transform((v) => v === 'true');

export const paginacion = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200, 'Máximo 200').default(50),
};

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, 'Usuario: 3 a 40 caracteres (letras, números, punto, guion, guion bajo)');

export const passwordSchema = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200);

export const rolSchema = z.enum(['rrhh', 'scanner'], { message: 'Rol inválido (rrhh o scanner)' });

/** Motivo opcional del rechazo en la puerta: ausente / '' / null / solo espacios => null; máx. 200. */
export const motivoRechazoSchema = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  textoSchema(200).optional(),
).transform((v) => v || null);
