import { z } from 'zod';

/**
 * Schema Postgres propio de la app (tablas, vista, funciones). Único lugar donde
 * vive el default: supabase-js (db.schema), el cliente local PGlite y los RPC lo
 * toman de getConfig().DB_SCHEMA. db/schema.sql está escrito con este nombre.
 */
export const DEFAULT_DB_SCHEMA = 'appfiesta';

/** URL de Supabase "real" (no vacía ni el placeholder de .env.example). */
function esSupabaseConfigurado(url) {
  if (!url || /TU-PROYECTO/i.test(url)) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  // supabase (producción) | local (PGlite + archivos en server/.data). Default: local si no hay SUPABASE_URL real.
  DB_MODE: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v?.trim?.().toLowerCase() ?? v),
    z.enum(['supabase', 'local']).optional()),
  DB_SCHEMA: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v?.trim?.() ?? v),
    z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/, 'DB_SCHEMA debe ser un identificador Postgres en minúsculas')
      .default(DEFAULT_DB_SCHEMA)),
  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_BASE_URL: z.string().optional().default(''),
  LOG_LEVEL: z.string().default('info'),
}).transform((env) => ({
  ...env,
  DB_MODE: env.DB_MODE ?? (esSupabaseConfigurado(env.SUPABASE_URL) ? 'supabase' : 'local'),
})).superRefine((env, ctx) => {
  if (env.DB_MODE !== 'supabase') return;
  if (!z.url().safeParse(env.SUPABASE_URL).success) {
    ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: 'SUPABASE_URL debe ser una URL válida' });
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY.length < 20) {
    ctx.addIssue({ code: 'custom', path: ['SUPABASE_SERVICE_ROLE_KEY'], message: 'SUPABASE_SERVICE_ROLE_KEY es obligatoria' });
  }
});

let cached;

/** Lee y valida las variables de entorno (lazy, para que los tests de funciones puras no las necesiten). */
export function getConfig() {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lineas = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida (revisar .env):\n${lineas}`);
  }
  const env = parsed.data;
  cached = Object.freeze({
    ...env,
    isProd: env.NODE_ENV === 'production',
    isLocal: env.DB_MODE === 'local',
    corsOrigins: env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
    jwtExpiresIn: '10h',
    jwtExpiresSeg: 10 * 3600,
    fotosBucket: 'fotos',
  });
  return cached;
}
