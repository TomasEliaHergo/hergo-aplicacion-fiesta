import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { registrar } from '../services/asistencias.service.js';

const router = Router();

const scanBody = z.object({ token: z.string().trim().min(1, 'Token requerido').max(200, 'Token inválido') });

router.post('/', requireAuth(['scanner', 'rrhh']), validate({ body: scanBody }), async (req, res) => {
  const resultado = await registrar(req.valid.body.token, req.usuario.id);
  req.log.info({ estado: resultado.estado, documento: resultado.empleado?.documento }, 'Scan');
  res.set('Cache-Control', 'no-store');
  res.json(resultado);
});

export default router;
