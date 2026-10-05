// Entrada de Vercel: toda la API Express como UNA función serverless.
// vercel.json reescribe /api/(.*), /health y /ready hacia esta función; Express
// recibe el path original en req.url y lo atiende con las rutas montadas en /api.
//
// Esta entrada SOLO funciona con DB_MODE=supabase: el modo local (PGlite +
// archivos en server/.data) no tiene sentido en un filesystem efímero y de solo
// lectura. PGlite se carga únicamente por import() dinámico desde
// server/src/lib/local-db.js, que acá nunca se ejecuta (y vercel.json lo excluye
// del bundle de la función).
import { createApp } from '../server/src/app.js';
import { getConfig } from '../server/src/config.js';
import { logger } from '../server/src/lib/logger.js';

function prepararEntorno() {
  const modo = (process.env.DB_MODE ?? '').trim().toLowerCase();
  if (modo && modo !== 'supabase') {
    throw new Error(`DB_MODE=${modo} no está soportado en Vercel: usar DB_MODE=supabase (o no definirla) `
      + 'y configurar SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y JWT_SECRET en Project Settings > Environment Variables.');
  }
  process.env.DB_MODE = 'supabase'; // forzado: nunca caer en modo local por un SUPABASE_URL faltante
  process.env.NODE_ENV ||= 'production';

  const config = getConfig(); // valida SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET con mensajes claros
  if (config.isLocal) throw new Error('La función de Vercel no puede correr en modo local (PGlite).');
  return config;
}

let app;
try {
  const config = prepararEntorno();
  app = createApp({ serveClient: false }); // el estático lo sirve el CDN de Vercel (client/dist)
  logger.info({ dbMode: config.DB_MODE, schema: config.DB_SCHEMA, vercel: !!process.env.VERCEL }, 'API lista (serverless)');
} catch (err) {
  logger.fatal({ err }, 'No se pudo iniciar la API en Vercel');
  throw err;
}

export default app;
