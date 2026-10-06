import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { motivoRechazoSchema } from '../lib/schemas.js';
import { errores } from '../lib/errors.js';
import { registrar, verificar, rechazar } from '../services/asistencias.service.js';

const router = Router();
router.use(requireAuth(['scanner', 'rrhh']));

const token = z.string().trim().min(1, 'Token requerido').max(200, 'Token inválido');
const scanBody = z.object({ token });

const rechazoBody = z.object({ token, motivo: motivoRechazoSchema });

/**
 * Flujo de la puerta: verificar (solo lectura) -> el personal compara la foto ->
 * confirmar (registra) o rechazar (auditoría, no registra).
 * Se responde 200 en los estados de negocio para que la UI no tenga que manejar errores.
 */
router.post('/verificar', validate({ body: scanBody }), async (req, res) => {
  const resultado = await verificar(req.valid.body.token);
  req.log.info({ estado: resultado.estado, empleadoId: resultado.empleado?.id }, 'Scan: verificar');
  res.json(resultado);
});

router.post('/confirmar', validate({ body: scanBody }), async (req, res) => {
  const resultado = await registrar(req.valid.body.token, req.usuario.id);
  req.log.info({ estado: resultado.estado, empleadoId: resultado.empleado?.id }, 'Scan: confirmar');
  res.json(resultado);
});

router.post('/rechazar', validate({ body: rechazoBody }), async (req, res) => {
  const { token: t, motivo } = req.valid.body;
  const empleadoId = await rechazar(t, req.usuario.id, motivo);
  if (!empleadoId) throw errores.noEncontrado('QR no válido');
  req.log.warn({ empleadoId, motivo, rechazadoPor: req.usuario.id }, 'Scan: ingreso rechazado');
  res.status(204).end();
});

/** Compatibilidad: escaneo que registra directo (el cliente actual usa verificar + confirmar). */
router.post('/', validate({ body: scanBody }), async (req, res) => {
  const resultado = await registrar(req.valid.body.token, req.usuario.id);
  req.log.info({ estado: resultado.estado, empleadoId: resultado.empleado?.id }, 'Scan');
  res.json(resultado);
});

export default router;
