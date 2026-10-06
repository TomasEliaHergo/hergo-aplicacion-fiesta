import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { queryOpcional } from '../lib/schemas.js';
import * as asistencias from '../services/asistencias.service.js';
import { filtros } from '../services/empleados.service.js';

const router = Router();
router.use(requireAuth(['rrhh']));

router.get('/resumen', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await asistencias.resumen());
});

/** Primer pintado del dashboard en UN request: { resumen, filtros } (consultas en paralelo). */
router.get('/panel', async (_req, res) => {
  const [resumen, filtrosEmpleados] = await Promise.all([asistencias.resumen(), filtros()]);
  res.set('Cache-Control', 'private, max-age=10');
  res.json({ resumen, filtros: filtrosEmpleados });
});

const exportQuery = z.object({
  empresa: queryOpcional(z.string().max(120)),
  sector: queryOpcional(z.string().max(120)),
});

router.get('/export', validate({ query: exportQuery }), async (req, res) => {
  const { buffer, nombreArchivo } = await asistencias.exportar(req.valid.query);
  req.log.info({ filtros: req.valid.query }, 'Export de asistencia');
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${nombreArchivo}"`,
    'Cache-Control': 'no-store',
  });
  res.send(buffer);
});

router.delete('/:empleadoId', validate({ params: z.object({ empleadoId: z.uuid({ message: 'ID inválido' }) }) }), async (req, res) => {
  const borrada = await asistencias.deshacer(req.valid.params.empleadoId);
  req.log.warn({ empleadoId: req.valid.params.empleadoId, escaneadoAt: borrada.escaneado_at, deshechoPor: req.usuario.id }, 'Asistencia deshecha');
  res.status(204).end();
});

export default router;
