// Arranca el server en MODO LOCAL (PGlite) aunque server/.env apunte a Supabase.
// dotenv no pisa variables ya definidas, así que alcanza con setearla antes de importar.
process.env.DB_MODE = 'local';
await import('../src/index.js');
