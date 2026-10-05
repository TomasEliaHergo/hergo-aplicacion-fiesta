import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config.js';
import { logger } from './lib/logger.js';
import { getSupabase } from './lib/supabase.js';
import { FOTOS_DIR } from './lib/local-db.js';
import { limiteGlobal } from './middleware/rateLimits.js';
import { errorHandler, notFoundApi } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import scanRoutes from './routes/scan.js';
import empleadosRoutes from './routes/empleados.js';
import asistenciasRoutes from './routes/asistencias.js';
import usuariosRoutes from './routes/usuarios.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

/**
 * @param {object} [opciones]
 * @param {boolean} [opciones.serveClient] Servir client/dist con fallback SPA en producción.
 *   Default: true salvo en Vercel, donde el CDN sirve el estático y esta app solo atiende /api.
 */
export function createApp({ serveClient = !process.env.VERCEL } = {}) {
  const config = getConfig();
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(pinoHttp({
    logger,
    genReqId: (req, res) => {
      const entrante = req.headers['x-request-id'];
      const id = typeof entrante === 'string' && /^[\w-]{1,100}$/.test(entrante) ? entrante : randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }));

  // Modo local: las fotos se sirven desde este mismo origen (/fotos), alcanza con 'self'.
  const imgSrcExtra = config.isLocal ? [] : [new URL(config.SUPABASE_URL).origin];
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:', ...imgSrcExtra],
        'connect-src': ["'self'"],
        'media-src': ["'self'", 'blob:'],
        'worker-src': ["'self'", 'blob:'],
        'font-src': ["'self'", 'data:'],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  }));

  // Modo local: "Storage" = archivos en server/.data/fotos (paths aleatorios => cache larga).
  if (config.isLocal) {
    app.use('/fotos', express.static(FOTOS_DIR, {
      index: false,
      dotfiles: 'deny',
      setHeaders(res) { res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); },
    }));
    app.use('/fotos', (_req, res) => res.status(404).end());
  }

  // Infra (sin rate limit ni CORS)
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (req, res) => {
    try {
      const { error } = await getSupabase().from('usuarios').select('id', { head: true, count: 'exact' })
        .limit(1).abortSignal(AbortSignal.timeout(3000));
      if (error) throw error;
      res.json({ status: 'ok' });
    } catch (err) {
      req.log.warn({ err }, 'Ready: base de datos no disponible');
      res.status(503).json({ status: 'error', error: 'NO_DISPONIBLE', mensaje: 'Base de datos no disponible' });
    }
  });

  // API
  const api = express.Router();
  api.use(cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['Content-Disposition', 'X-Request-Id', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
    maxAge: 600,
  }));
  api.use(limiteGlobal());
  api.use(express.json({ limit: '100kb' }));
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  api.use('/auth', authRoutes);
  api.use('/public', publicRoutes);
  api.use('/scan', scanRoutes);
  api.use('/empleados', empleadosRoutes);
  api.use('/asistencias', asistenciasRoutes);
  api.use('/usuarios', usuariosRoutes);
  api.use(notFoundApi);
  app.use('/api', api);

  // Producción: servir el build del cliente con fallback SPA.
  if (serveClient && config.isProd && existsSync(path.join(CLIENT_DIST, 'index.html'))) {
    app.use(express.static(CLIENT_DIST, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (!req.accepts('html')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
    logger.info({ dir: CLIENT_DIST }, 'Sirviendo cliente estático');
  }

  app.use(errorHandler);
  return app;
}
