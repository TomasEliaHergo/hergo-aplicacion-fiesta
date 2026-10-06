import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { uploadFoto, uploadFotosBulk, uploadImport } from '../middleware/upload.js';
import { documentoSchema, nombreSchema, textoSchema, idParams, queryOpcional, booleanQuery, paginacion } from '../lib/schemas.js';
import * as empleados from '../services/empleados.service.js';
import * as fotos from '../services/fotos.service.js';
import { importar } from '../services/import.service.js';

const router = Router();
router.use(requireAuth(['rrhh']));

const listaQuery = z.object({
  q: queryOpcional(z.string().trim().max(100)),
  empresa: queryOpcional(z.string().max(120)),
  sector: queryOpcional(z.string().max(120)),
  asistio: queryOpcional(booleanQuery),
  orden: queryOpcional(z.enum(['nombre', 'escaneado_at'])).transform((v) => v ?? 'nombre'),
  ...paginacion,
});

const crearBody = z.object({
  documento: documentoSchema,
  nombre: nombreSchema,
  empresa: textoSchema().optional(),
  sector: textoSchema().optional(),
});

// null o '' vacían el campo (el cliente manda null al borrar empresa/sector).
const textoVaciable = () => z.preprocess((v) => (v === null ? '' : v), textoSchema().optional());

const actualizarBody = z.object({
  documento: documentoSchema.optional(),
  nombre: nombreSchema.optional(),
  empresa: textoVaciable(),
  sector: textoVaciable(),
});

router.get('/', validate({ query: listaQuery }), async (req, res) => {
  res.json(await empleados.listar(req.valid.query));
});

router.get('/filtros', async (_req, res) => {
  const data = await empleados.filtros();
  res.set('Cache-Control', 'private, max-age=10');
  res.json(data);
});

// Rutas estáticas antes de "/:id"
router.post('/fotos', uploadFotosBulk, async (req, res) => {
  const resultado = await fotos.subirBulk(req.files ?? [], req.log);
  req.log.info({ subidas: resultado.subidas, errores: resultado.errores.length }, 'Fotos bulk');
  res.json(resultado);
});

router.post('/import', uploadImport, async (req, res) => {
  res.json(await importar(req.file, req.log));
});

router.post('/', validate({ body: crearBody }), async (req, res) => {
  const emp = await empleados.crear(req.valid.body);
  req.log.info({ empleadoId: emp.id }, 'Empleado creado');
  res.status(201).json(emp);
});

router.get('/:id', validate({ params: idParams }), async (req, res) => {
  res.json(await empleados.obtener(req.valid.params.id));
});

router.put('/:id', validate({ params: idParams, body: actualizarBody }), async (req, res) => {
  const emp = await empleados.actualizar(req.valid.params.id, req.valid.body);
  req.log.info({ empleadoId: emp.id }, 'Empleado actualizado');
  res.json(emp);
});

router.delete('/:id', validate({ params: idParams }), async (req, res) => {
  await empleados.eliminar(req.valid.params.id, req.log);
  req.log.info({ empleadoId: req.valid.params.id }, 'Empleado eliminado');
  res.status(204).end();
});

router.get('/:id/qr', validate({ params: idParams }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await empleados.obtenerQr(req.valid.params.id));
});

router.post('/:id/foto', validate({ params: idParams }), uploadFoto, async (req, res) => {
  res.json(await fotos.subirUna(req.valid.params.id, req.file, req.log));
});

router.delete('/:id/foto', validate({ params: idParams }), async (req, res) => {
  await fotos.borrarFotoEmpleado(req.valid.params.id, req.log);
  res.status(204).end();
});

export default router;
