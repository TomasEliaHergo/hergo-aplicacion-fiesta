import { rateLimit } from 'express-rate-limit';

function limitador(limit, mensaje) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'DEMASIADAS_SOLICITUDES', mensaje });
    },
  });
}

export const limiteGlobal = () => limitador(300, 'Demasiadas solicitudes. Esperá un momento e intentá de nuevo.');
export const limiteLogin = () => limitador(10, 'Demasiados intentos de ingreso. Esperá un minuto.');
export const limitePublicoQr = () => limitador(20, 'Demasiadas consultas. Esperá un minuto e intentá de nuevo.');
