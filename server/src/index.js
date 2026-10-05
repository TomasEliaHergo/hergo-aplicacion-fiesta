import 'dotenv/config';
import { getConfig } from './config.js';
import { logger } from './lib/logger.js';

let config;
try {
  config = getConfig();
} catch (err) {
  logger.fatal(err.message);
  process.exit(1);
}

if (config.isLocal) {
  try {
    const { iniciarDbLocal } = await import('./lib/local-db.js');
    await iniciarDbLocal(logger);
  } catch (err) {
    logger.fatal({ err }, 'Modo local: no se pudo inicializar la base PGlite (server/.data)');
    process.exit(1);
  }
}

const { createApp } = await import('./app.js');
const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV, dbMode: config.DB_MODE }, `Servidor escuchando en http://localhost:${config.PORT}`);
});

// Uploads grandes por redes lentas: dar margen.
server.requestTimeout = 5 * 60_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;

function apagar(senal) {
  logger.info({ senal }, 'Apagando servidor');
  server.close(async () => {
    if (config.isLocal) {
      const { cerrarDbLocal } = await import('./lib/local-db.js');
      await cerrarDbLocal().catch((err) => logger.warn({ err }, 'Error cerrando PGlite'));
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', apagar);
process.on('SIGINT', apagar);
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
