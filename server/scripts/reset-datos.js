// Borra TODOS los datos de prueba: fotos del bucket "fotos" (Storage API) y las
// filas de rechazos, asistencias, empleados y usuarios. NO toca la estructura
// (tablas, funciones, permisos) ni el bucket en sí.
//
// Uso:
//   npm run reset:datos --prefix server                      # según DB_MODE de server/.env
//   npm run reset:datos --prefix server -- --local           # fuerza el modo local (PGlite)
//   npm run reset:datos --prefix server -- --si-estoy-seguro # sin preguntar (no interactivo)
//
// Modo local: el server tiene que estar FRENADO (PGlite admite un solo proceso).
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';

const { values: flags } = parseArgs({
  options: {
    'si-estoy-seguro': { type: 'boolean', default: false },
    local: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});
// Antes de cargar dotenv/config: dotenv no pisa variables ya definidas.
if (flags.local) process.env.DB_MODE = 'local';
await import('dotenv/config');

const { getConfig } = await import('../src/config.js');
const { getSupabase } = await import('../src/lib/supabase.js');
const { FRASE_CONFIRMACION, refProyecto, trozos, listarArchivosRecursivo } = await import('../src/lib/reset.js');

const UUID_CERO = '00000000-0000-0000-0000-000000000000';
// Orden que respeta las FK: rechazos/asistencias referencian empleados y usuarios
// (asistencias.escaneado_por y rechazos.rechazado_por son "on delete restrict").
const TABLAS = ['rechazos', 'asistencias', 'empleados', 'usuarios'];

let cerrarLocal = async () => {};

async function salir(msg, codigo = 1) {
  if (msg && codigo !== 0) console.error(`\nError: ${msg}`);
  else if (msg) console.log(`\n${msg}`);
  await cerrarLocal().catch(() => {});
  process.exit(codigo);
}

let config;
try {
  config = getConfig();
} catch (err) {
  await salir(err.message);
}

console.log('\n=== Borrar TODOS los datos de prueba ===\n');

if (config.isLocal) {
  console.log('Modo:      LOCAL (PGlite en server/.data)');
  // 1) ¿Hay un server escuchando? (no se abre PGlite si lo está usando otro proceso)
  const enUso = await fetch(`http://127.0.0.1:${config.PORT}/health`, { signal: AbortSignal.timeout(800) })
    .then(() => true, () => false);
  if (enUso) {
    await salir(`hay un server corriendo en el puerto ${config.PORT} y tiene tomada la base local.\n`
      + '  Frenalo y volvé a correr este comando, o para empezar de cero sin el server: npm run reset:local --prefix server');
  }
  const { cerrarDbLocal } = await import('../src/lib/local-db.js');
  cerrarLocal = cerrarDbLocal;
} else {
  console.log('Modo:      SUPABASE');
  console.log(`Proyecto:  ${refProyecto(config.SUPABASE_URL)}   (${config.SUPABASE_URL})`);
}
console.log(`Schema:    ${config.DB_SCHEMA}`);
console.log(`Bucket:    ${config.fotosBucket}\n`);

const sb = getSupabase();
const ayudaLock = (msg) => (/Aborted|lock|postmaster/i.test(String(msg))
  ? `${msg}\n  La base LOCAL está en uso por otro proceso (¿el server?). Frenalo y reintentá, o usá: npm run reset:local --prefix server`
  : msg);

// ---------- Conteos ----------
async function contar(tabla) {
  const { count, error } = await sb.from(tabla).select('id', { count: 'exact', head: true });
  if (error) return { error };
  return { n: count ?? 0 };
}

const conteos = {};
for (const t of TABLAS) {
  conteos[t] = await contar(t);
  if (conteos[t].error && t !== 'rechazos') await salir(`no se pudo contar ${t}: ${ayudaLock(conteos[t].error.message)}`);
}

const bucket = sb.storage.from(config.fotosBucket);
let archivos;
try {
  archivos = await listarArchivosRecursivo((prefijo, opts) => bucket.list(prefijo, { ...opts, sortBy: { column: 'name', order: 'asc' } }));
} catch (err) {
  await salir(`no se pudo listar el bucket "${config.fotosBucket}": ${err.message}`);
}

const fmt = (c) => (c.error ? 'n/d (tabla inexistente: falta la migración 002)' : String(c.n));
console.log('Se va a borrar:');
console.log(`  empleados:    ${fmt(conteos.empleados)}`);
console.log(`  asistencias:  ${fmt(conteos.asistencias)}`);
console.log(`  rechazos:     ${fmt(conteos.rechazos)}`);
console.log(`  usuarios:     ${fmt(conteos.usuarios)}   (TODOS, incluido RRHH)`);
console.log(`  fotos:        ${archivos.length} archivo(s) en el bucket "${config.fotosBucket}"`);
console.log('\nNo se puede deshacer. La estructura (tablas, funciones, bucket) no se toca.\n');

// ---------- Confirmación ----------
if (!flags['si-estoy-seguro']) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const resp = await rl.question(`Para confirmar escribí exactamente  ${FRASE_CONFIRMACION}  : `);
  rl.close();
  if (resp.trim() !== FRASE_CONFIRMACION) await salir('Cancelado: no se borró nada.', 0);
}

// ---------- Fotos (Storage API; Supabase no permite borrar storage.objects con SQL) ----------
let fotosBorradas = 0;
for (const lote of trozos(archivos, 100)) {
  const { data, error } = await bucket.remove(lote);
  if (error) await salir(`falló el borrado de fotos (${fotosBorradas} borradas hasta ahora): ${error.message}`);
  fotosBorradas += data?.length ?? lote.length;
  process.stdout.write(`\rFotos borradas: ${fotosBorradas}/${archivos.length}`);
}
if (archivos.length) process.stdout.write('\n');

// ---------- Filas ----------
for (const t of TABLAS) {
  if (conteos[t].error) {
    console.log(`${t}: omitida (no existe)`);
    continue;
  }
  // supabase-js exige un filtro en delete(): uno siempre verdadero.
  const { error } = await sb.from(t).delete().neq('id', UUID_CERO);
  if (error) await salir(`no se pudo borrar ${t}: ${ayudaLock(error.message)}`);
  console.log(`${t}: ${conteos[t].n} fila(s) borrada(s)`);
}

const restantes = await listarArchivosRecursivo((p, o) => bucket.list(p, o)).catch(() => null);
if (restantes?.length) console.warn(`\nAtención: quedaron ${restantes.length} archivo(s) en el bucket (volvé a correr el script).`);

console.log('\nListo. Siguiente paso: crear de nuevo el usuario RRHH:');
console.log('  npm run seed:admin --prefix server -- admin "Admin RRHH"' + (config.isLocal ? '   (o arrancar el server: en modo local recrea rrhh/scanner)' : ''));
await salir(null, 0);
