// Crea el primer usuario RRHH.
// Uso:
//   npm run seed:admin -- admin "Admin RRHH"
//   npm run seed:admin -- --username admin --nombre "Admin RRHH"
// Password: SEED_ADMIN_PASSWORD (env/.env) o se pide por consola.
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { getSupabase } from '../src/lib/supabase.js';
import { hashPassword } from '../src/lib/passwords.js';
import { usernameSchema, passwordSchema, nombreSchema } from '../src/lib/schemas.js';

function salir(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

const { values, positionals } = parseArgs({
  options: { username: { type: 'string' }, nombre: { type: 'string' } },
  allowPositionals: true,
});

const usernameRaw = values.username ?? positionals[0];
const nombreRaw = values.nombre ?? positionals.slice(1).join(' ');
if (!usernameRaw || !nombreRaw) salir('Uso: npm run seed:admin -- <username> "<Nombre>"');

const username = usernameSchema.safeParse(usernameRaw);
if (!username.success) salir(username.error.issues[0].message);
const nombre = nombreSchema.safeParse(nombreRaw);
if (!nombre.success) salir(nombre.error.issues[0].message);

let password = process.env.SEED_ADMIN_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('Password para el usuario (min 8 caracteres): ');
  rl.close();
}
const pw = passwordSchema.safeParse(password);
if (!pw.success) salir(pw.error.issues[0].message);

let sb;
try {
  sb = getSupabase();
} catch (err) {
  salir(err.message);
}

const { data: existente, error: errBusqueda } = await sb.from('usuarios').select('id').eq('username', username.data).maybeSingle();
if (errBusqueda) {
  const ayuda = /Aborted/.test(errBusqueda.message)
    ? '\n  La base LOCAL está en uso: frená el server (npm run dev) y reintentá.' +
      '\n  Si querías crear el usuario en Supabase, poné DB_MODE=supabase, SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en server/.env.'
    : '';
  salir(`No se pudo consultar la base: ${errBusqueda.message}${ayuda}`);
}
if (existente) salir(`El usuario "${username.data}" ya existe.`);

const { data, error } = await sb.from('usuarios')
  .insert({ username: username.data, nombre: nombre.data, rol: 'rrhh', password_hash: await hashPassword(pw.data) })
  .select('id, username, nombre, rol')
  .single();
if (error) salir(`No se pudo crear el usuario: ${error.message}`);

console.log(`Usuario RRHH creado: ${data.username} (${data.nombre}) id=${data.id}`);
