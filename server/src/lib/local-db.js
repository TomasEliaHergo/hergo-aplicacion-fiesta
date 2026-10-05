// Modo local (DB_MODE=local): Postgres real en WASM (PGlite) persistido en
// server/.data/pgdata. Solo para desarrollo/pruebas en una PC sin Postgres ni
// Supabase. El camino de producción (Supabase) no usa este archivo.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, DEFAULT_DB_SCHEMA } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_DIR = path.resolve(__dirname, '../..');
export const DATA_DIR = path.join(SERVER_DIR, '.data');
export const PGDATA_DIR = path.join(DATA_DIR, 'pgdata');
export const FOTOS_DIR = path.join(DATA_DIR, 'fotos');
export const CREDENCIALES_FILE = path.join(DATA_DIR, 'CREDENCIALES-LOCAL.txt');
const SCHEMA_FILE = path.join(SERVER_DIR, 'db', 'schema.sql');

// Stubs de lo que Supabase trae de fábrica y schema.sql da por sentado:
// schema "extensions", roles anon/authenticated/service_role y storage.buckets.
// Así schema.sql se ejecuta tal cual (solo se renombra el schema si DB_SCHEMA
// no es el default).
const PREAMBULO_SUPABASE = `
create schema if not exists extensions;
create schema if not exists storage;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
`;

let dbPromise;

/** Instancia única de PGlite (lazy). Crea el esquema la primera vez. */
export function getLocalDb() {
  if (!dbPromise) {
    dbPromise = abrir().catch((err) => {
      dbPromise = undefined;
      throw err;
    });
  }
  return dbPromise;
}

async function abrir() {
  // Specifier en variable a propósito: el file tracer de Vercel (@vercel/nft) sigue
  // los import('literal') y metería ~25 MB de PGlite en la función serverless,
  // que nunca usa el modo local. (vercel.json además lo excluye con excludeFiles.)
  const cargar = (especificador) => import(especificador);
  const PGLITE = '@electric-sql/pglite';
  const [{ PGlite }, { pgcrypto }, { pg_trgm }] = await Promise.all([
    cargar(PGLITE),
    cargar(`${PGLITE}/contrib/pgcrypto`),
    cargar(`${PGLITE}/contrib/pg_trgm`),
  ]);
  await mkdir(PGDATA_DIR, { recursive: true });
  await mkdir(FOTOS_DIR, { recursive: true });
  const db = new PGlite(PGDATA_DIR, { extensions: { pgcrypto, pg_trgm } });
  await db.waitReady;
  const esquema = getConfig().DB_SCHEMA;
  const { rows } = await db.query(
    `select to_regclass($1) is not null as existe, to_regclass('public.usuarios') is not null as legado`,
    [`"${esquema}".usuarios`],
  );
  if (!rows[0].existe) {
    if (rows[0].legado) {
      await db.close();
      throw new Error(`server/.data fue creada por una versión anterior (tablas en "public", no en "${esquema}"). `
        + 'Borrarla con: npm run reset:local --prefix server');
    }
    let sql = await readFile(SCHEMA_FILE, 'utf8');
    if (esquema !== DEFAULT_DB_SCHEMA) sql = sql.replace(new RegExp(`\\b${DEFAULT_DB_SCHEMA}\\b`, 'g'), esquema);
    // exec con varias sentencias = una transacción implícita: si falla, no queda nada a medias.
    await db.exec(`${PREAMBULO_SUPABASE}\n${sql}`);
  }
  // El cliente local califica todo con el schema; el search_path es solo una red
  // de seguridad para SQL escrito a mano.
  await db.exec(`set search_path to "${esquema}", extensions, public`);
  return db;
}

/** Cierra PGlite (flush ordenado al apagar). */
export async function cerrarDbLocal() {
  if (!dbPromise) return;
  const db = await dbPromise;
  dbPromise = undefined;
  await db.close();
}

const passwordAleatoria = () => randomBytes(12).toString('base64url');

/**
 * Inicializa la base local y, si no hay usuarios, crea uno RRHH y uno scanner
 * con passwords aleatorias que se escriben en .data/CREDENCIALES-LOCAL.txt.
 */
export async function iniciarDbLocal(logger) {
  const db = await getLocalDb();
  const t = `"${getConfig().DB_SCHEMA}".usuarios`;
  const { rows } = await db.query(`select count(*)::int as n from ${t}`);
  if (rows[0].n === 0) {
    const { hashPassword } = await import('./passwords.js');
    const usuarios = [
      { username: 'rrhh', nombre: 'RRHH Local', rol: 'rrhh', password: passwordAleatoria() },
      { username: 'scanner', nombre: 'Puerta 1', rol: 'scanner', password: passwordAleatoria() },
    ];
    for (const u of usuarios) {
      await db.query(
        `insert into ${t} (username, nombre, rol, password_hash) values ($1, $2, $3, $4)`,
        [u.username, u.nombre, u.rol, await hashPassword(u.password)],
      );
    }
    const texto = [
      'Credenciales generadas para el MODO LOCAL (no usar en produccion).',
      `Generadas: ${new Date().toISOString()}`,
      '',
      ...usuarios.map((u) => `${u.rol.padEnd(8)} usuario: ${u.username}   password: ${u.password}`),
      '',
      'Para empezar de cero: npm run reset:local (borra server/.data).',
      '',
    ].join('\n');
    await writeFile(CREDENCIALES_FILE, texto, { encoding: 'utf8', mode: 0o600 });
    logger?.warn({ archivo: CREDENCIALES_FILE }, 'Modo local: usuarios iniciales creados; ver credenciales en el archivo');
  }
  logger?.info({ dir: DATA_DIR, schema: getConfig().DB_SCHEMA }, 'Modo local: base PGlite lista');
  return db;
}
