import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { limitePublicoQr, limitePublicoEstado } from '../middleware/rateLimits.js';
import { documentoSchema } from '../lib/schemas.js';
import { errores } from '../lib/errors.js';
import { buscarPorDocumento, estadoPorToken, tokenQrValido } from '../services/empleados.service.js';

const router = Router();

// Datos personales / estado en vivo: nunca cachear (ni navegador ni CDN).
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.post('/qr', limitePublicoQr(), validate({ body: z.object({ documento: documentoSchema }) }), async (req, res) => {
  const emp = await buscarPorDocumento(req.valid.body.documento);
  if (!emp) throw errores.noEncontrado('No encontramos un empleado con ese documento. Consultá con RRHH.');
  res.json({
    nombre: emp.nombre, empresa: emp.empresa, qr_token: emp.qr_token, ingreso: emp.ingreso, escaneado_at: emp.escaneado_at,
  });
});

const MSG_TOKEN = 'No encontramos ese código QR. Volvé a ingresar tu documento.';

/** Estado de ingreso por qr_token (pantalla de bienvenida, polling cada 5 s). Sin auth. */
router.get('/estado/:token', limitePublicoEstado(), async (req, res) => {
  const { token } = req.params;
  // Formato inválido => 404 sin tocar la DB (mismo error que un token inexistente).
  if (!tokenQrValido(token)) throw errores.noEncontrado(MSG_TOKEN);
  const estado = await estadoPorToken(token, req.log);
  if (!estado) throw errores.noEncontrado(MSG_TOKEN);
  res.json({ nombre: estado.nombre, ingreso: estado.ingreso, escaneado_at: estado.escaneado_at });
});

export default router;
