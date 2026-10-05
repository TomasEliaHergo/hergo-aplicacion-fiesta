import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { limitePublicoQr } from '../middleware/rateLimits.js';
import { documentoSchema } from '../lib/schemas.js';
import { errores } from '../lib/errors.js';
import { buscarPorDocumento } from '../services/empleados.service.js';

const router = Router();

router.post('/qr', limitePublicoQr(), validate({ body: z.object({ documento: documentoSchema }) }), async (req, res) => {
  const emp = await buscarPorDocumento(req.valid.body.documento);
  if (!emp) throw errores.noEncontrado('No encontramos un empleado con ese documento. Consultá con RRHH.');
  res.set('Cache-Control', 'no-store');
  res.json({ nombre: emp.nombre, empresa: emp.empresa, qr_token: emp.qr_token });
});

export default router;
